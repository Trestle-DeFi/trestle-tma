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

    function setUp() public {
        system = new MockReactiveSystem();
        vm.etch(SYSTEM_ADDRESS, address(system).code);
        vm.startPrank(owner);
        guard = new TrestleReactiveGuard(ORIGIN_CHAIN_ID, originContract, LOW_BALANCE_TOPIC);
        guard.setCallbackRecipient(callbackRecipient);
        guard.setupSubscription(subAccount, 10);
        vm.stopPrank();
    }

    function _log(uint64 sequence, uint256 currentBalance, uint256 target, uint256 txHash, uint256 logIndex)
        internal
        view
        returns (IReactive.LogRecord memory)
    {
        return IReactive.LogRecord({
            chainId: ORIGIN_CHAIN_ID,
            contractAddress: originContract,
            topic0: LOW_BALANCE_TOPIC,
            topic1: uint256(uint160(subAccount)),
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
        vm.prank(owner);
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

    function testUpdateSubscriptionPauses() public {
        vm.prank(owner);
        guard.updateSubscription(subAccount, false, 10);
        assertFalse(guard.getSubscriptionStatus(subAccount).isActive);
    }
}

