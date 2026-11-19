// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import {Test} from "forge-std/Test.sol";
import {TrestleMainVault} from "../src/TrestleMainVault.sol";
import {IPayable} from "@reactive/reactive-lib-omni/src/interfaces/IPayable.sol";

contract MockTopupBridge {
    bytes32 public requestId;
    address public destination;
    uint256 public amount;
    uint256 public valueReceived;

    function sendTopup(bytes32 requestId_, address destination_, uint256 amount_) external payable returns (bytes32) {
        requestId = requestId_;
        destination = destination_;
        amount = amount_;
        valueReceived = msg.value;
        return keccak256(abi.encode(requestId_, destination_, amount_));
    }
}

contract TrestleMainVaultTest is Test {
    TrestleMainVault public vault;
    MockTopupBridge public bridge;
    address public owner = vm.addr(1);
    address payable public callbackProxy = payable(vm.addr(2));
    address public reactiveSender = vm.addr(3);
    address public unauthorized = vm.addr(4);
    address public destination = vm.addr(5);

    function setUp() public {
        vm.startPrank(owner);
        bridge = new MockTopupBridge();
        vault = new TrestleMainVault(IPayable(callbackProxy), reactiveSender);
        vault.setTopupBridge(address(bridge));
        vm.stopPrank();
        vm.deal(address(vault), 1e18);
    }

    function _release(bytes32 requestId, uint256 amount, uint256 timestamp, uint64 sequence) internal {
        vm.prank(callbackProxy);
        vault.releaseTopup(reactiveSender, requestId, destination, amount, timestamp, sequence);
    }

    function testDeploymentAuthenticatesProxyAndReactiveSender() public view {
        assertEq(vault.owner(), owner);
        assertEq(address(vault._SERVICE_PROVIDER()), callbackProxy);
        assertEq(vault._CALLBACK_SENDER(), reactiveSender);
    }

    function testAuthorizedCallbackBridgesTopup() public {
        uint64 sequence = 1;
        bytes32 requestId = keccak256(abi.encode(uint256(1301), destination, sequence));
        _release(requestId, 1e16, block.timestamp, sequence);

        (bool settled, bool expired, uint256 amount) = vault.getRequestStatus(requestId);
        assertTrue(settled);
        assertFalse(expired);
        assertEq(amount, 1e16);
        assertEq(bridge.requestId(), requestId);
        assertEq(bridge.destination(), destination);
        assertEq(bridge.amount(), 1e16);
        assertEq(bridge.valueReceived(), 1.01e16);
    }

    function testRejectsCallerOtherThanCallbackProxy() public {
        uint64 sequence = 1;
        bytes32 requestId = keccak256(abi.encode(uint256(1301), destination, sequence));
        vm.prank(unauthorized);
        vm.expectRevert();
        vault.releaseTopup(reactiveSender, requestId, destination, 1e16, block.timestamp, sequence);
    }

    function testRejectsDifferentReactiveSender() public {
        uint64 sequence = 1;
        bytes32 requestId = keccak256(abi.encode(uint256(1301), destination, sequence));
        vm.prank(callbackProxy);
        vm.expectRevert();
        vault.releaseTopup(unauthorized, requestId, destination, 1e16, block.timestamp, sequence);
    }

    function testRejectsDuplicateCallback() public {
        uint64 sequence = 1;
        bytes32 requestId = keccak256(abi.encode(uint256(1301), destination, sequence));
        _release(requestId, 1e16, block.timestamp, sequence);
        vm.prank(callbackProxy);
        vm.expectRevert("Request settled");
        vault.releaseTopup(reactiveSender, requestId, destination, 1e16, block.timestamp, sequence);
    }

    function testRejectsExpiredCallback() public {
        uint64 sequence = 1;
        bytes32 requestId = keccak256(abi.encode(uint256(1301), destination, sequence));
        vm.warp(3602);
        vm.prank(callbackProxy);
        vm.expectRevert("Request expired");
        vault.releaseTopup(reactiveSender, requestId, destination, 1e16, 1, sequence);
    }

    function testRejectsTopupBelowMinimum() public {
        uint64 sequence = 1;
        bytes32 requestId = keccak256(abi.encode(uint256(1301), destination, sequence));
        vm.prank(callbackProxy);
        vm.expectRevert("Amount too small");
        vault.releaseTopup(reactiveSender, requestId, destination, 1e14, block.timestamp, sequence);
    }

    function testRejectsNonCanonicalRequestId() public {
        uint64 sequence = 1;
        bytes32 requestId = keccak256("non-canonical");
        vm.prank(callbackProxy);
        vm.expectRevert("Invalid request ID");
        vault.releaseTopup(reactiveSender, requestId, destination, 1e16, block.timestamp, sequence);
    }

    function testRejectsMismatchForExistingRequestWithoutOverwriting() public {
        uint64 sequence = 1;
        bytes32 requestId = keccak256(abi.encode(uint256(1301), destination, sequence));
        vm.prank(owner);
        vault.requestTopUp(destination, sequence, 1e16);

        vm.prank(callbackProxy);
        vm.expectRevert("Amount mismatch");
        vault.releaseTopup(reactiveSender, requestId, destination, 2e16, block.timestamp, sequence);

        (bool settled, bool expired, uint256 amount) = vault.getRequestStatus(requestId);
        assertFalse(settled);
        assertFalse(expired);
        assertEq(amount, 1e16);
    }

    function testRejectsInsufficientVaultBalance() public {
        uint64 sequence = 1;
        bytes32 requestId = keccak256(abi.encode(uint256(1301), destination, sequence));
        vm.deal(address(vault), 1e15);
        vm.prank(callbackProxy);
        vm.expectRevert("Insufficient vault balance");
        vault.releaseTopup(reactiveSender, requestId, destination, 1e16, block.timestamp, sequence);
    }
}
