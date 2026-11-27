// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {TrestleCCIPBridge} from "../src/TrestleCCIPBridge.sol";
import {TrestleCCIPReceiver} from "../src/TrestleCCIPReceiver.sol";
import {TrestleSubAccount} from "../src/TrestleSubAccount.sol";
import {CCIPTypes, ICCIPRouter} from "../src/TrestleBridgeInterfaces.sol";

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

interface IUniswapV3PoolCallback {
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
}

contract MockCCIPRouter is ICCIPRouter {
    uint64 public destinationSelector;
    bytes public lastReceiver;
    address public lastToken;
    uint256 public lastTokenAmount;
    bytes public lastData;
    bytes public lastExtraArgs;
    uint256 public feePaid;
    bool public consumeTokensEnabled;

    function setConsumeTokens(bool enabled) external {
        consumeTokensEnabled = enabled;
    }

    function getFee(uint64, CCIPTypes.EVM2AnyMessage calldata) external pure returns (uint256) {
        return 1e14;
    }

    function ccipSend(uint64 selector, CCIPTypes.EVM2AnyMessage calldata message) external payable returns (bytes32) {
        destinationSelector = selector;
        lastReceiver = message.receiver;
        lastExtraArgs = message.extraArgs;
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

contract TrestleCCIPBridgeTest is Test {
    uint64 constant SOURCE_SELECTOR = 10344971235874465080;
    uint64 constant DESTINATION_SELECTOR = 14135854469784514356;
    uint256 constant RATE = 26_920e6;

    MockToken usdc;
    MockWETH weth;
    MockV3Pool basePool;
    MockCCIPRouter router;
    TrestleCCIPBridge bridge;
    address vault = address(0xBEEF);
    address destinationReceiver = address(0xCAFE);
    address subAccount = address(0xACCE);

    function setUp() public {
        vm.deal(vault, 100 ether);
        usdc = new MockToken("USD Coin", "USDC");
        weth = new MockWETH();
        basePool = new MockV3Pool(address(usdc), address(weth), 3000, RATE, true);
        router = new MockCCIPRouter();
        bridge = new TrestleCCIPBridge(
            vault,
            address(router),
            address(weth),
            address(usdc),
            address(basePool),
            DESTINATION_SELECTOR,
            SOURCE_SELECTOR
        );
        bridge.setDestinationReceiver(destinationReceiver);
        // The bridge is deliberately NOT funded: the user's reserve pays the
        // CCIP network fee, so the protocol contributes no capital.
        router.setConsumeTokens(true);
    }

    function testBridgeConvertsNativeToUsdcAndDispatchesBoundMessage() public {
        bytes32 requestId = keccak256("request-1");
        vm.prank(vault);
        bytes32 messageId = bridge.sendTopup{value: 1.02e16}(requestId, subAccount, 1e16);

        assertTrue(bridge.dispatchedRequests(requestId));
        assertEq(router.destinationSelector(), DESTINATION_SELECTOR);
        assertEq(router.feePaid(), 1e14);
        assertEq(abi.decode(router.lastReceiver(), (address)), destinationReceiver);
        assertEq(router.lastToken(), address(usdc));
        assertEq(router.lastTokenAmount(), 271.892e6);
        assertEq(router.lastExtraArgs(), abi.encodeWithSelector(bytes4(0x97a657c9), uint256(500_000)));
        assertEq(messageId, keccak256(abi.encode(DESTINATION_SELECTOR, abi.encode(destinationReceiver), 1e14)));

        (
            uint8 version,
            address sourceBridge,
            uint64 sourceSelector,
            uint64 destinationSelector,
            address encodedSubAccount,
            uint256 nativeAmount,
            uint256 usdcAmount,
            bytes32 encodedRequestId,
            uint256 expiry,
            bytes32 commitment
        ) = abi.decode(
            router.lastData(), (uint8, address, uint64, uint64, address, uint256, uint256, bytes32, uint256, bytes32)
        );
        assertEq(version, 1);
        assertEq(sourceBridge, address(bridge));
        assertEq(sourceSelector, SOURCE_SELECTOR);
        assertEq(destinationSelector, DESTINATION_SELECTOR);
        assertEq(encodedSubAccount, subAccount);
        assertEq(nativeAmount, 1e16);
        assertEq(usdcAmount, 271.892e6);
        assertEq(encodedRequestId, requestId);
        assertEq(expiry, block.timestamp + 24 hours);
        assertEq(
            commitment,
            keccak256(
                abi.encode(
                    1, address(bridge), SOURCE_SELECTOR, DESTINATION_SELECTOR, subAccount, 1e16, requestId, expiry
                )
            )
        );
    }

    function testBridgeRejectsNonVaultAndDuplicateRequest() public {
        bytes32 requestId = keccak256("request-1");
        vm.deal(address(0xDEAD), 1 ether);
        vm.prank(address(0xDEAD));
        vm.expectRevert("Only vault");
        bridge.sendTopup{value: 1.01e16}(requestId, subAccount, 1e16);

        vm.prank(vault);
        bridge.sendTopup{value: 1.01e16}(requestId, subAccount, 1e16);
        vm.prank(vault);
        vm.expectRevert("Request already dispatched");
        bridge.sendTopup{value: 1.01e16}(requestId, subAccount, 1e16);
    }

    /// @dev The CCIP network fee is paid from the value the user sent, so no
    /// protocol-funded fee reserve is needed.
    function testNetworkFeeIsPaidFromTheUsersFunding() public {
        vm.deal(address(bridge), 0);
        vm.prank(vault);
        bridge.sendTopup{value: 1.02e16}(keccak256("request-1"), subAccount, 1e16);

        assertEq(router.feePaid(), 1e14);
        // The whole user funding was consumed: the swap value plus the fee.
        assertEq(address(bridge).balance, 0);
    }

    /// @dev The fee is reserved out of the incoming value, so a top-up that
    /// does not cover it is rejected.
    function testBridgeRejectsFundingThatCannotCoverTheFee() public {
        vm.prank(vault);
        vm.expectRevert("Insufficient bridge funding");
        bridge.sendTopup{value: 1e14}(keccak256("request-1"), subAccount, 1e16);
    }
}

contract TrestleCCIPReceiverTest is Test {
    uint64 constant SOURCE_SELECTOR = 10344971235874465080;
    uint64 constant DESTINATION_SELECTOR = 14135854469784514356;
    uint256 constant RATE = 26_920e6;

    MockToken usdc;
    MockWETH weth;
    MockV3Pool destinationPool;
    TrestleCCIPReceiver receiver;
    TrestleSubAccount subAccountContract;
    address sourceBridge = address(0xBEEF);
    address router = address(0xC01D);
    address accountOwner = address(0xA11CE);

    function setUp() public {
        usdc = new MockToken("USD Coin", "USDC");
        weth = new MockWETH();
        vm.deal(address(weth), 100 ether);
        destinationPool = new MockV3Pool(address(usdc), address(weth), 500, RATE, false);
        vm.prank(accountOwner);
        subAccountContract = new TrestleSubAccount();
        vm.prank(accountOwner);
        subAccountContract.createSubAccount(address(this), 1e15, 1e16, 300, 10);
        receiver = new TrestleCCIPReceiver(
            sourceBridge,
            router,
            SOURCE_SELECTOR,
            DESTINATION_SELECTOR,
            address(usdc),
            address(weth),
            address(destinationPool),
            address(subAccountContract)
        );
        vm.prank(accountOwner);
        subAccountContract.setBridgeCreditor(address(receiver));
    }

    function _message(bytes memory data, bytes32 messageId, uint256 usdcAmount)
        internal
        view
        returns (CCIPTypes.Any2EVMMessage memory)
    {
        CCIPTypes.TokenAmount[] memory tokens = new CCIPTypes.TokenAmount[](1);
        tokens[0] = CCIPTypes.TokenAmount({token: address(usdc), amount: usdcAmount});
        return CCIPTypes.Any2EVMMessage({
            messageId: messageId,
            sourceChainSelector: SOURCE_SELECTOR,
            sender: abi.encode(sourceBridge),
            data: data,
            destTokenAmounts: tokens
        });
    }

    function _commitment(bytes32 requestId, address account, uint256 nativeAmount, uint256 expiry)
        internal
        view
        returns (bytes memory data)
    {
        data = _commitment(requestId, account, nativeAmount, 269.2e6, expiry);
    }

    function _commitment(bytes32 requestId, address account, uint256 nativeAmount, uint256 usdcAmount, uint256 expiry)
        internal
        view
        returns (bytes memory data)
    {
        bytes32 commitment = keccak256(
            abi.encode(1, sourceBridge, SOURCE_SELECTOR, DESTINATION_SELECTOR, account, nativeAmount, requestId, expiry)
        );
        data = abi.encode(
            1, sourceBridge, SOURCE_SELECTOR, DESTINATION_SELECTOR, account, nativeAmount, usdcAmount, requestId, expiry, commitment
        );
    }

    function testReceiverConvertsUsdcToExactNativeAndCreditsSubAccount() public {
        bytes32 requestId = keccak256("request-1");
        uint256 nativeAmount = 1e16;
        uint256 expiry = block.timestamp + 24 hours;
        bytes memory data = _commitment(requestId, accountOwner, nativeAmount, expiry);
        usdc.mint(address(receiver), 269.2e6);

        vm.prank(router);
        receiver.ccipReceive(_message(data, keccak256("message-1"), 269.2e6));

        assertTrue(receiver.consumedMessageIds(keccak256("message-1")));
        assertTrue(receiver.consumedRequestIds(requestId));
        assertEq(subAccountContract.getVirtualBalance(accountOwner), nativeAmount);
        assertEq(address(subAccountContract).balance, nativeAmount);
        assertEq(usdc.balanceOf(address(receiver)), 0);
        assertEq(receiver.requestSurplusUsdc(requestId), 0);
        assertEq(receiver.cumulativeSurplusUsdc(), 0);
    }

    /// @dev One receiver settles top-ups for any number of users: the
    /// destination comes from the payload, not from a hardcoded address.
    function testReceiverCreditsTheUserNamedInThePayload() public {
        address secondUser = address(0xB0B);

        vm.prank(secondUser);
        subAccountContract.createSubAccount(address(this), 1e15, 1e16, 300, 10);

        bytes32 requestId = keccak256("request-2");
        uint256 nativeAmount = 2e16;
        uint256 expiry = block.timestamp + 24 hours;
        bytes memory data = _commitment(requestId, secondUser, nativeAmount, 538.4e6, expiry);
        usdc.mint(address(receiver), 538.4e6);

        vm.prank(router);
        receiver.ccipReceive(_message(data, keccak256("message-2"), 538.4e6));

        assertEq(subAccountContract.getVirtualBalance(secondUser), nativeAmount);
        assertEq(subAccountContract.getVirtualBalance(accountOwner), 0);
    }

    /// @dev A payload pointing at a different user than the commitment
    /// covers must be rejected.
    function testReceiverRejectsDestinationTampering() public {
        bytes32 requestId = keccak256("request-1");
        uint256 expiry = block.timestamp + 24 hours;
        // The commitment covers accountOwner, the payload names somebody else.
        bytes32 commitment = keccak256(
            abi.encode(1, sourceBridge, SOURCE_SELECTOR, DESTINATION_SELECTOR, accountOwner, 1e16, requestId, expiry)
        );
        bytes memory data = abi.encode(
            1,
            sourceBridge,
            SOURCE_SELECTOR,
            DESTINATION_SELECTOR,
            address(0xBAD),
            1e16,
            269.2e6,
            requestId,
            expiry,
            commitment
        );
        usdc.mint(address(receiver), 269.2e6);

        vm.prank(router);
        vm.expectRevert("Invalid commitment");
        receiver.ccipReceive(_message(data, keccak256("message-1"), 269.2e6));
    }

    function testReceiverRejectsWrongCallerSourceOrToken() public {
        bytes32 requestId = keccak256("request-1");
        bytes memory data = _commitment(requestId, accountOwner, 1e16, block.timestamp + 24 hours);
        usdc.mint(address(receiver), 269.2e6);

        CCIPTypes.Any2EVMMessage memory message = _message(data, keccak256("message-1"), 269.2e6);
        vm.expectRevert("Only router");
        receiver.ccipReceive(message);

        message = _message(data, keccak256("message-1"), 269.2e6);
        message.sourceChainSelector = 1;
        vm.prank(router);
        vm.expectRevert("Unexpected source selector");
        receiver.ccipReceive(message);

        message = _message(data, keccak256("message-1"), 269.2e6);
        message.sender = abi.encode(address(0xDEAD));
        vm.prank(router);
        vm.expectRevert("Unexpected source bridge");
        receiver.ccipReceive(message);

        message = _message(data, keccak256("message-1"), 269.2e6);
        message.destTokenAmounts[0].token = address(weth);
        vm.prank(router);
        vm.expectRevert("Unexpected token");
        receiver.ccipReceive(message);
    }

    function testReceiverRejectsTamperingExpiryAndReplay() public {
        bytes32 requestId = keccak256("request-1");
        uint256 expiry = block.timestamp + 24 hours;
        bytes memory data = _commitment(requestId, accountOwner, 1e16, expiry);
        usdc.mint(address(receiver), 269.2e6);

        bytes memory tampered = abi.encode(
            1,
            sourceBridge,
            SOURCE_SELECTOR,
            DESTINATION_SELECTOR,
            accountOwner,
            2e16,
            269.2e6,
            requestId,
            expiry,
            bytes32(uint256(1))
        );
        vm.prank(router);
        vm.expectRevert("Invalid commitment");
        receiver.ccipReceive(_message(tampered, keccak256("message-1"), 269.2e6));

        vm.warp(expiry + 1);
        vm.prank(router);
        vm.expectRevert("Commitment expired");
        receiver.ccipReceive(_message(data, keccak256("message-1"), 269.2e6));
    }
}
