// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

/// @notice Minimal CCIP 1.2.0 interfaces used by the Set & Forget bridge.
library CCIPTypes {
    struct TokenAmount {
        address token;
        uint256 amount;
    }

    struct EVM2AnyMessage {
        bytes receiver;
        bytes data;
        TokenAmount[] tokenAmounts;
        address feeToken;
        bytes extraArgs;
    }

    struct Any2EVMMessage {
        bytes32 messageId;
        uint64 sourceChainSelector;
        bytes sender;
        bytes data;
        TokenAmount[] destTokenAmounts;
    }
}

interface ICCIPRouter {
    function getFee(uint64 destinationChainSelector, CCIPTypes.EVM2AnyMessage calldata message)
        external
        view
        returns (uint256 fee);

    function ccipSend(uint64 destinationChainSelector, CCIPTypes.EVM2AnyMessage calldata message)
        external
        payable
        returns (bytes32 messageId);
}

interface IAny2EVMMessageReceiver {
    function ccipReceive(CCIPTypes.Any2EVMMessage calldata message) external;
}

/// @notice Minimal Uniswap V3 pool interface. The contracts call the
/// verified pool directly, avoiding a chain-specific router deployment.
interface IUniswapV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function liquidity() external view returns (uint128);

    /// @notice The pool's current price and tick state. The first return value
    /// is sqrt(price) * 2^96, where price is token1 per token0 in raw units.
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );

    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
}

interface IWETH9 {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}
