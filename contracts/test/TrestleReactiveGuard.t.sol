// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import {Test} from "forge-std/Test.sol";
import {TrestleReactiveGuard} from "../src/TrestleReactiveGuard.sol";
import {IReactive} from "@reactive/reactive-lib-omni/src/interfaces/IReactive.sol";
import {ISystemContract} from "@reactive/reactive-lib-omni/src/interfaces/ISystemContract.sol";

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

contract TrestleReactiveGuardTest is Test {
    address constant SYSTEM_ADDRESS = 0x8888888888888888888888888888888888888888;
    uint256 constant ORIGIN_CHAIN_ID = 1301;
    uint256 constant LOW_BALANCE_TOPIC = uint256(keccak256("LowBalanceDetected(address,uint256,uint256,uint64)"));

    TrestleReactiveGuard public guard;
    MockReactiveSystem public system;
    address public owner = vm.addr(1);
    address public originContract = vm.addr(2);
    address public subAccount = vm.addr(3);
    address public callbackRecipient = vm.addr(4);
    address public unauthorized = vm.addr(5);
    address public secondUser = vm.addr(6);

    function setUp() public {
        system = new MockReactiveSystem();
        vm.etch(SYSTEM_ADDRESS, address(system).code);
        vm.startPrank(owner);
        guard = new TrestleReactiveGuard(ORIGIN_CHAIN_ID, originContract, LOW_BALANCE_TOPIC);
        guard.setCallbackRecipient(callbackRecipient);
        vm.stopPrank();

        // Self-service onboarding: the user registers and subscribes its own
        // account, with no protocol owner involvement.
        vm.prank(subAccount);
        guard.registerSubAccount(subAccount);
        vm.prank(subAccount);
        guard.setupSubscription(subAccount, 10);
    }

    function _log(uint64 sequence, uint256 currentBalance, uint256 target, uint256 txHash, uint256 logIndex)
        internal
        view
        returns (IReactive.LogRecord memory)
    {
        return _logFor(subAccount, sequence, currentBalance, target, txHash, logIndex);
    }

    function _logFor(
        address account,
        uint64 sequence,
        uint256 currentBalance,
        uint256 target,
        uint256 txHash,
        uint256 logIndex
    ) internal view returns (IReactive.LogRecord memory) {
        return IReactive.LogRecord({
            chainId: ORIGIN_CHAIN_ID,
            contractAddress: originContract,
            topic0: LOW_BALANCE_TOPIC,
            topic1: uint256(uint160(account)),
            topic2: 0,
            topic3: 0,
            data: abi.encode(currentBalance, target, sequence),
            blockNumber: block.number,
            opCode: 0,
            blockHash: 0,
            txHash: txHash,
            logIndex: logIndex
        });
    }

    function testDeploymentSubscribesToOriginEvent() public view {
        assertEq(guard.owner(), owner);
        assertEq(guard.ORIGIN_CHAIN_ID(), ORIGIN_CHAIN_ID);
        assertEq(guard.ORIGIN_CONTRACT(), originContract);
        assertEq(guard.LOW_BALANCE_TOPIC(), LOW_BALANCE_TOPIC);
        MockReactiveSystem etchedSystem = MockReactiveSystem(SYSTEM_ADDRESS);
        assertTrue(etchedSystem.subscribed());
        assertEq(etchedSystem.chainId(), ORIGIN_CHAIN_ID);
        assertEq(etchedSystem.originContract(), originContract);
        assertEq(etchedSystem.topic0(), LOW_BALANCE_TOPIC);
    }

    function testReactRevertsUnauthorizedCaller() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        guard.react(_log(1, 5e15, 1e16, 1, 0));
    }

    function testReactRequestsBaseCallbackToTarget() public {
        vm.prank(SYSTEM_ADDRESS);
        guard.react(_log(1, 5e15, 1e16, 42, 0));

        MockReactiveSystem etchedSystem = MockReactiveSystem(SYSTEM_ADDRESS);
        assertEq(etchedSystem.requestedChainId(), 84532);
        assertEq(etchedSystem.requestedRecipient(), callbackRecipient);
        assertEq(etchedSystem.requestedGasLimit(), 250000);

        (address injected, bytes32 requestId, address destination, uint256 amount, uint256 timestamp, uint64 sequence) =
            abi.decode(etchedSystem.requestedPayload(), (address, bytes32, address, uint256, uint256, uint64));
        require(injected == address(0), "injected sender mismatch");
        require(destination == subAccount, "destination mismatch");
        require(amount == 5e15, "amount mismatch");
        require(timestamp == block.timestamp, "timestamp mismatch");
        require(sequence == 1, "sequence mismatch");
        require(requestId == keccak256(abi.encode(ORIGIN_CHAIN_ID, subAccount, uint64(1))), "request id mismatch");
    }

    function testReactRejectsDuplicateEvent() public {
        IReactive.LogRecord memory record = _log(1, 5e15, 1e16, 42, 0);
        vm.prank(SYSTEM_ADDRESS);
        guard.react(record);
        vm.prank(SYSTEM_ADDRESS);
        vm.expectRevert("Event already processed");
        guard.react(record);
    }

    function testReactEnforcesDailyLimit() public {
        vm.prank(subAccount);
        guard.updateSubscription(subAccount, true, 1);
        vm.warp(block.timestamp + 301);
        vm.prank(SYSTEM_ADDRESS);
        guard.react(_log(1, 5e15, 1e16, 42, 0));
        vm.warp(block.timestamp + 301);
        vm.prank(SYSTEM_ADDRESS);
        vm.expectRevert("Daily refill limit reached");
        guard.react(_log(2, 5e15, 1e16, 43, 1));
    }

    function testReactEnforcesCooldown() public {
        vm.prank(SYSTEM_ADDRESS);
        guard.react(_log(1, 5e15, 1e16, 42, 0));
        vm.prank(SYSTEM_ADDRESS);
        vm.expectRevert("Cooldown period active");
        guard.react(_log(2, 5e15, 1e16, 43, 1));
    }

    /// @dev The cooldown is the user's own value, not a deployment constant:
    /// a short user cooldown frees up sooner than a long one.
    function testCooldownIsPerUserAndDynamic() public {
        address fast = vm.addr(11);
        address slow = vm.addr(12);

        vm.prank(fast);
        guard.registerSubAccount(fast);
        vm.prank(slow);
        guard.registerSubAccount(slow);

        vm.prank(fast);
        guard.setupSubscription(fast, 10, 60);
        vm.prank(slow);
        guard.setupSubscription(slow, 10, 600);

        assertEq(guard.getSubscriptionStatus(fast).cooldown, 60);
        assertEq(guard.getSubscriptionStatus(slow).cooldown, 600);

        // Trigger each user's first refill.
        vm.prank(SYSTEM_ADDRESS);
        guard.react(_logFor(fast, 1, 5e15, 1e16, 42, 0));
        vm.prank(SYSTEM_ADDRESS);
        guard.react(_logFor(slow, 1, 5e15, 1e16, 44, 2));

        // After 90 seconds the fast user's cooldown has elapsed, the slow
        // user's has not.
        vm.warp(block.timestamp + 90);
        vm.prank(SYSTEM_ADDRESS);
        guard.react(_logFor(fast, 2, 5e15, 1e16, 43, 1));

        vm.prank(SYSTEM_ADDRESS);
        vm.expectRevert("Cooldown period active");
        guard.react(_logFor(slow, 2, 5e15, 1e16, 45, 3));
    }

    /// @dev A user changes their own cooldown on-chain at any time.
    function testUserCanUpdateTheirOwnCooldown() public {
        vm.prank(subAccount);
        guard.updateSubscription(subAccount, true, 10, 900);

        assertEq(guard.getSubscriptionStatus(subAccount).cooldown, 900);
    }

    function testUpdateSubscriptionPauses() public {
        vm.prank(subAccount);
        guard.updateSubscription(subAccount, false, 10);
        assertFalse(guard.getSubscriptionStatus(subAccount).isActive);
    }

    /// @dev A user pauses their own auto-topup without any owner action.
    function testUserCanPauseTheirOwnSubscription() public {
        vm.prank(subAccount);
        guard.pauseSubscription(subAccount);

        assertFalse(guard.getSubscriptionStatus(subAccount).isActive);
        assertEq(guard.getSubscriptionStatus(subAccount).dailyRefillCount, 0);
    }

    /// @dev Nobody may register on another user's behalf. The old code let
    /// the first caller claim any address, which let an attacker lock a user
    /// out of auto-topup permanently.
    function testCannotRegisterOnBehalfOfAnotherUser() public {
        vm.prank(unauthorized);
        vm.expectRevert("Can only register yourself");
        guard.registerSubAccount(subAccount);

        // The victim can still register itself.
        vm.prank(subAccount);
        guard.registerSubAccount(subAccount);
        assertEq(guard.subAccountOwners(subAccount), subAccount);
    }

    /// @dev Registration is idempotent: re-registering never reverts.
    function testRegistrationIsIdempotent() public {
        vm.prank(subAccount);
        guard.registerSubAccount(subAccount);
        vm.prank(subAccount);
        guard.registerSubAccount(subAccount);

        assertEq(guard.subAccountOwners(subAccount), subAccount);
    }

    /// @dev The protocol owner may register a user while scripting an
    /// onboarding, but the subscription still belongs to that user.
    function testOwnerCanRegisterUserForScriptedOnboarding() public {
        address scripted = vm.addr(13);

        vm.prank(owner);
        guard.registerSubAccount(scripted);

        assertEq(guard.subAccountOwners(scripted), scripted);

        // The owner may also set the subscription up for them...
        vm.prank(owner);
        guard.setupSubscription(scripted, 5, 120);
        assertTrue(guard.getSubscriptionStatus(scripted).isActive);

        // ...and the user owns it from that point on.
        vm.prank(scripted);
        guard.updateSubscription(scripted, true, 7, 90);
        assertEq(guard.getSubscriptionStatus(scripted).maxDailyRefills, 7);
        assertEq(guard.getSubscriptionStatus(scripted).cooldown, 90);
    }

    /// @dev The owner sets a protocol floor on the cooldown; users cannot go
    /// below it.
    function testMinCooldownPeriodIsEnforced() public {
        vm.prank(owner);
        guard.setMinCooldownPeriod(600);

        vm.prank(subAccount);
        vm.expectRevert("Cooldown too short");
        guard.updateSubscription(subAccount, true, 10, 60);

        vm.prank(subAccount);
        guard.updateSubscription(subAccount, true, 10, 600);
        assertEq(guard.getSubscriptionStatus(subAccount).cooldown, 600);
    }

    /// @dev Two users get two independent subscriptions with independent
    /// daily counters.
    function testEachUserHasAnIndependentSubscription() public {
        vm.prank(secondUser);
        guard.registerSubAccount(secondUser);
        vm.prank(secondUser);
        guard.setupSubscription(secondUser, 2, 60);

        vm.prank(SYSTEM_ADDRESS);
        guard.react(_log(1, 5e15, 1e16, 42, 0));

        assertEq(guard.getSubscriptionStatus(subAccount).dailyRefillCount, 1);
        assertEq(guard.getSubscriptionStatus(secondUser).dailyRefillCount, 0);
    }

    function testOwnerCanChangeMaxDailyRefillsLimit() public {
        vm.prank(owner);
        guard.setMaxDailyRefillsLimit(25);
        assertEq(guard.maxDailyRefillsLimit(), 25);

        address other = vm.addr(9);
        vm.prank(other);
        guard.registerSubAccount(other);
        vm.prank(other);
        guard.setupSubscription(other, 25);
        assertEq(guard.getSubscriptionStatus(other).maxDailyRefills, 25);

        address tooMany = vm.addr(10);
        vm.prank(tooMany);
        guard.registerSubAccount(tooMany);
        vm.prank(tooMany);
        vm.expectRevert("Invalid max daily refills");
        guard.setupSubscription(tooMany, 26);
    }
}

