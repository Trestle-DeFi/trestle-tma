// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract TrestleSubAccount is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    event LowBalanceDetected(
        address indexed subAccount,
        uint256 currentBalance,
        uint256 targetTopUp,
        uint64 sequence
    );
    event SubAccountCreated(address indexed subAccount, address mainVault);
    event SubAccountUpdated(address indexed subAccount, uint256 newThreshold);
    event SpendRequested(address indexed subAccount, uint256 amount, address indexed recipient);
    event TopUpReceived(address indexed subAccount, uint256 amount);
    event SubAccountDeactivated(address indexed subAccount);

    struct SubAccountConfig {
        address mainVault;
        uint256 threshold;
        uint256 target;
        uint64 cooldown;
        uint64 maxDaily;
        uint64 sequence;
        uint256 totalSpentToday;
        bool isActive;
        uint256 createdAt;
        uint256 lastTopUpTime;
    }

    mapping(address => SubAccountConfig) public subAccounts;
    mapping(address => uint256) public virtualBalances;
    mapping(address => bool) public authorizedOperators;

    uint256 public constant MIN_THRESHOLD = 1e15;
    uint64 public constant COOLDOWN_PERIOD = 300;
    uint64 public constant MAX_DAILY_LIMIT = 1000;

    modifier onlyAuthorized() {
        require(authorizedOperators[msg.sender] || msg.sender == owner(), "Not authorized");
        _;
    }

    constructor() Ownable(msg.sender) {
        authorizedOperators[msg.sender] = true;
    }

    function createSubAccount(
        address _mainVault,
        uint256 _threshold,
        uint256 _target,
        uint64 _cooldown,
        uint64 _maxDaily
    ) external onlyOwner {
        require(_threshold >= MIN_THRESHOLD, "Threshold too low");
        require(_cooldown >= COOLDOWN_PERIOD, "Cooldown too short");
        require(_maxDaily > 0 && _maxDaily <= MAX_DAILY_LIMIT, "Invalid max daily limit");
        require(subAccounts[msg.sender].isActive == false, "Sub-account exists");

        subAccounts[msg.sender] = SubAccountConfig({
            mainVault: _mainVault,
            threshold: _threshold,
            target: _target,
            cooldown: _cooldown,
            maxDaily: _maxDaily,
            sequence: 0,
            totalSpentToday: 0,
            isActive: true,
            createdAt: block.timestamp,
            lastTopUpTime: block.timestamp
        });

        virtualBalances[msg.sender] = _target;
        authorizedOperators[msg.sender] = true;
        emit SubAccountCreated(msg.sender, _mainVault);
    }
    function spend(
        address recipient,
        uint256 amount,
        address token
    ) external onlyAuthorized nonReentrant {
        require(amount > 0, "Amount must be positive");
        address subAccount = msg.sender;
        SubAccountConfig storage config = subAccounts[subAccount];
        require(config.isActive, "Sub-account not active");
        require(block.timestamp >= config.lastTopUpTime + config.cooldown, "Cooldown active");
        require(config.totalSpentToday + amount <= uint256(config.maxDaily) * 1e18, "Daily limit exceeded");
        config.sequence++;
        config.totalSpentToday += amount;
        if (token == address(0)) {
            require(address(this).balance >= amount, "Insufficient ETH balance");
            payable(recipient).transfer(amount);
        } else {
            require(IERC20(token).balanceOf(address(this)) >= amount, "Insufficient token balance");
            IERC20(token).safeTransfer(recipient, amount);
        }
        uint256 currentBalance = token == address(0)
            ? address(this).balance
            : IERC20(token).balanceOf(address(this));
        if (currentBalance < config.threshold) {
            emit LowBalanceDetected(
                subAccount,
                currentBalance,
                config.target - currentBalance,
                config.sequence
            );
        }
        emit SpendRequested(subAccount, amount, recipient);
    }

    function updateConfig(
        uint256 newThreshold,
        uint256 newTarget,
        uint64 newCooldown,
        uint64 newMaxDaily
    ) external onlyAuthorized {
        require(newThreshold >= MIN_THRESHOLD, "Threshold too low");
        require(newCooldown >= COOLDOWN_PERIOD, "Cooldown too short");
        require(newMaxDaily > 0 && newMaxDaily <= MAX_DAILY_LIMIT, "Invalid max daily limit");
        SubAccountConfig storage config = subAccounts[msg.sender];
        config.threshold = newThreshold;
        config.target = newTarget;
        config.cooldown = newCooldown;
        config.maxDaily = newMaxDaily;
        emit SubAccountUpdated(msg.sender, newThreshold);
    }

    function receiveTopUp(address caller, uint256 amount) external {
        require(caller == owner() || authorizedOperators[caller], "Not authorized caller");
        require(amount > 0, "Amount must be positive");
        address subAccount = msg.sender;
        SubAccountConfig storage config = subAccounts[subAccount];
        require(config.isActive, "Sub-account not active");
        config.lastTopUpTime = block.timestamp;
        virtualBalances[subAccount] += amount;
        emit TopUpReceived(subAccount, amount);
    }

    function emergencyDeactivate() external onlyOwner {
        SubAccountConfig storage config = subAccounts[msg.sender];
        require(config.isActive, "Already deactivated");
        config.isActive = false;
        emit SubAccountDeactivated(msg.sender);
    }

    function getSubAccountInfo(address subAccount) external view returns (SubAccountConfig memory) {
        return subAccounts[subAccount];
    }

    function getVirtualBalance(address subAccount) external view returns (uint256) {
        return virtualBalances[subAccount];
    }

    function isSubAccountActive(address subAccount) external view returns (bool) {
        return subAccounts[subAccount].isActive;
    }

    receive() external payable {}
    fallback() external payable {}
}