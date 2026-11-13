// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import "forge-std/Test.sol";
import "../src/TrestleMainVault.sol";

contract TrestleMainVaultTest is Test {
    TrestleMainVault public mainVault;
    address public owner = vm.addr(1);
    address public addr1 = vm.addr(2); // reactive contract
    address public addr2 = vm.addr(3); // unauthorized
    
    function setUp() public {
        vm.startPrank(owner);
        mainVault = new TrestleMainVault();
        vm.stopPrank();
    }
    
    function testDeployment() public {
        assertEq(mainVault.owner(), owner);
        assertEq(mainVault.reactiveContract(), owner); // owner is initial reactive contract
    }
    
    function testRequestTopUp() public {
        vm.startPrank(owner);
        address subAccount = vm.addr(4);
        uint256 amount = 1e16; // 0.01 ETH
        
        mainVault.requestTopUp(subAccount, amount);
        vm.stopPrank();
    }
    
    function testRequestTopUpRevertsTooSmall() public {
        vm.startPrank(owner);
        address subAccount = vm.addr(4);
        uint256 amount = 1e14; // below 1e15 minimum
        
        vm.expectRevert("Amount too small");
        mainVault.requestTopUp(subAccount, amount);
        vm.stopPrank();
    }
    
    function testReleaseTopupByReactiveContract() public {
        vm.startPrank(owner);
        address subAccount = vm.addr(4);
        uint256 amount = 1e16;
        
        // Fund the vault
        vm.deal(address(mainVault), 1e17);
        
        // Request top-up
        mainVault.requestTopUp(subAccount, amount);
        
        // Get the requestId
        bytes32[] memory requests = mainVault.getSubAccountRequests(subAccount);
        bytes32 requestId = requests[0];
        
        // Set reactive contract to addr1
        mainVault.setReactiveContract(addr1);
        
        // Release top-up via reactive contract
        vm.startPrank(addr1);
        mainVault.releaseTopup(requestId, subAccount, amount);
        
        // Verify settled
        (bool settled, bool expired, uint256 reqAmount) = mainVault.getRequestStatus(requestId);
        assertEq(settled, true);
        assertEq(expired, false);
        assertEq(reqAmount, amount);
        
        vm.stopPrank();
        vm.stopPrank();
    }
    
    function testReleaseTopupRevertsUnauthorized() public {
        vm.startPrank(owner);
        address subAccount = vm.addr(4);
        uint256 amount = 1e16;
        
        mainVault.requestTopUp(subAccount, amount);
        
        bytes32[] memory requests = mainVault.getSubAccountRequests(subAccount);
        bytes32 requestId = requests[0];
        
        // Unauthorized caller tries to release
        vm.startPrank(addr2);
        vm.expectRevert("Not reactive contract");
        mainVault.releaseTopup(requestId, subAccount, amount);
        
        vm.stopPrank();
        vm.stopPrank();
    }
    
    function testReleaseTopupRevertsExpired() public {
        vm.startPrank(owner);
        address subAccount = vm.addr(4);
        uint256 amount = 1e16;
        
        vm.deal(address(mainVault), 1e17);
        
        mainVault.requestTopUp(subAccount, amount);
        
        bytes32[] memory requests = mainVault.getSubAccountRequests(subAccount);
        bytes32 requestId = requests[0];
        
        mainVault.setReactiveContract(addr1);
        
        // Fast forward past expiry (3600 seconds)
        vm.warp(block.timestamp + 3601);
        
        vm.startPrank(addr1);
        mainVault.releaseTopup(requestId, subAccount, amount);
        
        vm.stopPrank();
        vm.stopPrank();
    }
    
    function testSetReactiveContract() public {
        vm.startPrank(owner);
        assertEq(mainVault.reactiveContract(), owner);
        
        mainVault.setReactiveContract(addr1);
        assertEq(mainVault.reactiveContract(), addr1);
        vm.stopPrank();
    }
}