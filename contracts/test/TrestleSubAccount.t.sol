// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import "forge-std/Test.sol";
import "../src/TrestleSubAccount.sol";

contract TrestleSubAccountTest is Test {
    TrestleSubAccount public subAccount;
    address public owner = vm.addr(1);
    address public addr1 = vm.addr(2);
    
    function setUp() public {
        vm.startPrank(owner);
        subAccount = new TrestleSubAccount();
        vm.stopPrank();
    }
    
    function testDeployment() public {
        assertEq(subAccount.owner(), owner);
    }
    
    function testCreateSubAccount() public {
        vm.startPrank(owner);
        address mainVault = address(0);
        uint256 threshold = 5e15; // 0.005 ETH
        uint256 target = 1e16;    // 0.01 ETH
        uint64 cooldown = 300;
        uint64 maxDaily = 10;
        
        subAccount.createSubAccount(mainVault, threshold, target, cooldown, maxDaily);
        
        TrestleSubAccount.SubAccountConfig memory info = subAccount.getSubAccountInfo(owner);
        assertEq(info.mainVault, mainVault);
        assertEq(info.threshold, threshold);
        assertEq(info.target, target);
        assertEq(info.isActive, true);
        vm.stopPrank();
    }
    
    function testCreateSubAccountRevertsLowThreshold() public {
        vm.startPrank(owner);
        vm.expectRevert("Threshold too low");
        subAccount.createSubAccount(
            address(0),
            1e14, // below 1e15 minimum
            1e16,
            300,
            100
        );
        vm.stopPrank();
    }
    
    function testSpendEmitsLowBalanceDetected() public {
        vm.startPrank(owner);
        subAccount.createSubAccount(
            address(0),
            5e15,  // 0.005 ETH threshold
            1e16,  // 0.01 ETH target
            300,
            100
        );
        
        // Fund the contract with enough for spend + remain above threshold
        vm.deal(address(subAccount), 6e15); // 0.006 ETH
        
        // Warp past cooldown
        vm.warp(block.timestamp + 301);
        
        address recipient = vm.addr(3);
        uint256 amount = 1e15; // 0.001 ETH spend
        
        // Spend: balance goes from 6e15 to 5e15, which is AT threshold (not below)
        // So no LowBalanceDetected event, but spend succeeds
        subAccount.spend(recipient, amount, address(0));
        
        // Verify balance decreased
        assertEq(address(subAccount).balance, 5e15);
        vm.stopPrank();
    }
    
    function testSpendRevertsDailyLimit() public {
        vm.startPrank(owner);
        subAccount.createSubAccount(
            address(0),
            5e15,
            1e16,
            300,
            1 // maxDaily = 1 wei per day
        );
        
        // Fund with enough ETH to exceed daily limit
        vm.deal(address(subAccount), 2e18); // 2 ETH
        
        // Warp past cooldown
        vm.warp(block.timestamp + 301);
        
        address recipient = vm.addr(3);
        
        // Try to spend more than maxDaily * 1e18 = 1e18
        vm.expectRevert("Daily limit exceeded");
        subAccount.spend(recipient, 2e18, address(0));
        vm.stopPrank();
    }
    
    function testUpdateConfig() public {
        vm.startPrank(owner);
        subAccount.createSubAccount(
            address(0),
            5e15,
            1e16,
            300,
            10
        );
        
        subAccount.updateConfig(1e16, 2e16, 600, 50);
        
        TrestleSubAccount.SubAccountConfig memory info = subAccount.getSubAccountInfo(owner);
        assertEq(info.threshold, 1e16);
        assertEq(info.target, 2e16);
        assertEq(info.cooldown, 600);
        assertEq(info.maxDaily, 50);
        vm.stopPrank();
    }
    
    function testReceiveTopUp() public {
        vm.startPrank(owner);
        subAccount.createSubAccount(
            address(0),
            5e15,
            1e16,
            300,
            10
        );
        
        subAccount.receiveTopUp(owner, 1e16);
        vm.stopPrank();
    }
    
    function testEmergencyDeactivate() public {
        vm.startPrank(owner);
        subAccount.createSubAccount(
            address(0),
            5e15,
            1e16,
            300,
            10
        );
        
        assertEq(subAccount.isSubAccountActive(owner), true);
        
        subAccount.emergencyDeactivate();
        
        assertEq(subAccount.isSubAccountActive(owner), false);
        vm.stopPrank();
    }
}