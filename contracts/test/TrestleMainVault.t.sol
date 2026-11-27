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
    uint256 public feeQuote;

    function setFeeQuote(uint256 fee) external {
        feeQuote = fee;
    }

    function quoteFee() external view returns (uint256) {
        return feeQuote;
    }

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
    address public other = vm.addr(6);

    function setUp() public {
        vm.startPrank(owner);
        bridge = new MockTopupBridge();
        vault = new TrestleMainVault(IPayable(callbackProxy), reactiveSender);
        vault.setTopupBridge(address(bridge));
        vm.stopPrank();

        // The user funds their own reserve. The owner contributes nothing.
        vm.deal(destination, 1e18);
        vm.prank(destination);
        vault.depositFor{value: 1e18}(destination);
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
        // The user's own reserve funded the top-up, including the 1% bridge
        // buffer that covers the ETH->USDC->ETH round trip.
        assertEq(vault.balances(destination), 1e18 - 1.01e16);
    }

    /// @dev The cross-chain network fee is paid out of the USER's reserve, so
    /// the protocol never funds a fee buffer of its own.
    function testNetworkFeeIsPaidFromTheUsersReserve() public {
        vm.prank(owner);
        bridge.setFeeQuote(1e14);

        uint64 sequence = 1;
        bytes32 requestId = keccak256(abi.encode(uint256(1301), destination, sequence));
        _release(requestId, 1e16, block.timestamp, sequence);

        // 1% bridge buffer + the quoted network fee.
        assertEq(bridge.valueReceived(), 1.01e16 + 1e14);
        assertEq(vault.balances(destination), 1e18 - (1.01e16 + 1e14));
    }

    /// @dev A user's reserve is credited to them and to nobody else.
    function testDepositForCreditsTheNamedUser() public {
        vm.deal(other, 5e17);
        vm.prank(other);
        vault.depositFor{value: 5e17}(other);

        assertEq(vault.balances(other), 5e17);
        assertEq(vault.balances(destination), 1e18);
        assertEq(address(vault).balance, 1.5e18);
    }

    /// @dev A plain deposit credits the sender's own reserve.
    function testPlainDepositCreditsTheSender() public {
        vm.deal(other, 1e17);
        vm.prank(other);
        (bool ok,) = address(vault).call{value: 1e17}("");
        require(ok, "deposit failed");

        assertEq(vault.balances(other), 1e17);
    }

    /// @dev A user withdraws their own unspent reserve.
    function testUserCanWithdrawTheirOwnReserve() public {
        vm.prank(destination);
        vault.withdraw(1e17);

        assertEq(vault.balances(destination), 1e18 - 1e17);
        assertEq(destination.balance, 1e17);
    }

    /// @dev No user — including the contract owner — can withdraw another
    /// user's reserve.
    function testUserCannotWithdrawAnotherUsersReserve() public {
        vm.prank(other);
        vm.expectRevert("Insufficient balance");
        vault.withdraw(1e17);

        vm.prank(owner);
        vm.expectRevert("Insufficient balance");
        vault.withdraw(1e17);
    }

    /// @dev A release is funded only from the requesting user's reserve.
    function testReleaseIsFundedOnlyFromTheRequestingUser() public {
        // A second user with no reserve of their own.
        uint64 sequence = 1;
        bytes32 requestId = keccak256(abi.encode(uint256(1301), other, sequence));
        vm.prank(callbackProxy);
        vm.expectRevert("Insufficient user balance");
        vault.releaseTopup(reactiveSender, requestId, other, 1e16, block.timestamp, sequence);

        // The funded user's reserve is untouched by the failed request.
        assertEq(vault.balances(destination), 1e18);
    }

    /// @dev One user's release does not consume another user's reserve.
    function testTwoUsersReleaseIndependently() public {
        vm.deal(other, 1e18);
        vm.prank(other);
        vault.depositFor{value: 1e18}(other);

        uint64 sequence = 1;
        bytes32 requestId = keccak256(abi.encode(uint256(1301), destination, sequence));
        _release(requestId, 1e16, block.timestamp, sequence);

        assertEq(vault.balances(destination), 1e18 - 1.01e16);
        assertEq(vault.balances(other), 1e18);
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

    function testEnforcesPerSubAccountDailyLimit() public {
        vm.prank(owner);
        vault.setSubAccountDailyLimit(destination, 1);

        vm.prank(owner);
        vault.requestTopUp(destination, 1, 1e16);

        vm.prank(owner);
        vm.expectRevert("Daily request limit exceeded");
        vault.requestTopUp(destination, 2, 1e16);

        (uint64 count, uint256 day) = vault.getDailyRequestCount(destination);
        assertEq(count, 1);
        assertEq(day, block.timestamp / 86400);
    }

    function testDailyLimitResetsNextDay() public {
        vm.prank(owner);
        vault.setSubAccountDailyLimit(destination, 1);

        vm.prank(owner);
        vault.requestTopUp(destination, 1, 1e16);

        vm.warp(block.timestamp + 86400);

        vm.prank(owner);
        vault.requestTopUp(destination, 2, 1e16);

        (uint64 count,) = vault.getDailyRequestCount(destination);
        assertEq(count, 1);
    }

    function testOwnerCanChangeDefaultDailyLimit() public {
        vm.prank(owner);
        vault.setDefaultMaxDailyRequests(2);
        assertEq(vault.getEffectiveDailyLimit(destination), 2);

        // The protocol's per-user setting is a cap: it can only tighten.
        vm.prank(owner);
        vault.setSubAccountDailyLimit(destination, 1);
        assertEq(vault.getEffectiveDailyLimit(destination), 1);

        // A cap above the user's own limit never raises it.
        vm.prank(owner);
        vault.setSubAccountDailyLimit(destination, 5);
        assertEq(vault.getEffectiveDailyLimit(destination), 2);
    }

    /// @dev A user sets their own daily request cap — no owner involved.
    function testUserCanSetTheirOwnDailyRequestLimit() public {
        vm.prank(destination);
        vault.setMyDailyRequestLimit(25);

        assertEq(vault.userDailyRequestLimit(destination), 25);
        assertEq(vault.getEffectiveDailyLimit(destination), 25);
    }

    /// @dev The user's own cap cannot exceed the protocol ceiling.
    function testUserDailyLimitIsCappedByTheProtocolCeiling() public {
        vm.prank(owner);
        vault.setMaxDailyRequestsLimit(20);

        vm.prank(destination);
        vm.expectRevert("Invalid daily request limit");
        vault.setMyDailyRequestLimit(21);

        vm.prank(destination);
        vault.setMyDailyRequestLimit(20);
        assertEq(vault.getEffectiveDailyLimit(destination), 20);
    }

    /// @dev The protocol can always tighten a user's cap, never loosen it.
    function testProtocolCapOnlyTightensTheEffectiveLimit() public {
        vm.prank(destination);
        vault.setMyDailyRequestLimit(50);
        assertEq(vault.getEffectiveDailyLimit(destination), 50);

        vm.prank(owner);
        vault.setSubAccountDailyLimit(destination, 5);
        assertEq(vault.getEffectiveDailyLimit(destination), 5);
    }

    /// @dev A user may request a top-up for their own sub-account without
    /// any protocol owner transaction.
    function testUserCanRequestTheirOwnTopUp() public {
        vm.prank(destination);
        vault.requestTopUp(destination, 1, 1e16);

        bytes32 requestId = keccak256(abi.encode(uint256(1301), destination, uint64(1)));
        (bool settled, bool expired, uint256 amount) = vault.getRequestStatus(requestId);
        assertFalse(settled);
        assertFalse(expired);
        assertEq(amount, 1e16);
    }

    /// @dev A user may not request a top-up for somebody else.
    function testUserCannotRequestTopUpForAnotherUser() public {
        vm.prank(other);
        vm.expectRevert("Not authorized");
        vault.requestTopUp(destination, 1, 1e16);
    }

    /// @dev A user may expire their own stale request.
    function testUserCanExpireTheirOwnRequest() public {
        vm.prank(destination);
        vault.requestTopUp(destination, 1, 1e16);

        bytes32 requestId = keccak256(abi.encode(uint256(1301), destination, uint64(1)));
        vm.prank(destination);
        vault.expireRequest(requestId);

        (bool settled, bool expired,) = vault.getRequestStatus(requestId);
        assertFalse(settled);
        assertTrue(expired);
    }

    /// @dev But not somebody else's request.
    function testUserCannotExpireAnotherUsersRequest() public {
        vm.prank(destination);
        vault.requestTopUp(destination, 1, 1e16);

        bytes32 requestId = keccak256(abi.encode(uint256(1301), destination, uint64(1)));
        vm.prank(other);
        vm.expectRevert("Not authorized");
        vault.expireRequest(requestId);
    }
}
