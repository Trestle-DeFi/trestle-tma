// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {CCIPTypes, ICCIPRouter} from "../../src/TrestleBridgeInterfaces.sol";
import {ISystemContract} from "@reactive/reactive-lib-omni/src/interfaces/ISystemContract.sol";

/// @notice Shared mocks for the Set & Forget end-to-end test. They let one
/// Foundry test drive the whole cross-chain auto-topup locally.
contract MockToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}

contract MockWETH is ERC20 {
    constructor() ERC20("Wrapped Ether", "WETH") {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool success,) = msg.sender.call{value: amount}("");
        require(success, "ETH transfer failed");
    }
}

interface IUniswapV3PoolCallback {
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
}

/// @notice A constant-rate Uniswap V3 pool stand-in. The rate is quoted as
/// USDC (6 decimals) per WETH (18 decimals), and the swap direction follows
/// the `zeroForOne` flag: token0 in (USDC) or token1 in (WETH).
contract MockV3Pool {
    address public token0;
    address public token1;
    uint24 public fee;
    uint256 public rate;
    bool public exactInput;
    uint160 public sqrtPriceX96 = 79228162514264337593543950336;

    constructor(address token0_, address token1_, uint24 fee_, uint256 rate_, bool exactInput_) {
        token0 = token0_;
        token1 = token1_;
        fee = fee_;
        rate = rate_;
        exactInput = exactInput_;
    }

    function liquidity() external pure returns (uint128) {
        return 1e30;
    }

    function slot0()
        external
        view
        returns (uint160, int24, uint16, uint16, uint16, uint8, bool)
    {
        return (sqrtPriceX96, 0, 0, 0, 0, 0, true);
    }

    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160, bytes calldata data)
        external
        returns (int256, int256)
    {
        uint256 amountIn;
        uint256 amountOut;
        if (amountSpecified >= 0) {
            // Exact input: the specified amount is the input token.
            amountIn = uint256(amountSpecified);
            amountOut = zeroForOne ? (amountIn * 1e18) / rate : (amountIn * rate) / 1e18;
        } else {
            // Exact output: the specified amount is the output token.
            amountOut = uint256(-amountSpecified);
            amountIn = zeroForOne ? (amountOut * rate) / 1e18 : (amountOut * 1e18) / rate;
        }

        (int256 amount0Delta, int256 amount1Delta) =
            zeroForOne ? (int256(amountIn), -int256(amountOut)) : (-int256(amountOut), int256(amountIn));
        IUniswapV3PoolCallback(msg.sender).uniswapV3SwapCallback(amount0Delta, amount1Delta, data);

        if (zeroForOne) {
            MockWETH(token1).mint(recipient, amountOut);
        } else {
            MockToken(token0).mint(recipient, amountOut);
        }
        // Uniswap V3 returns the positive amounts swapped, not the deltas.
        return zeroForOne ? (int256(amountIn), int256(amountOut)) : (int256(amountOut), int256(amountIn));
    }
}

/// @notice A CCIP router stand-in that records the dispatched message and
/// takes delivery of the tokens.
contract MockCCIPRouter is ICCIPRouter {
    uint256 public constant FEE = 1e14;

    uint64 public destinationSelector;
    bytes public lastReceiver;
    address public lastToken;
    uint256 public lastTokenAmount;
    bytes public lastData;
    uint256 public feePaid;
    bool public consumeTokensEnabled;

    function setConsumeTokens(bool enabled) external {
        consumeTokensEnabled = enabled;
    }

    function getFee(uint64, CCIPTypes.EVM2AnyMessage calldata) external pure returns (uint256) {
        return FEE;
    }

    function ccipSend(uint64 selector, CCIPTypes.EVM2AnyMessage calldata message) external payable returns (bytes32) {
        destinationSelector = selector;
        lastReceiver = message.receiver;
        lastToken = message.tokenAmounts[0].token;
        lastTokenAmount = message.tokenAmounts[0].amount;
        lastData = message.data;
        feePaid = msg.value;
        if (consumeTokensEnabled) {
            MockToken(message.tokenAmounts[0].token)
                .transferFrom(msg.sender, address(this), message.tokenAmounts[0].amount);
        }
        return keccak256(abi.encode(selector, message.receiver, msg.value));
    }
}

/// @notice The Reactive Network system contract stand-in. It records the
/// callback the guard requests.
contract MockReactiveSystem {
    uint256 public chainId;
    address public originContract;
    uint256 public topic0;
    bool public subscribed;
    uint256 public requestedChainId;
    address public requestedRecipient;
    uint64 public requestedGasLimit;
    bytes public requestedPayload;

    function subscribe(uint256 chainId_, address contract_, uint256 topic0_, uint256, uint256, uint256) external {
        chainId = chainId_;
        originContract = contract_;
        topic0 = topic0_;
        subscribed = true;
    }

    function requestCallbackV_1_0(ISystemContract.CallbackConfiguration_V_1_0 memory config_) external {
        requestedChainId = config_.chainId;
        requestedRecipient = config_.recipient;
        requestedGasLimit = config_.gasLimit;
        requestedPayload = config_.payload;
    }
}