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
    uint256 public constant MIN_USDC_PER_ETH = 20_000e6;
    uint256 public constant DESTINATION_EXPIRY = 24 hours;

    address public vault;
    address public destinationReceiver;
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
        require(msg.value >= nativeAmount, "Insufficient bridge funding");

        uint256 usdcBefore = usdc.balanceOf(address(this));
        weth.deposit{value: msg.value}();
        uint256 wethAmount = weth.balanceOf(address(this));
        weth.approve(address(basePool), wethAmount);
        _swapWethForUsdc(wethAmount);
        uint256 usdcAmount = usdc.balanceOf(address(this)) - usdcBefore;
        require(usdcAmount > 0, "No USDC output");

        uint256 minimumUsdc = (msg.value * MIN_USDC_PER_ETH) / 1e18;
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

        CCIPTypes.TokenAmount[] memory tokenAmounts = new CCIPTypes.TokenAmount[](1);
        tokenAmounts[0] = CCIPTypes.TokenAmount({token: address(usdc), amount: usdcAmount});
        usdc.forceApprove(address(ccipRouter), usdcAmount);

        CCIPTypes.EVM2AnyMessage memory message = CCIPTypes.EVM2AnyMessage({
            receiver: abi.encode(destinationReceiver),
            data: data,
            tokenAmounts: tokenAmounts,
            feeToken: address(0),
            extraArgs: abi.encodeWithSelector(EVM_EXTRA_ARGS_V1_TAG, destinationGasLimit)
        });

        // CCIP v1.2.0 does not refund native-fee overpayment. Quote the exact
        // fee, cap it with the configured reserve, and forward only that fee.
        uint256 fee = ccipRouter.getFee(destinationSelector, message);
        require(fee <= feeReserve, "Fee exceeds reserve");
        require(address(this).balance >= fee, "Insufficient fee reserve");
        messageId = ccipRouter.ccipSend{value: fee}(destinationSelector, message);
        usdc.forceApprove(address(ccipRouter), 0);

        dispatchedRequests[requestId] = true;
        requestCommitments[requestId] = commitment;
        emit TopupDispatched(requestId, subAccount, nativeAmount, usdcAmount, commitment, messageId);
    }

    function _swapWethForUsdc(uint256 amountIn) private {
        // Base pool ordering is USDC(token0), WETH(token1). WETH in therefore
        // uses zeroForOne=false and requests an exact input of WETH.
        basePool.swap(address(this), false, int256(amountIn), 0, abi.encode(address(weth), address(this)));
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

    function setDestinationGasLimit(uint256 newDestinationGasLimit) external onlyOwner {
        require(newDestinationGasLimit != 0, "Gas limit required");
        destinationGasLimit = newDestinationGasLimit;
    }

    receive() external payable {}
}
