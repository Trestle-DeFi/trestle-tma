// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {CCIPTypes, ICCIPRouter, IUniswapV3Pool, IWETH9} from "./TrestleBridgeInterfaces.sol";

/// @title Base Sepolia native-to-USDC CCIP bridge
/// @notice Converts native ETH to WETH, swaps WETH to the exact CCIP USDC
/// token in the verified Base Sepolia Uniswap V3 pool, and sends USDC over
/// CCIP to the Unichain receiver.
contract TrestleCCIPBridge is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 private constant COMMITMENT_VERSION = 1;
    /// @dev bytes4(keccak256("CCIP EVMExtraArgsV1")) from CCIP v1.2.0.
    bytes4 private constant EVM_EXTRA_ARGS_V1_TAG = 0x97a657c9;
    uint256 public constant MIN_NATIVE_AMOUNT = 1e15;
    uint256 public constant MAX_NATIVE_AMOUNT = 1e20;
    uint256 public constant DESTINATION_EXPIRY = 24 hours;
    /// @notice Minimum USDC output per ETH accepted from the swap. It is a
    /// slippage guard against a manipulated or empty pool, not a price feed:
    /// the owner can lower it when the source market trades below the floor.
    uint256 public minUsdcPerEth = 1_000e6;
    /// @dev Uniswap V3's maximum sqrt price. A swap that takes token1 in
    /// (zeroForOne = false) must be bounded below it, and a zero price limit
    /// is rejected by the pool with "SPL".
    uint160 private constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    address public vault;
    address public destinationReceiver;
    /// @notice Optional emergency buffer that covers a CCIP fee drifting above
    /// the quote. It is NOT required: the user's reserve pays the network fee
    /// through `quoteFee()`, so the protocol contributes no capital.
    uint256 public feeReserve;
    uint256 public destinationGasLimit;
    ICCIPRouter public immutable ccipRouter;
    IWETH9 public immutable weth;
    IERC20 public immutable usdc;
    IUniswapV3Pool public immutable basePool;
    uint64 public immutable destinationSelector;
    uint64 public immutable sourceSelector;

    mapping(bytes32 => bool) public dispatchedRequests;
    mapping(bytes32 => bytes32) public requestCommitments;

    modifier onlyVault() {
        require(msg.sender == vault && vault != address(0), "Only vault");
        _;
    }

    event TopupDispatched(
        bytes32 indexed requestId,
        address indexed subAccount,
        uint256 nativeAmount,
        uint256 usdcAmount,
        bytes32 commitment,
        bytes32 messageId
    );
    event MinUsdcPerEthUpdated(uint256 minUsdcPerEth);

    constructor(
        address vault_,
        address ccipRouter_,
        address weth_,
        address usdc_,
        address basePool_,
        uint64 destinationSelector_,
        uint64 sourceSelector_
    ) Ownable(msg.sender) {
        require(vault_ != address(0), "Vault required");
        require(ccipRouter_ != address(0), "CCIP router required");
        require(weth_ != address(0), "WETH required");
        require(usdc_ != address(0), "USDC required");
        require(basePool_ != address(0), "Base pool required");
        require(destinationSelector_ != 0 && sourceSelector_ != 0, "Selector required");

        vault = vault_;
        ccipRouter = ICCIPRouter(ccipRouter_);
        weth = IWETH9(weth_);
        usdc = IERC20(usdc_);
        basePool = IUniswapV3Pool(basePool_);
        destinationSelector = destinationSelector_;
        sourceSelector = sourceSelector_;
        destinationGasLimit = 500_000;

        require(basePool.token0() == address(usdc_) && basePool.token1() == address(weth_), "Unexpected pool tokens");
    }

    /// @notice Quotes the CCIP network fee for a top-up.
    /// @dev The fee is a function of the destination gas price and the
    /// encoded message length. Neither depends on the USDC amount, so the
    /// fee can be quoted before the swap happens. Quoting is what lets the
    /// USER's reserve pay the network fee instead of a protocol-funded
    /// buffer: the vault asks for the quote, adds it to the funding, and
    /// the bridge reserves that amount out of the value it was sent.
    function quoteFee() public view returns (uint256) {
        CCIPTypes.EVM2AnyMessage memory probe =
            _buildMessage(bytes32(0), address(this), MIN_NATIVE_AMOUNT, 0, block.timestamp, bytes32(0));
        return ccipRouter.getFee(destinationSelector, probe);
    }

    /// @notice Called by the vault with native ETH. The amount argument is the
    /// exact native ETH amount that must be restored on the destination.
    function sendTopup(bytes32 requestId, address subAccount, uint256 nativeAmount)
        external
        payable
        onlyVault
        nonReentrant
        returns (bytes32 messageId)
    {
        require(subAccount != address(0), "Sub-account required");
        require(destinationReceiver != address(0), "Destination receiver not configured");
        require(nativeAmount >= MIN_NATIVE_AMOUNT && nativeAmount <= MAX_NATIVE_AMOUNT, "Native amount out of bounds");
        require(!dispatchedRequests[requestId], "Request already dispatched");

        // The CCIP network fee is reserved out of the value the user sent,
        // so no protocol-funded fee reserve is required. `swapValue` is what
        // is actually converted to USDC and bridged.
        uint256 fee = quoteFee();
        require(msg.value > fee, "Insufficient bridge funding");
        uint256 swapValue = msg.value - fee;

        uint256 usdcBefore = usdc.balanceOf(address(this));
        uint256 wethBefore = weth.balanceOf(address(this));
        weth.deposit{value: swapValue}();
        uint256 wethAmount = weth.balanceOf(address(this)) - wethBefore;
        weth.approve(address(basePool), wethAmount);
        _swapWethForUsdc(wethAmount);
        uint256 usdcAmount = usdc.balanceOf(address(this)) - usdcBefore;
        require(usdcAmount > 0, "No USDC output");

        uint256 minimumUsdc = (swapValue * minUsdcPerEth) / 1e18;
        require(usdcAmount >= minimumUsdc, "Insufficient USDC output");

        uint256 expiry = block.timestamp + DESTINATION_EXPIRY;
        bytes32 commitment = keccak256(
            abi.encode(
                COMMITMENT_VERSION,
                address(this),
                sourceSelector,
                destinationSelector,
                subAccount,
                nativeAmount,
                requestId,
                expiry
            )
        );
        CCIPTypes.EVM2AnyMessage memory message =
            _buildMessage(requestId, subAccount, nativeAmount, usdcAmount, expiry, commitment);

        // The fee is recomputed against the final message. It normally equals
        // the quote exactly; any drift is covered by the balance the bridge
        // already holds.
        uint256 finalFee = ccipRouter.getFee(destinationSelector, message);
        require(address(this).balance >= finalFee, "Insufficient fee reserve");
        usdc.forceApprove(address(ccipRouter), usdcAmount);
        messageId = ccipRouter.ccipSend{value: finalFee}(destinationSelector, message);
        usdc.forceApprove(address(ccipRouter), 0);

        dispatchedRequests[requestId] = true;
        requestCommitments[requestId] = commitment;
        emit TopupDispatched(requestId, subAccount, nativeAmount, usdcAmount, commitment, messageId);
    }

    /// @dev Builds the CCIP message. The probe used for the fee quote and the
    /// final message have identical encodings, so they carry the same fee.
    function _buildMessage(
        bytes32 requestId,
        address subAccount,
        uint256 nativeAmount,
        uint256 usdcAmount,
        uint256 expiry,
        bytes32 commitment
    ) internal view returns (CCIPTypes.EVM2AnyMessage memory) {
        CCIPTypes.TokenAmount[] memory tokenAmounts = new CCIPTypes.TokenAmount[](1);
        tokenAmounts[0] = CCIPTypes.TokenAmount({token: address(usdc), amount: usdcAmount});
        bytes memory data = abi.encode(
            COMMITMENT_VERSION,
            address(this),
            sourceSelector,
            destinationSelector,
            subAccount,
            nativeAmount,
            usdcAmount,
            requestId,
            expiry,
            commitment
        );
        return CCIPTypes.EVM2AnyMessage({
            receiver: abi.encode(destinationReceiver),
            data: data,
            tokenAmounts: tokenAmounts,
            feeToken: address(0),
            extraArgs: abi.encodeWithSelector(EVM_EXTRA_ARGS_V1_TAG, destinationGasLimit)
        });
    }

    function _swapWethForUsdc(uint256 amountIn) private {
        // Base pool ordering is USDC(token0), WETH(token1). WETH in therefore
        // uses zeroForOne=false and requests an exact input of WETH.
        // Uniswap V3 rejects a zero price limit with "SPL", so the exact-input
        // swap is bounded by the highest representable price.
        basePool.swap(
            address(this),
            false,
            int256(amountIn),
            uint160(MAX_SQRT_RATIO - 1),
            abi.encode(address(weth), address(this))
        );
    }

    /// @notice Uniswap V3 callback. Only the configured Base pool may invoke it.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        require(msg.sender == address(basePool), "Only pool");
        (address tokenIn, address payer) = abi.decode(data, (address, address));
        require(tokenIn == address(weth) && payer == address(this), "Invalid callback");

        uint256 amountToPay = amount1Delta > 0 ? uint256(amount1Delta) : 0;
        if (amountToPay > 0) {
            IERC20(tokenIn).safeTransfer(msg.sender, amountToPay);
        }
    }

    function setVault(address newVault) external onlyOwner {
        require(newVault != address(0), "Vault required");
        vault = newVault;
    }

    function setDestinationReceiver(address receiver) external onlyOwner {
        require(receiver != address(0), "Receiver required");
        destinationReceiver = receiver;
    }

    function setFeeReserve(uint256 newFeeReserve) external onlyOwner {
        feeReserve = newFeeReserve;
    }

    /// @notice Adjusts the minimum USDC output per ETH accepted from the swap.
    /// @dev The floor is a slippage guard, not a price feed. Test networks
    /// often quote ETH far below mainnet levels, so the owner can lower it
    /// instead of stranding every user's top-up.
    function setMinUsdcPerEth(uint256 newMinUsdcPerEth) external onlyOwner {
        require(newMinUsdcPerEth > 0, "Invalid floor");
        minUsdcPerEth = newMinUsdcPerEth;
        emit MinUsdcPerEthUpdated(newMinUsdcPerEth);
    }

    function setDestinationGasLimit(uint256 newDestinationGasLimit) external onlyOwner {
        require(newDestinationGasLimit != 0, "Gas limit required");
        destinationGasLimit = newDestinationGasLimit;
    }

    receive() external payable {}
}
