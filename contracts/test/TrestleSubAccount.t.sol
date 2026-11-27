// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import "forge-std/Test.sol";
import "../src/TrestleSubAccount.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockFeeToken is ERC20 {
    constructor() ERC20("Fee Token", "FEE") {}

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}

contract TrestleSubAccountTest is Test {
    TrestleSubAccount public subAccount;
    address public owner = vm.addr(1);
    address public addr1 = vm.addr(2);
    address public other = vm.addr(4);

    function setUp() public {
        vm.startPrank(owner);
        subAccount = new TrestleSubAccount();
        vm.stopPrank();
    }

    /// @dev Funds a user's operational balance. A plain ETH transfer is
    /// credited to the sender, so each user's funds stay attributed.
    function _fund(address user, uint256 amount) internal {
        vm.deal(user, amount);
        vm.prank(user);
        (bool ok,) = address(subAccount).call{value: amount}("");
        require(ok, "funding failed");
    }

    function _create(address user, uint256 threshold, uint256 target, uint64 cooldown, uint64 maxDaily) internal {
        vm.prank(user);
        subAccount.createSubAccount(address(0xBEEF), threshold, target, cooldown, maxDaily);
    }

    function testDeployment() public {
        assertEq(subAccount.owner(), owner);
    }

    function testCreateSubAccount() public {
        address mainVault = address(0xBEEF);
        uint256 threshold = 5e15; // 0.005 ETH
        uint256 target = 1e16; // 0.01 ETH
        uint64 cooldown = 300;
        uint64 maxDaily = 10;

        vm.prank(owner);
        subAccount.createSubAccount(mainVault, threshold, target, cooldown, maxDaily);

        TrestleSubAccount.SubAccountConfig memory info = subAccount.getSubAccountInfo(owner);
        assertEq(info.mainVault, mainVault);
        assertEq(info.threshold, threshold);
        assertEq(info.target, target);
        assertEq(info.isActive, true);
    }

    /// @dev Onboarding must not require the protocol owner: any address can
    /// open its own sub-account.
    function testCreateSubAccountIsPermissionlessForSelf() public {
        vm.prank(other);
        subAccount.createSubAccount(address(0xBEEF), 5e15, 1e16, 300, 10);

        TrestleSubAccount.SubAccountConfig memory info = subAccount.getSubAccountInfo(other);
        assertTrue(info.isActive);
        assertEq(info.owner, other);
        // A user can never create a sub-account on someone else's behalf.
        assertFalse(subAccount.isSubAccountActive(owner));
    }

    function testOwnerCanCreateSubAccountOnBehalfOfUser() public {
        vm.prank(owner);
        subAccount.createSubAccountFor(other, address(0xBEEF), 5e15, 1e16, 300, 10);

        assertTrue(subAccount.isSubAccountActive(other));
        assertEq(subAccount.getSubAccountInfo(other).owner, other);
    }

    function testCreateSubAccountRevertsLowThreshold() public {
        vm.prank(owner);
        vm.expectRevert("Threshold too low");
        subAccount.createSubAccount(
            address(0),
            1e14, // below 1e15 minimum
            1e16,
            300,
            100
        );
    }

    function testNewSubAccountStartsWithZeroBalance() public {
        _create(owner, 5e15, 1e16, 300, 10);
        // Opening a sub-account must not mint a fictional balance.
        assertEq(subAccount.getVirtualBalance(owner), 0);
    }

    function testSpendEmitsLowBalanceDetected() public {
        _create(owner, 5e15, 1e16, 300, 100);
        _fund(owner, 6e15); // 0.006 ETH

        // Warp past cooldown
        vm.warp(block.timestamp + 301);

        address recipient = vm.addr(3);
        uint256 amount = 1e15; // 0.001 ETH spend

        // Spend: balance goes from 6e15 to 5e15, which is AT threshold (not below)
        // So no LowBalanceDetected event, but spend succeeds
        vm.prank(owner);
        subAccount.spend(owner, recipient, amount, address(0));

        // Verify balance decreased
        assertEq(address(subAccount).balance, 5e15);
        assertEq(subAccount.getVirtualBalance(owner), 5e15);
    }

    function testErc20FeeSpendReportsNativeBalanceShortage() public {
        _create(owner, 5e15, 1e16, 300, 100);

        MockFeeToken feeToken = new MockFeeToken();
        feeToken.mint(address(subAccount), 100e6);

        // The fee token is abundant, but the operational wallet is short of
        // native coin. The requested refill must be denominated in native ETH.
        _fund(owner, 4e15);
        vm.warp(block.timestamp + 301);

        vm.expectEmit(true, false, false, true, address(subAccount));
        // The indexed account is the caller (sub-account owner), which the
        // reactive guard uses as the subscription key.
        emit TrestleSubAccount.LowBalanceDetected(owner, 4e15, 1e16, 1);

        vm.prank(owner);
        subAccount.spend(owner, vm.addr(3), 1e6, address(feeToken));

        assertEq(address(subAccount).balance, 4e15);
        assertEq(subAccount.getVirtualBalance(owner), 4e15);
        assertEq(feeToken.balanceOf(address(subAccount)), 99e6);
    }

    /// @dev One user's balance must be unusable by another user.
    function testUserCannotSpendAnotherUsersBalance() public {
        _create(owner, 5e15, 1e16, 300, 100);
        _create(other, 5e15, 1e16, 300, 100);
        _fund(owner, 1e16);

        vm.prank(other);
        vm.expectRevert("Insufficient balance");
        subAccount.spend(other, vm.addr(3), 1e15, address(0));
    }

    /// @dev Each user's funds are tracked separately even though the
    /// registry holds the ETH physically.
    function testEachUserBalanceIsTrackedSeparately() public {
        _create(owner, 5e15, 1e16, 300, 100);
        _create(other, 5e15, 1e16, 300, 100);
        _fund(owner, 1e16);
        _fund(other, 2e16);

        assertEq(subAccount.getVirtualBalance(owner), 1e16);
        assertEq(subAccount.getVirtualBalance(other), 2e16);
        assertEq(address(subAccount).balance, 3e16);
    }

    function testSpendBelowThresholdEmitsEventWithTrackedBalance() public {
        _create(owner, 5e15, 1e16, 300, 100);
        _fund(owner, 6e15);
        vm.warp(block.timestamp + 301);

        vm.expectEmit(true, false, false, true, address(subAccount));
        emit TrestleSubAccount.LowBalanceDetected(owner, 4e15, 1e16, 1);

        vm.prank(owner);
        subAccount.spend(owner, vm.addr(3), 2e15, address(0));

        assertEq(subAccount.getVirtualBalance(owner), 4e15);
    }

    function testSpendRevertsDailyLimit() public {
        _create(owner, 5e15, 1e16, 300, 1); // maxDaily = 1 spend per day
        _fund(owner, 2e18);
        vm.warp(block.timestamp + 301);

        address recipient = vm.addr(3);

        vm.prank(owner);
        subAccount.spend(owner, recipient, 1e15, address(0));

        vm.warp(block.timestamp + 301);
        vm.prank(owner);
        vm.expectRevert("Daily limit exceeded");
        subAccount.spend(owner, recipient, 1e15, address(0));
    }

    function testDailyLimitResetsNextDay() public {
        _create(owner, 5e15, 1e16, 300, 1);
        _fund(owner, 2e18);
        vm.warp(block.timestamp + 301);

        address recipient = vm.addr(3);
        vm.prank(owner);
        subAccount.spend(owner, recipient, 1e15, address(0));

        TrestleSubAccount.SubAccountConfig memory info = subAccount.getSubAccountInfo(owner);
        assertEq(info.spendsToday, 1);
        assertEq(info.totalSpentToday, 1e15);

        vm.warp(block.timestamp + 86400 + 301);
        vm.prank(owner);
        subAccount.spend(owner, recipient, 1e15, address(0));

        info = subAccount.getSubAccountInfo(owner);
        assertEq(info.spendsToday, 1);
        assertEq(info.totalSpentToday, 1e15);
    }

    function testUpdateConfigRevertsTargetBelowThreshold() public {
        _create(owner, 5e15, 1e16, 300, 10);

        vm.prank(owner);
        vm.expectRevert("Target below threshold");
        subAccount.updateConfig(1e16, 1e15, 300, 10);
    }

    function testOwnerCanChangeLimits() public {
        vm.prank(owner);
        subAccount.setLimits(1e14, 60, 50);

        assertEq(subAccount.minThreshold(), 1e14);
        assertEq(subAccount.minCooldownPeriod(), 60);
        assertEq(subAccount.maxDailyLimit(), 50);

        vm.prank(owner);
        subAccount.createSubAccount(address(0), 1e14, 1e16, 60, 50);
    }

    function testUpdateConfig() public {
        _create(owner, 5e15, 1e16, 300, 10);

        vm.prank(owner);
        subAccount.updateConfig(1e16, 2e16, 600, 50);

        TrestleSubAccount.SubAccountConfig memory info = subAccount.getSubAccountInfo(owner);
        assertEq(info.threshold, 1e16);
        assertEq(info.target, 2e16);
        assertEq(info.cooldown, 600);
        assertEq(info.maxDaily, 50);
    }

    /// @dev A user's config is keyed by their own address, so a user can only
    /// ever change their own settings.
    function testUserCanOnlyUpdateTheirOwnConfig() public {
        _create(owner, 5e15, 1e16, 300, 10);
        _create(other, 5e15, 1e16, 300, 10);

        vm.prank(other);
        subAccount.updateConfig(9e15, 9e16, 300, 10);

        assertEq(subAccount.getSubAccountInfo(other).threshold, 9e15);
        assertEq(subAccount.getSubAccountInfo(owner).threshold, 5e15);
    }

    /// @dev A user funds their own operational balance with real ETH.
    function testDepositTopUpCreditsTheSender() public {
        _create(owner, 5e15, 1e16, 300, 10);

        vm.deal(owner, 1e16);
        vm.prank(owner);
        subAccount.depositTopUp{value: 1e16}();

        assertEq(subAccount.getVirtualBalance(owner), 1e16);
        assertEq(address(subAccount).balance, 1e16);
    }

    /// @dev A balance can never be credited without backing ETH. The old
    /// `receiveTopUp(caller, amount)` credited an arbitrary amount without
    /// receiving any ETH, which let a user mint credit against funds
    /// belonging to other users.
    function testBalanceCannotBeCreditedWithoutBackingEth() public {
        _create(owner, 5e15, 1e16, 300, 10);
        _create(other, 5e15, 1e16, 300, 10);

        // Another user parks real ETH in the registry.
        _fund(other, 1e16);

        // `owner` has no ETH of their own and cannot manufacture credit.
        vm.deal(owner, 0);
        vm.prank(owner);
        vm.expectRevert("Amount must be positive");
        subAccount.depositTopUp{value: 0}();

        vm.prank(owner);
        vm.expectRevert("Insufficient balance");
        subAccount.spend(owner, vm.addr(3), 1e15, address(0));

        // The other user's funds are untouched.
        assertEq(subAccount.getVirtualBalance(other), 1e16);
        assertEq(address(subAccount).balance, 1e16);
    }

    /// @dev A deposit needs an existing sub-account, so funds can never be
    /// stranded in a balance the user can never spend.
    function testDepositRequiresAnActiveSubAccount() public {
        vm.deal(other, 1e16);
        vm.prank(other);
        vm.expectRevert("Sub-account not active");
        subAccount.depositTopUp{value: 1e16}();
    }

    /// @dev The bridge credits the user named in the cross-chain payload, not
    /// a single globally configured account.
    function testBridgeTopUpCreditsTheNamedUser() public {
        address receiver = vm.addr(9);
        vm.prank(owner);
        subAccount.setBridgeCreditor(receiver);

        _create(owner, 5e15, 1e16, 300, 10);
        _create(other, 5e15, 1e16, 300, 10);

        vm.deal(receiver, 1e16);
        vm.prank(receiver);
        subAccount.receiveTopUpFromBridge{value: 1e16}(1e16, other);

        assertEq(subAccount.getVirtualBalance(other), 1e16);
        assertEq(subAccount.getVirtualBalance(owner), 0);
    }

    function testBridgeTopUpRejectsNonBridgeCaller() public {
        address receiver = vm.addr(9);
        vm.prank(owner);
        subAccount.setBridgeCreditor(receiver);

        _create(owner, 5e15, 1e16, 300, 10);

        vm.deal(other, 1e16);
        vm.prank(other);
        vm.expectRevert("Not bridge");
        subAccount.receiveTopUpFromBridge{value: 1e16}(1e16, owner);
    }

    /// @dev A user can turn their own auto-topup off without the owner.
    function testUserCanDeactivateTheirOwnSubAccount() public {
        _create(owner, 5e15, 1e16, 300, 10);

        assertTrue(subAccount.isSubAccountActive(owner));

        vm.prank(owner);
        subAccount.deactivate();

        assertEq(subAccount.isSubAccountActive(owner), false);
    }

    /// @dev And turn it back on again.
    function testUserCanReactivateTheirOwnSubAccount() public {
        _create(owner, 5e15, 1e16, 300, 10);

        vm.prank(owner);
        subAccount.deactivate();
        vm.prank(owner);
        subAccount.activate();

        assertTrue(subAccount.isSubAccountActive(owner));
    }

    /// @dev The protocol kill switch can stop any user's auto-topup.
    function testOwnerCanDeactivateAnyUser() public {
        _create(other, 5e15, 1e16, 300, 10);

        vm.prank(owner);
        subAccount.deactivateFor(other);

        assertFalse(subAccount.isSubAccountActive(other));
    }

    /// @dev A user withdraws their own unspent operational balance.
    function testUserCanWithdrawTheirOwnOperationalBalance() public {
        _create(owner, 5e15, 1e16, 300, 10);
        _fund(owner, 1e16);

        vm.prank(owner);
        subAccount.withdraw(4e15);

        assertEq(subAccount.getVirtualBalance(owner), 6e15);
        assertEq(owner.balance, 4e15);
    }

    /// @dev No user — including the protocol owner — can withdraw another
    /// user's operational balance.
    function testUserCannotWithdrawAnotherUsersOperationalBalance() public {
        _create(other, 5e15, 1e16, 300, 10);
        _fund(other, 1e16);

        // A different user cannot touch it.
        vm.prank(addr1);
        vm.expectRevert("Insufficient balance");
        subAccount.withdraw(1e15);

        // And neither can the protocol owner.
        vm.prank(owner);
        vm.expectRevert("Insufficient balance");
        subAccount.withdraw(1e15);
    }

    /// @dev The protocol owner can never spend a user's funds.
    function testOwnerCannotSpendUserFunds() public {
        _create(other, 5e15, 1e16, 300, 10);
        _fund(other, 1e16);

        vm.prank(owner);
        vm.expectRevert("Not authorized for user");
        subAccount.spend(other, vm.addr(3), 1e15, address(0));
    }

    /// @dev An operator the user approved spends from the USER's balance,
    /// not from the operator's own.
    function testOperatorCanSpendForUser() public {
        _create(owner, 5e15, 1e16, 300, 10);
        _fund(owner, 1e16);

        vm.prank(owner);
        subAccount.setOperator(other, true);
        assertTrue(subAccount.operators(owner, other));

        vm.prank(other);
        subAccount.spend(owner, vm.addr(3), 2e15, address(0));

        assertEq(subAccount.getVirtualBalance(owner), 8e15);
        assertEq(subAccount.getVirtualBalance(other), 0);
    }

    /// @dev An operator for one user cannot touch any other user.
    function testOperatorCannotSpendForAnotherUser() public {
        address thirdUser = vm.addr(8);
        _create(other, 5e15, 1e16, 300, 10);
        _create(thirdUser, 5e15, 1e16, 300, 10);
        _fund(other, 1e16);
        _fund(thirdUser, 1e16);

        // `other` approves `addr1` as an operator.
        vm.prank(other);
        subAccount.setOperator(addr1, true);

        // The operator may act for `other`...
        vm.prank(addr1);
        subAccount.spend(other, vm.addr(3), 1e15, address(0));
        assertEq(subAccount.getVirtualBalance(other), 9e15);

        // ...but not for anybody else.
        vm.prank(addr1);
        vm.expectRevert("Not authorized for user");
        subAccount.spend(thirdUser, vm.addr(3), 1e15, address(0));

        // The third user's funds are untouched.
        assertEq(subAccount.getVirtualBalance(thirdUser), 1e16);
    }

    /// @dev A user revokes their operator.
    function testUserCanRevokeOperator() public {
        _create(owner, 5e15, 1e16, 300, 10);
        _fund(owner, 1e16);

        vm.prank(owner);
        subAccount.setOperator(other, true);
        vm.prank(owner);
        subAccount.setOperator(other, false);

        vm.prank(other);
        vm.expectRevert("Not authorized for user");
        subAccount.spend(owner, vm.addr(3), 1e15, address(0));
    }

    /// @dev The protocol owner can never change a user's settings.
    function testOwnerCannotUpdateAnotherUsersConfig() public {
        _create(other, 5e15, 1e16, 300, 10);

        vm.prank(owner);
        vm.expectRevert("Not authorized for user");
        subAccount.updateConfigFor(other, 9e15, 9e16, 300, 10);

        assertEq(subAccount.getSubAccountInfo(other).threshold, 5e15);
    }

    /// @dev An operator the user approved can configure on their behalf.
    function testOperatorCanUpdateUserConfig() public {
        _create(owner, 5e15, 1e16, 300, 10);

        vm.prank(owner);
        subAccount.setOperator(other, true);

        vm.prank(other);
        subAccount.updateConfigFor(owner, 7e15, 3e16, 600, 25);

        TrestleSubAccount.SubAccountConfig memory info = subAccount.getSubAccountInfo(owner);
        assertEq(info.threshold, 7e15);
        assertEq(info.target, 3e16);
        assertEq(info.cooldown, 600);
        assertEq(info.maxDaily, 25);
    }
}
