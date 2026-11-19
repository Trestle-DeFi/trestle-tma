// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {CCIPTypes, IAny2EVMMessageReceiver, IUniswapV3Pool, IWETH9} from "./TrestleBridgeInterfaces.sol";

interface ITrestleSubAccountBridge {
    function receiveTopUpFromBridge(uint256 amount) external payable;
}

/// @title Unichain Sepolia CCIP receiver
/// @notice Receives the exact CCIP USDC token, swaps it to WETH, unwraps the
/// WETH, and credits native ETH to the authorized sub-account.
contract TrestleCCIPReceiver is Ownable, ReentrancyGuard, IAny2EVMMessageReceiver, IERC165 {
    using SafeERC20 for IERC20;

    uint8 private constant COMMITMENT_VERSION = 1;
    uint256 public constant MIN_NATIVE_AMOUNT = 1e15;
    uint256 public constant MAX_NATIVE_AMOUNT = 1e20;

    address public immutable expectedSourceBridge;
    address public immutable router;
    uint64 public immutable sourceSelector;
    uint64 public immutable destinationSelector;
    IERC20 public immutable usdc;
    IWETH9 public immutable weth;
    IUniswapV3Pool public immutable unichainPool;
    address public subAccount;

    mapping(bytes32 => bool) public consumedMessageIds;
    mapping(bytes32 => bool) public consumedRequestIds;
    mapping(bytes32 => bytes32) public requestCommitments;
    mapping(bytes32 => int256) public requestSurplusUsdc;
    int256 public cumulativeSurplusUsdc;

    event TopupReceived(
        bytes32 indexed messageId,
        bytes32 indexed requestId,
        address indexed subAccount,
        uint256 nativeAmount,
        uint256 usdcAmount,
        int256 surplusUsdc
    );

    constructor(
        address expectedSourceBridge_,
        address router_,
        uint64 sourceSelector_,
        uint64 destinationSelector_,
        address usdc_,
        address weth_,
        address unichainPool_,
        address subAccount_
    ) Ownable(msg.sender) {
        require(expectedSourceBridge_ != address(0), "Source bridge required");
        require(router_ != address(0), "Router required");
        require(sourceSelector_ != 0 && destinationSelector_ != 0, "Selector required");
        require(usdc_ != address(0) && weth_ != address(0), "Token required");
        require(unichainPool_ != address(0), "Pool required");
        require(subAccount_ != address(0), "Sub-account required");

        expectedSourceBridge = expectedSourceBridge_;
        router = router_;
        sourceSelector = sourceSelector_;
        destinationSelector = destinationSelector_;
        usdc = IERC20(usdc_);
        weth = IWETH9(weth_);
        unichainPool = IUniswapV3Pool(unichainPool_);
        subAccount = subAccount_;

        require(
            unichainPool.token0() == address(usdc_) && unichainPool.token1() == address(weth_), "Unexpected pool tokens"
        );
    }

    /// @notice CCIP v1.2.0 receiver callback.
    function ccipReceive(CCIPTypes.Any2EVMMessage calldata message) external nonReentrant {
        require(msg.sender == router, "Only router");
        require(message.sourceChainSelector == sourceSelector, "Unexpected source selector");
        require(message.sender.length == 32, "Invalid sender encoding");
        address sourceBridge = abi.decode(message.sender, (address));
        require(sourceBridge == expectedSourceBridge, "Unexpected source bridge");
        require(!consumedMessageIds[message.messageId], "Message already consumed");

        (
            uint8 version,
            address encodedSourceBridge,
            uint64 encodedSourceSelector,
            uint64 encodedDestinationSelector,
            address encodedSubAccount,
            uint256 nativeAmount,
            uint256 usdcAmount,
            bytes32 requestId,
            uint256 expiry,
            bytes32 commitment
        ) = abi.decode(
            message.data, (uint8, address, uint64, uint64, address, uint256, uint256, bytes32, uint256, bytes32)
        );

        require(version == COMMITMENT_VERSION, "Unsupported commitment version");
        require(encodedSourceBridge == sourceBridge, "Source bridge mismatch");
        require(encodedSourceSelector == sourceSelector, "Source selector mismatch");
        require(encodedDestinationSelector == destinationSelector, "Destination selector mismatch");
        require(encodedSubAccount == subAccount, "Sub-account mismatch");
        require(nativeAmount >= MIN_NATIVE_AMOUNT && nativeAmount <= MAX_NATIVE_AMOUNT, "Native amount out of bounds");
        require(message.destTokenAmounts.length == 1, "Unexpected token count");
        require(message.destTokenAmounts[0].token == address(usdc), "Unexpected token");
        require(usdcAmount == message.destTokenAmounts[0].amount, "USDC amount mismatch");
        uint256 usdcBalanceBefore = usdc.balanceOf(address(this));
        require(usdcBalanceBefore >= usdcAmount, "USDC not received");
        require(block.timestamp <= expiry, "Commitment expired");
        require(!consumedRequestIds[requestId], "Request already consumed");

        bytes32 expectedCommitment = keccak256(
            abi.encode(
                COMMITMENT_VERSION,
                sourceBridge,
                sourceSelector,
                destinationSelector,
                subAccount,
                nativeAmount,
                requestId,
                expiry
            )
        );
        require(commitment == expectedCommitment, "Invalid commitment");

        consumedMessageIds[message.messageId] = true;
        consumedRequestIds[requestId] = true;
        requestCommitments[requestId] = commitment;

        uint256 usdcSpent = _swapUsdcForExactWeth(nativeAmount);
        int256 surplusUsdc = int256(usdcAmount) - int256(usdcSpent);
        requestSurplusUsdc[requestId] = surplusUsdc;
        cumulativeSurplusUsdc += surplusUsdc;

        uint256 wethBalance = weth.balanceOf(address(this));
        require(wethBalance >= nativeAmount, "Insufficient WETH output");
        weth.withdraw(nativeAmount);
        ITrestleSubAccountBridge(subAccount).receiveTopUpFromBridge{value: nativeAmount}(nativeAmount);

        emit TopupReceived(message.messageId, requestId, subAccount, nativeAmount, usdcAmount, surplusUsdc);
    }

    function _swapUsdcForExactWeth(uint256 amountOut) private returns (uint256 usdcSpent) {
        // Unichain pool ordering is USDC(token0), WETH(token1). A negative
        // amountSpecified requests an exact output of WETH.
        usdc.forceApprove(address(unichainPool), usdc.balanceOf(address(this)));
        (int256 amount0Delta,) =
            unichainPool.swap(address(this), true, -int256(amountOut), 0, abi.encode(address(usdc), address(this)));
        usdcSpent = amount0Delta > 0 ? uint256(amount0Delta) : 0;
    }

    /// @notice Uniswap V3 callback. Only the configured Unichain pool may
    /// invoke it. The positive token0 delta is USDC owed to the pool.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        require(msg.sender == address(unichainPool), "Only pool");
        (address tokenIn, address payer) = abi.decode(data, (address, address));
        require(tokenIn == address(usdc) && payer == address(this), "Invalid callback");

        uint256 amountToPay = amount0Delta > 0 ? uint256(amount0Delta) : 0;
        if (amountToPay > 0) {
            IERC20(tokenIn).safeTransfer(msg.sender, amountToPay);
        }
    }

    /// @notice ERC-165 interface detection required by CCIP v1.2.0.
    function supportsInterface(bytes4 interfaceId) public pure override returns (bool) {
        return interfaceId == type(IAny2EVMMessageReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    function setSubAccount(address newSubAccount) external onlyOwner {
        require(newSubAccount != address(0), "Sub-account required");
        subAccount = newSubAccount;
    }

    receive() external payable {}

    /// @notice Recover tokens accidentally sent to the receiver. Bridged CCIP
    /// USDC must not be withdrawn while a commitment remains unsettled.
    function rescueToken(address token, address recipient, uint256 amount) external onlyOwner {
        require(recipient != address(0), "Recipient required");
        require(token != address(usdc), "Cannot rescue bridged USDC");
        IERC20(token).safeTransfer(recipient, amount);
    }
}
