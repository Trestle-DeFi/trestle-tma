// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract TrestleSubAccount is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    event LowBalanceDetected(address indexed subAccount, uint256 currentBalance, uint256 targetTopUp, uint64 sequence);
    event SubAccountCreated(address indexed subAccount, address mainVault);
    event SubAccountUpdated(address indexed subAccount, uint256 newThreshold);
    event SpendRequested(address indexed subAccount, uint256 amount, address indexed recipient);
    event TopUpReceived(address indexed subAccount, uint256 amount);
    event SubAccountDeactivated(address indexed subAccount);
    event BridgeCreditorUpdated(address indexed bridgeCreditor);

    struct SubAccountConfig {
        address mainVault;
        address owner;
        uint256 threshold;
        uint256 target;
        uint64 cooldown;
        uint64 maxDaily;
        uint64 sequence;
        uint64 spendsToday;
        uint256 totalSpentToday;
        uint256 lastSpendDay;
        bool isActive;
        uint256 createdAt;
        uint256 lastTopUpTime;
    }

    mapping(address => SubAccountConfig) public subAccounts;
    mapping(address => uint256) public virtualBalances;
    mapping(address => bool) public authorizedOperators;
    address public bridgeCreditor;
    address public bridgeCreditAccount;

    uint256 public constant MIN_THRESHOLD = 1e15;
    uint64 public constant COOLDOWN_PERIOD = 300;
    uint64 public constant MAX_DAILY_LIMIT = 1000;

    uint256 public minThreshold = MIN_THRESHOLD;
    uint64 public minCooldownPeriod = COOLDOWN_PERIOD;
    uint64 public maxDailyLimit = MAX_DAILY_LIMIT;

    event LimitsUpdated(uint256 minThreshold, uint64 minCooldownPeriod, uint64 maxDailyLimit);

    modifier onlyAuthorized() {
        require(authorizedOperators[msg.sender] || msg.sender == owner(), "Not authorized");
        _;
    }

    constructor() Ownable(msg.sender) {
        authorizedOperators[msg.sender] = true;
    }

    function setLimits(uint256 _minThreshold, uint64 _minCooldownPeriod, uint64 _maxDailyLimit) external onlyOwner {
        require(_minThreshold > 0, "Invalid minimum threshold");
        require(_minCooldownPeriod > 0, "Invalid minimum cooldown");
        require(_maxDailyLimit > 0, "Invalid maximum daily limit");
        minThreshold = _minThreshold;
        minCooldownPeriod = _minCooldownPeriod;
        maxDailyLimit = _maxDailyLimit;
        emit LimitsUpdated(_minThreshold, _minCooldownPeriod, _maxDailyLimit);
    }

    function createSubAccount(
        address _mainVault,
        uint256 _threshold,
        uint256 _target,
        uint64 _cooldown,
        uint64 _maxDaily
    ) external onlyOwner {
        require(_threshold >= minThreshold, "Threshold too low");
        require(_target > _threshold, "Target below threshold");
        require(_cooldown >= minCooldownPeriod, "Cooldown too short");
        require(_maxDaily > 0 && _maxDaily <= maxDailyLimit, "Invalid max daily limit");
        require(subAccounts[msg.sender].isActive == false, "Sub-account exists");

        subAccounts[msg.sender] = SubAccountConfig({
            mainVault: _mainVault,
            owner: msg.sender,
            threshold: _threshold,
            target: _target,
            cooldown: _cooldown,
            maxDaily: _maxDaily,
            sequence: 0,
            spendsToday: 0,
            totalSpentToday: 0,
            lastSpendDay: block.timestamp / 86400,
            isActive: true,
            createdAt: block.timestamp,
            lastTopUpTime: block.timestamp
        });

        virtualBalances[msg.sender] = _target;
        authorizedOperators[msg.sender] = true;
        if (bridgeCreditAccount == address(0)) bridgeCreditAccount = msg.sender;
        emit SubAccountCreated(msg.sender, _mainVault);
    }

    function spend(address recipient, uint256 amount, address token) external onlyAuthorized nonReentrant {
        require(amount > 0, "Amount must be positive");
        address subAccount = msg.sender;
        SubAccountConfig storage config = subAccounts[subAccount];
        require(config.isActive, "Sub-account not active");
        require(block.timestamp >= config.lastTopUpTime + config.cooldown, "Cooldown active");
        _rollSpendDay(config);
        require(config.spendsToday < config.maxDaily, "Daily limit exceeded");
        config.sequence++;
        config.spendsToday++;
        config.totalSpentToday += amount;
        if (token == address(0)) {
            require(address(this).balance >= amount, "Insufficient ETH balance");
            payable(recipient).transfer(amount);
        } else {
            require(IERC20(token).balanceOf(address(this)) >= amount, "Insufficient token balance");
            IERC20(token).safeTransfer(recipient, amount);
        }
        // The refill asset is the sub-account's native coin. The token argument
        // identifies the fee/payment asset, but the balance being monitored is
        // always native coin so the operational wallet can pay future fees.
        uint256 currentBalance = address(this).balance;
        if (currentBalance < config.threshold) {
            // The indexed account must be the sub-account owner/operator, not
            // address(this): the reactive guard keys its per-account
            // subscription on this field and watches the contract address as
            // the log origin.
            emit LowBalanceDetected(subAccount, currentBalance, config.target, config.sequence);
        }
        emit SpendRequested(subAccount, amount, recipient);
    }

    function _rollSpendDay(SubAccountConfig storage config) internal {
        uint256 day = block.timestamp / 86400;
        if (config.lastSpendDay != day) {
            config.lastSpendDay = day;
            config.spendsToday = 0;
            config.totalSpentToday = 0;
        }
    }

    function updateConfig(uint256 newThreshold, uint256 newTarget, uint64 newCooldown, uint64 newMaxDaily)
        external
        onlyAuthorized
    {
        require(newThreshold >= minThreshold, "Threshold too low");
        require(newTarget > newThreshold, "Target below threshold");
        require(newCooldown >= minCooldownPeriod, "Cooldown too short");
        require(newMaxDaily > 0 && newMaxDaily <= maxDailyLimit, "Invalid max daily limit");
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

    /// @notice Credits a native-coin top-up delivered by the configured
    /// cross-chain receiver. The receiver must send exactly the credited
    /// amount with the call.
    function receiveTopUpFromBridge(uint256 amount) external payable {
        require(msg.sender == bridgeCreditor && bridgeCreditor != address(0), "Not bridge");
        require(amount > 0 && msg.value == amount, "Invalid top-up amount");
        address account = bridgeCreditAccount;
        require(account != address(0), "Bridge account not configured");
        require(subAccounts[account].isActive, "Sub-account not active");
        subAccounts[account].lastTopUpTime = block.timestamp;
        virtualBalances[account] += amount;
        emit TopUpReceived(account, amount);
    }

    function setBridgeCreditor(address creditor) external onlyOwner {
        bridgeCreditor = creditor;
        emit BridgeCreditorUpdated(creditor);
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
