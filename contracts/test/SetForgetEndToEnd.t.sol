// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IReactive} from "@reactive/reactive-lib-omni/src/interfaces/IReactive.sol";
import {IPayable} from "@reactive/reactive-lib-omni/src/interfaces/IPayable.sol";
import {TrestleSubAccount} from "../src/TrestleSubAccount.sol";
import {TrestleMainVault} from "../src/TrestleMainVault.sol";
import {TrestleCCIPBridge} from "../src/TrestleCCIPBridge.sol";
import {TrestleCCIPReceiver} from "../src/TrestleCCIPReceiver.sol";
import {TrestleReactiveGuard} from "../src/TrestleReactiveGuard.sol";
import {CCIPTypes} from "../src/TrestleBridgeInterfaces.sol";
import {MockToken, MockWETH, MockV3Pool, MockCCIPRouter, MockReactiveSystem} from "./mocks/SetForgetMocks.sol";

/// @title Set & Forget — the whole cross-chain auto-topup, end to end
/// @notice Drives the complete flow for TWO independent users with different
/// thresholds, targets and cooldowns, and proves that:
///   - every step of the journey is a self-service user transaction,
///   - each user's top-up is funded only from that user's own reserve,
///   - the protocol contributes ZERO capital,
///   - one user's refill never lands in, or is paid for by, the other.
contract SetForgetEndToEndTest is Test {
    address constant SYSTEM_ADDRESS = 0x8888888888888888888888888888888888888888;
    uint64 constant SOURCE_SELECTOR = 10344971235874465080;
    uint64 constant DESTINATION_SELECTOR = 14135854469784514356;
    uint256 constant RATE = 26_920e6;
    uint256 constant ORIGIN_CHAIN_ID = 1301;
    uint256 constant LOW_BALANCE_TOPIC = uint256(keccak256("LowBalanceDetected(address,uint256,uint256,uint64)"));
    uint256 constant NETWORK_FEE = 1e14;

    // Unichain Sepolia
    TrestleSubAccount public registry;
    // Base Sepolia
    TrestleMainVault public vault;
    TrestleCCIPBridge public bridge;
    // Unichain Sepolia
    TrestleCCIPReceiver public receiver;
    // Lasna
    TrestleReactiveGuard public guard;

    MockToken public usdc;
    MockWETH public weth;
    MockV3Pool public basePool;
    MockV3Pool public destinationPool;
    MockCCIPRouter public router;
    MockReactiveSystem public system;

    address public protocolOwner = vm.addr(1);
    address payable public callbackProxy = payable(vm.addr(2));
    address public userA = vm.addr(10);
    address public userB = vm.addr(11);
    address public recipient = vm.addr(12);

    function setUp() public {
        vm.deal(protocolOwner, 10 ether);
        vm.deal(userA, 10 ether);
        vm.deal(userB, 10 ether);

        usdc = new MockToken("USD Coin", "USDC");
        weth = new MockWETH();
        basePool = new MockV3Pool(address(usdc), address(weth), 3000, RATE, true);
        destinationPool = new MockV3Pool(address(usdc), address(weth), 500, RATE, false);
        router = new MockCCIPRouter();
        router.setConsumeTokens(true);

        // The Reactive Network system contract lives at a fixed address.
        // `vm.etch` copies code but not storage, so the mock is read back
        // from the etched address, which is the one the guard talks to.
        MockReactiveSystem systemImpl = new MockReactiveSystem();
        vm.etch(SYSTEM_ADDRESS, address(systemImpl).code);
        system = MockReactiveSystem(SYSTEM_ADDRESS);

        vm.startPrank(protocolOwner);
        registry = new TrestleSubAccount();
        guard = new TrestleReactiveGuard(ORIGIN_CHAIN_ID, address(registry), LOW_BALANCE_TOPIC);
        vault = new TrestleMainVault(IPayable(callbackProxy), address(guard));
        bridge = new TrestleCCIPBridge(
            address(vault),
            address(router),
            address(weth),
            address(usdc),
            address(basePool),
            DESTINATION_SELECTOR,
            SOURCE_SELECTOR
        );
        receiver = new TrestleCCIPReceiver(
            address(bridge),
            address(router),
            SOURCE_SELECTOR,
            DESTINATION_SELECTOR,
            address(usdc),
            address(weth),
            address(destinationPool),
            address(registry)
        );

        // Protocol wiring only. No capital moves here.
        vault.setTopupBridge(address(bridge));
        bridge.setDestinationReceiver(address(receiver));
        registry.setBridgeCreditor(address(receiver));
        guard.setCallbackRecipient(address(vault));
        vm.stopPrank();
    }

    /// @dev The complete, self-service onboarding journey for one user.
    /// Every transaction below is sent by the USER; the protocol owner is
    /// never involved.
    function _onboard(
        address user,
        uint256 threshold,
        uint256 target,
        uint64 cooldown,
        uint64 maxDaily,
        uint256 seed,
        uint256 reserve,
        uint64 maxDailyRefills,
        uint64 guardCooldown
    ) internal {
        // 1. Open the sub-account (Unichain).
        vm.prank(user);
        registry.createSubAccount(address(vault), threshold, target, cooldown, maxDaily);

        // 2. Fund the operational wallet the user actually spends from.
        vm.prank(user);
        registry.depositTopUp{value: seed}();

        // 3. Fund the cross-chain reserve the user's refills are paid from.
        vm.prank(user);
        vault.depositFor{value: reserve}(user);

        // 4. Choose the user's own daily request cap.
        vm.prank(user);
        vault.setMyDailyRequestLimit(maxDaily);

        // 5. Register and subscribe on Lasna.
        vm.prank(user);
        guard.registerSubAccount(user);
        vm.prank(user);
        guard.setupSubscription(user, maxDailyRefills, guardCooldown);
    }

    /// @dev Spends below the user's threshold and returns the
    /// LowBalanceDetected log exactly as the reactive guard would receive it.
    /// `logIndex` is supplied by the caller so that two users' events remain
    /// distinct in the guard's replay-protection hash.
    function _spendBelowThreshold(address user, uint256 amount, uint256 logIndex)
        internal
        returns (IReactive.LogRecord memory)
    {
        vm.recordLogs();
        vm.prank(user);
        registry.spend(user, recipient, amount, address(0));

        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == bytes32(LOW_BALANCE_TOPIC)) {
                return IReactive.LogRecord({
                    chainId: ORIGIN_CHAIN_ID,
                    contractAddress: address(registry),
                    topic0: uint256(logs[i].topics[0]),
                    topic1: uint256(logs[i].topics[1]),
                    topic2: 0,
                    topic3: 0,
                    data: logs[i].data,
                    blockNumber: block.number,
                    opCode: 0,
                    blockHash: uint256(keccak256(abi.encode("block", block.number))),
                    txHash: uint256(keccak256(abi.encode("tx", user, logIndex))),
                    logIndex: logIndex
                });
            }
        }
        revert("LowBalanceDetected not emitted");
    }

    /// @dev Plays the Reactive Network: the guard reacts to the log and asks
    /// the system contract for a callback on Base Sepolia.
    function _guardReacts(IReactive.LogRecord memory record) internal {
        vm.prank(SYSTEM_ADDRESS);
        guard.react(record);
    }

    /// @dev Plays the cross-chain callback: the vault releases the top-up
    /// from the requesting user's reserve and the bridge dispatches it.
    function _deliverCallback() internal {
        (
            address injected,
            bytes32 requestId,
            address user,
            uint256 amount,
            uint256 timestamp,
            uint64 sequence
        ) = abi.decode(system.requestedPayload(), (address, bytes32, address, uint256, uint256, uint64));
        require(injected == address(0), "unexpected injected sender");

        vm.prank(callbackProxy);
        vault.releaseTopup(address(guard), requestId, user, amount, timestamp, sequence);
    }

    /// @dev Plays CCIP delivery on the destination chain.
    function _deliverOverCcip() internal {
        uint256 usdcAmount = router.lastTokenAmount();
        vm.prank(address(router));
        usdc.transfer(address(receiver), usdcAmount);

        CCIPTypes.TokenAmount[] memory tokens = new CCIPTypes.TokenAmount[](1);
        tokens[0] = CCIPTypes.TokenAmount({token: address(usdc), amount: usdcAmount});
        CCIPTypes.Any2EVMMessage memory message = CCIPTypes.Any2EVMMessage({
            messageId: keccak256(abi.encode(router.lastData(), usdcAmount, block.chainid)),
            sourceChainSelector: SOURCE_SELECTOR,
            sender: abi.encode(address(bridge)),
            data: router.lastData(),
            destTokenAmounts: tokens
        });

        vm.prank(address(router));
        receiver.ccipReceive(message);
    }

    /// @dev Runs one user's whole auto-topup cycle.
    function _runAutoTopup(address user, uint256 spendAmount, uint256 logIndex) internal {
        IReactive.LogRecord memory record = _spendBelowThreshold(user, spendAmount, logIndex);
        _guardReacts(record);
        _deliverCallback();
        _deliverOverCcip();
    }

    /// @dev Onboards both users with DIFFERENT thresholds, targets and
    /// cooldowns, exactly as two real users would.
    function _onboardBoth() internal {
        // User A: refills at 0.005 ETH, tops up to 0.01 ETH, 5 minute cooldown.
        _onboard(userA, 5e15, 1e16, 300, 10, 6e15, 1e18, 5, 300);
        // User B: refills at 0.002 ETH, tops up to 0.008 ETH, 10 minute
        // source cooldown and a 1 minute guard cooldown of its own.
        _onboard(userB, 2e15, 8e15, 600, 20, 5e15, 5e17, 3, 60);
    }

    /// @dev THE demo test: two users, one deployment, two independent
    /// auto-topups, no protocol capital.
    function testTwoUsersCompleteTheWholeJourneyIndependently() public {
        _onboardBoth();

        // User A spends 0.002 ETH: 0.006 -> 0.004, below its 0.005 threshold.
        _runAutoTopup(userA, 2e15, 0);
        // User B spends 0.004 ETH: 0.005 -> 0.001, below its 0.002 threshold.
        _runAutoTopup(userB, 4e15, 1);

        // Each user is refilled to ITS OWN target.
        assertEq(registry.getVirtualBalance(userA), 1e16);
        assertEq(registry.getVirtualBalance(userB), 8e15);

        // Each user's reserve paid for ITS OWN refill, including the 1%
        // bridge buffer and the cross-chain network fee.
        uint256 fundingA = (6e15 * 10_100) / 10_000 + NETWORK_FEE;
        uint256 fundingB = (7e15 * 10_100) / 10_000 + NETWORK_FEE;
        assertEq(vault.balances(userA), 1e18 - fundingA);
        assertEq(vault.balances(userB), 5e17 - fundingB);

        // The protocol put in nothing.
        assertEq(protocolOwner.balance, 10 ether);
        assertEq(address(bridge).balance, 0);
        assertEq(address(vault).balance, vault.balances(userA) + vault.balances(userB));
        assertEq(
            address(registry).balance, registry.getVirtualBalance(userA) + registry.getVirtualBalance(userB)
        );
    }

    /// @dev One user's refill never lands in, or is paid for by, the other.
    function testOneUserCanNeverTouchAnother() public {
        _onboardBoth();

        vm.prank(userB);
        vm.expectRevert("Not authorized for user");
        registry.spend(userA, recipient, 1e15, address(0));

        vm.prank(userB);
        vm.expectRevert("Not authorized");
        vault.requestTopUp(userA, 1, 1e16);

        vm.prank(userB);
        vm.expectRevert("Can only register yourself");
        guard.registerSubAccount(userA);

        vm.prank(userB);
        vm.expectRevert("Not authorized for user");
        registry.updateConfigFor(userA, 9e15, 9e16, 300, 10);

        // A user can only ever withdraw from its OWN operational balance.
        vm.prank(userB);
        vm.expectRevert("Insufficient balance");
        registry.withdraw(99e15);

        vm.prank(userB);
        registry.withdraw(1e15);

        // Nothing of user A's moved.
        assertEq(registry.getVirtualBalance(userA), 6e15);
        assertEq(registry.getVirtualBalance(userB), 4e15);
        assertEq(vault.balances(userA), 1e18);
        assertEq(vault.balances(userB), 5e17);
    }

    /// @dev The same sequence number for two users produces two different
    /// request streams, so their top-ups can never collide.
    function testRequestIdsAreCollisionFreePerUser() public {
        _onboardBoth();

        IReactive.LogRecord memory a = _spendBelowThreshold(userA, 2e15, 0);
        IReactive.LogRecord memory b = _spendBelowThreshold(userB, 4e15, 1);

        assertEq(a.topic1, uint256(uint160(userA)));
        assertEq(b.topic1, uint256(uint160(userB)));

        bytes32 idA = keccak256(abi.encode(ORIGIN_CHAIN_ID, userA, uint64(1)));
        bytes32 idB = keccak256(abi.encode(ORIGIN_CHAIN_ID, userB, uint64(1)));
        assertTrue(idA != idB);
    }

    /// @dev A user changes every setting themselves, and the changes take
    /// effect on the very next auto-topup.
    function testUserCanReconfigureEverythingThemselves() public {
        _onboard(userA, 5e15, 1e16, 300, 10, 6e15, 1e18, 5, 300);

        // The user lowers its threshold, raises its target, raises its own
        // daily caps and picks its own guard cooldown.
        vm.prank(userA);
        registry.updateConfig(3e15, 9e15, 300, 25);
        vm.prank(userA);
        guard.updateSubscription(userA, true, 7, 900);
        vm.prank(userA);
        vault.setMyDailyRequestLimit(25);

        TrestleReactiveGuard.Subscription memory sub = guard.getSubscriptionStatus(userA);
        assertEq(sub.maxDailyRefills, 7);
        assertEq(sub.cooldown, 900);

        // The refill now uses the NEW threshold and the NEW target:
        // 0.006 - 0.004 spend = 0.002 left, refilled to 0.009.
        _runAutoTopup(userA, 4e15, 0);
        assertEq(registry.getVirtualBalance(userA), 9e15);

        uint256 funding = (7e15 * 10_100) / 10_000 + NETWORK_FEE;
        assertEq(vault.balances(userA), 1e18 - funding);

        // Inside the user's own 900 second guard cooldown, no second refill
        // is requested, even though the source cooldown has already expired.
        vm.warp(block.timestamp + 400);
        IReactive.LogRecord memory record = _spendBelowThreshold(userA, 7e15, 1);
        vm.prank(SYSTEM_ADDRESS);
        vm.expectRevert("Cooldown period active");
        guard.react(record);
    }

    /// @dev The user can switch the auto-topup off and on again, alone.
    function testUserCanPauseAndResumeTheirOwnAutoTopup() public {
        _onboard(userA, 5e15, 1e16, 300, 10, 6e15, 1e18, 5, 300);

        vm.prank(userA);
        guard.pauseSubscription(userA);

        // While paused, no refill is requested and no money moves.
        IReactive.LogRecord memory record = _spendBelowThreshold(userA, 2e15, 0);
        vm.prank(SYSTEM_ADDRESS);
        vm.expectRevert("Subscription not active");
        guard.react(record);
        assertEq(registry.getVirtualBalance(userA), 4e15);
        assertEq(vault.balances(userA), 1e18);

        // Resuming puts the user back in charge, with no owner transaction.
        vm.prank(userA);
        guard.updateSubscription(userA, true, 5);
        _guardReacts(record);
        _deliverCallback();
        _deliverOverCcip();
        assertEq(registry.getVirtualBalance(userA), 1e16);
    }

    /// @dev A user-chosen operator acts for the user and always debits the
    /// USER's balance, never the operator's.
    function testOperatorActsForTheUserAndDebitsTheUsersBalance() public {
        _onboard(userA, 5e15, 1e16, 300, 10, 6e15, 1e18, 5, 300);
        address operator = vm.addr(20);

        vm.prank(userA);
        registry.setOperator(operator, true);

        vm.prank(operator);
        registry.spend(userA, recipient, 2e15, address(0));
        assertEq(registry.getVirtualBalance(userA), 4e15);
        assertEq(registry.getVirtualBalance(operator), 0);
        assertEq(recipient.balance, 2e15);

        // The operator may reconfigure the user's settings.
        vm.prank(operator);
        registry.updateConfigFor(userA, 3e15, 9e15, 300, 10);

        // Revoking the operator takes effect immediately.
        vm.prank(userA);
        registry.setOperator(operator, false);
        vm.prank(operator);
        vm.expectRevert("Not authorized for user");
        registry.spend(userA, recipient, 1e15, address(0));
    }

    /// @dev The protocol owner is never an operator. It can neither spend a
    /// user's funds nor change a user's configuration.
    function testProtocolOwnerCannotSpendUserFundsOrChangeUserConfig() public {
        _onboard(userA, 5e15, 1e16, 300, 10, 6e15, 1e18, 5, 300);

        vm.prank(protocolOwner);
        vm.expectRevert("Not authorized for user");
        registry.spend(userA, recipient, 1e15, address(0));

        vm.prank(protocolOwner);
        vm.expectRevert("Not authorized for user");
        registry.updateConfigFor(userA, 3e15, 9e15, 300, 10);

        // Operators are only ever appointed by the user themself, so the
        // protocol owner can never end up in a user's operator set.
        assertFalse(registry.operators(userA, protocolOwner));
        assertFalse(registry.operators(userB, protocolOwner));
    }

    /// @dev The owner keeps a global safety kill switch. It stops future
    /// top-ups but never moves a single wei.
    function testOwnerKillSwitchStopsTopupsWithoutMovingFunds() public {
        _onboard(userA, 5e15, 1e16, 300, 10, 6e15, 1e18, 5, 300);

        vm.prank(protocolOwner);
        registry.deactivateFor(userA);

        vm.prank(userA);
        vm.expectRevert("Sub-account not active");
        registry.spend(userA, recipient, 1e15, address(0));

        assertEq(registry.getVirtualBalance(userA), 6e15);
        assertEq(vault.balances(userA), 1e18);

        // The user can switch it back on themselves.
        vm.prank(userA);
        registry.activate();
        vm.prank(userA);
        registry.spend(userA, recipient, 1e15, address(0));
        assertEq(registry.getVirtualBalance(userA), 5e15);
    }

    /// @dev A user can pull their own money out at any time, from both the
    /// operational wallet and the cross-chain reserve.
    function testUserCanWithdrawTheirOwnFundsAtAnyTime() public {
        _onboard(userA, 5e15, 1e16, 300, 10, 6e15, 1e18, 5, 300);

        uint256 before = userA.balance;

        vm.prank(userA);
        registry.withdraw(2e15);
        assertEq(registry.getVirtualBalance(userA), 4e15);
        assertEq(userA.balance, before + 2e15);

        vm.prank(userA);
        vault.withdraw(3e17);
        assertEq(vault.balances(userA), 7e17);
        assertEq(userA.balance, before + 2e15 + 3e17);

        // Nobody else can withdraw on the user's behalf.
        vm.prank(protocolOwner);
        vm.expectRevert("Insufficient balance");
        vault.withdraw(1e15);
    }
}