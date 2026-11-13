// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import "forge-std/Test.sol";
import "../src/TrestleReactiveGuard.sol";

contract TrestleReactiveGuardTest is Test {
    TrestleReactiveGuard public reactiveGuard;
    address public owner = vm.addr(1);
    address public addr1 = vm.addr(2);
    address public addr2 = vm.addr(3);

    function setUp() public {
        vm.startPrank(owner);
        reactiveGuard = new TrestleReactiveGuard();
        reactiveGuard.setReactiveSender(owner);
        vm.stopPrank();
    }

    function testDeployment() public {
        assertEq(reactiveGuard.owner(), owner);
        assertEq(reactiveGuard.reactiveSender(), owner);
    }

    function testSetupSubscription() public {
        vm.startPrank(owner);
        address subAccount = vm.addr(4);
        address mainVault = vm.addr(5);
        string memory callbackUrl = "https://callback.trestle.website";
        uint64 maxDailyRefills = 10;

        reactiveGuard.setupSubscription(subAccount, mainVault, callbackUrl, maxDailyRefills);

        TrestleReactiveGuard.Subscription memory sub = reactiveGuard.getSubscriptionStatus(subAccount);
        assertEq(sub.subAccount, subAccount);
        assertEq(sub.mainVault, mainVault);
        assertEq(sub.isActive, true);
        assertEq(sub.maxDailyRefills, maxDailyRefills);
        vm.stopPrank();
    }

    function testSetupSubscriptionRevertsMainVaultZero() public {
        vm.startPrank(owner);
        address subAccount = vm.addr(4);
        address mainVault = address(0);
        string memory callbackUrl = "https://callback.trestle.website";

        vm.expectRevert("Main vault required");
        reactiveGuard.setupSubscription(subAccount, mainVault, callbackUrl, 10);
        vm.stopPrank();
    }

    function testReactRevertsUnauthorizedSender() public {
        vm.startPrank(addr2);
        address subAccount = vm.addr(4);

        bytes memory eventData = abi.encode(
            subAccount,
            5e15,
            1e16,
            uint64(1)
        );

        vm.expectRevert("Not authorized reactive sender");
        reactiveGuard.react(eventData);
        vm.stopPrank();
    }

    function testReactComputesRefillToTarget() public {
        vm.startPrank(owner);
        address subAccount = vm.addr(4);
        address mainVault = vm.addr(5);
        string memory callbackUrl = "https://callback.trestle.website";

        reactiveGuard.setupSubscription(subAccount, mainVault, callbackUrl, 10);

        uint256 currentBalance = 5e15;
        uint256 targetTopUp = 1e16;

        bytes memory eventData = abi.encode(
            subAccount,
            currentBalance,
            targetTopUp,
            uint64(1)
        );

        // Warp past cooldown (5 blocks)
        vm.roll(block.number + 10);

        vm.startPrank(owner);
        reactiveGuard.react(eventData);

        TrestleReactiveGuard.Subscription memory sub = reactiveGuard.getSubscriptionStatus(subAccount);
        assertEq(sub.dailyRefillCount, 1);

        vm.stopPrank();
        vm.stopPrank();
    }

    function testReactRevertsDailyLimit() public {
        vm.startPrank(owner);
        address subAccount = vm.addr(4);
        address mainVault = vm.addr(5);
        string memory callbackUrl = "https://callback.trestle.website";

        reactiveGuard.setupSubscription(subAccount, mainVault, callbackUrl, 1);

        bytes memory eventData1 = abi.encode(
            subAccount,
            5e15,
            1e16,
            uint64(1)
        );

        // Warp past cooldown
        vm.roll(block.number + 10);
        vm.startPrank(owner);
        reactiveGuard.react(eventData1);
        vm.stopPrank();

        bytes memory eventData2 = abi.encode(
            subAccount,
            5e15,
            1e16,
            uint64(2)
        );

        // Warp past cooldown again
        vm.roll(block.number + 10);
        vm.startPrank(owner);
        vm.expectRevert("Daily refill limit reached");
        reactiveGuard.react(eventData2);
        vm.stopPrank();

        vm.stopPrank();
    }

    function testReactRevertsCooldown() public {
        vm.startPrank(owner);
        address subAccount = vm.addr(4);
        address mainVault = vm.addr(5);
        string memory callbackUrl = "https://callback.trestle.website";

        reactiveGuard.setupSubscription(subAccount, mainVault, callbackUrl, 10);

        bytes memory eventData1 = abi.encode(
            subAccount,
            5e15,
            1e16,
            uint64(1)
        );

        // Warp past cooldown
        vm.roll(block.number + 10);
        vm.startPrank(owner);
        reactiveGuard.react(eventData1);
        vm.stopPrank();

        bytes memory eventData2 = abi.encode(
            subAccount,
            5e15,
            1e16,
            uint64(2)
        );

        // Don't warp - cooldown should still be active (same block)
        vm.startPrank(owner);
        vm.expectRevert("Cooldown period active");
        reactiveGuard.react(eventData2);
        vm.stopPrank();

        vm.stopPrank();
    }

    function testUpdateSubscription() public {
        vm.startPrank(owner);
        address subAccount = vm.addr(4);
        address mainVault = vm.addr(5);
        string memory callbackUrl = "https://callback.trestle.website";

        reactiveGuard.setupSubscription(subAccount, mainVault, callbackUrl, 10);

        reactiveGuard.updateSubscription(subAccount, false, 10);

        TrestleReactiveGuard.Subscription memory sub = reactiveGuard.getSubscriptionStatus(subAccount);
        assertEq(sub.isActive, false);
        vm.stopPrank();
    }

    function testSetReactiveSender() public {
        vm.startPrank(owner);
        assertEq(reactiveGuard.reactiveSender(), owner);

        reactiveGuard.setReactiveSender(addr1);
        assertEq(reactiveGuard.reactiveSender(), addr1);
        assertEq(reactiveGuard.isAuthorizedReactive(addr1), true);
        vm.stopPrank();
    }
}
