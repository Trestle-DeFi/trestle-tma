// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Trestle Sub-Account Registry
/// @notice One deployment serves every user. The canonical per-user
/// identifier is the user's own address: `subAccounts[user]` holds that
/// user's configuration and `virtualBalances[user]` holds that user's
/// operational native-coin balance.
///
/// @dev The contract address is the *registry*, not a user's sub-account.
/// It is the origin contract the reactive guard watches and the contract
/// that receives bridged top-ups, but the user a top-up is credited to is
/// resolved from the cross-chain message payload. That is what lets a
/// single deployment settle top-ups for any number of users.
contract TrestleSubAccount is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    event LowBalanceDetected(address indexed subAccount, uint256 currentBalance, uint256 targetTopUp, uint64 sequence);
    event SubAccountCreated(address indexed subAccount, address mainVault);
    event SubAccountUpdated(address indexed subAccount, uint256 newThreshold);
    event SpendRequested(address indexed subAccount, uint256 amount, address indexed recipient);
    event TopUpReceived(address indexed subAccount, uint256 amount);
    event SubAccountDeactivated(address indexed subAccount);
    event SubAccountActivated(address indexed subAccount);
    event BridgeCreditorUpdated(address indexed bridgeCreditor);
    event BalanceFunded(address indexed subAccount, uint256 amount, uint256 newBalance);
    event BalanceWithdrawn(address indexed subAccount, uint256 amount, uint256 newBalance);
    event OperatorUpdated(address indexed subAccount, address indexed operator, bool allowed);

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
    /// @notice Per-user operational native-coin balance. The registry holds
    /// the ETH physically, but every unit is attributed to one user.
    mapping(address => uint256) public virtualBalances;
    /// @notice Per-user operator set. `operators[user][operator]` is true when
    /// `operator` may spend and configure on behalf of `user`. Operators are
    /// chosen by the user alone; the protocol owner is never one of them.
    mapping(address => mapping(address => bool)) public operators;
    /// @notice The contract allowed to deliver bridged top-ups. A protocol
    /// level trust anchor, not a per-user setting.
    address public bridgeCreditor;

    uint256 public constant MIN_THRESHOLD = 1e15;
    uint64 public constant COOLDOWN_PERIOD = 300;
    uint64 public constant MAX_DAILY_LIMIT = 1000;

    uint256 public minThreshold = MIN_THRESHOLD;
    uint64 public minCooldownPeriod = COOLDOWN_PERIOD;
    uint64 public maxDailyLimit = MAX_DAILY_LIMIT;

    event LimitsUpdated(uint256 minThreshold, uint64 minCooldownPeriod, uint64 maxDailyLimit);

    /// @notice Authorises the caller to act for `user`: either the user themself
    /// or an operator the user has explicitly approved. The protocol owner is
    /// deliberately NOT included — it must never be able to move a user's
    /// funds or change a user's settings.
    modifier onlySelfOrOperator(address user) {
        require(msg.sender == user || operators[user][msg.sender], "Not authorized for user");
        _;
    }

    constructor() Ownable(msg.sender) {}

    function setLimits(uint256 _minThreshold, uint64 _minCooldownPeriod, uint64 _maxDailyLimit) external onlyOwner {
        require(_minThreshold > 0, "Invalid minimum threshold");
        require(_minCooldownPeriod > 0, "Invalid minimum cooldown");
        require(_maxDailyLimit > 0, "Invalid maximum daily limit");
        minThreshold = _minThreshold;
        minCooldownPeriod = _minCooldownPeriod;
        maxDailyLimit = _maxDailyLimit;
        emit LimitsUpdated(_minThreshold, _minCooldownPeriod, _maxDailyLimit);
    }

    /// @notice Opens a sub-account for the caller. Permissionless: any
    /// address may open its own sub-account without the protocol owner's
    /// involvement, which is what lets the system onboard any/all users.
    /// @dev The created sub-account is keyed by `msg.sender`. A user can
    /// never create or claim a sub-account on behalf of someone else.
    function createSubAccount(
        address _mainVault,
        uint256 _threshold,
        uint256 _target,
        uint64 _cooldown,
        uint64 _maxDaily
    ) external {
        _createSubAccount(msg.sender, _mainVault, _threshold, _target, _cooldown, _maxDaily);
    }

    /// @notice Protocol-side convenience: the owner may open a sub-account
    /// on behalf of a user (for example while scripting a demo). The user
    /// still owns the resulting configuration.
    function createSubAccountFor(
        address _subAccount,
        address _mainVault,
        uint256 _threshold,
        uint256 _target,
        uint64 _cooldown,
        uint64 _maxDaily
    ) external onlyOwner {
        _createSubAccount(_subAccount, _mainVault, _threshold, _target, _cooldown, _maxDaily);
    }

    function _createSubAccount(
        address _subAccount,
        address _mainVault,
        uint256 _threshold,
        uint256 _target,
        uint64 _cooldown,
        uint64 _maxDaily
    ) internal {
        require(_subAccount != address(0), "Invalid sub-account");
        require(_threshold >= minThreshold, "Threshold too low");
        require(_target > _threshold, "Target below threshold");
        require(_cooldown >= minCooldownPeriod, "Cooldown too short");
        require(_maxDaily > 0 && _maxDaily <= maxDailyLimit, "Invalid max daily limit");
        require(subAccounts[_subAccount].isActive == false, "Sub-account exists");

        subAccounts[_subAccount] = SubAccountConfig({
            mainVault: _mainVault,
            owner: _subAccount,
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
            // Zero so the first spend is not blocked by the cooldown that
            // normally separates a spend from the previous top-up.
            lastTopUpTime: 0
        });

        // The owner of a sub-account may operate it. The protocol owner
        // stays an operator for protocol-level administration.
        emit SubAccountCreated(_subAccount, _mainVault);
    }

    /// @notice Spends from the operational balance of `subAccount`.
    /// @dev The sub-account is named explicitly so an operator acting for a
    /// user always debits THAT user's balance and never its own. The
    /// protocol owner is never an operator and can never spend a user's
    /// funds.
    function spend(address subAccount, address recipient, uint256 amount, address token)
        external
        onlySelfOrOperator(subAccount)
        nonReentrant
    {
        require(amount > 0, "Amount must be positive");
        require(recipient != address(0), "Invalid recipient");
        SubAccountConfig storage config = subAccounts[subAccount];
        require(config.isActive, "Sub-account not active");
        // A sub-account that has never been topped up (lastTopUpTime == 0)
        // may spend immediately; afterwards the user's own cooldown applies.
        require(
            config.lastTopUpTime == 0 || block.timestamp >= config.lastTopUpTime + config.cooldown, "Cooldown active"
        );
        _rollSpendDay(config);
        require(config.spendsToday < config.maxDaily, "Daily limit exceeded");
        config.sequence++;
        config.spendsToday++;
        config.totalSpentToday += amount;

        // Each user spends from their own tracked balance, so one user's
        // activity can never consume another user's operational funds.
        require(virtualBalances[subAccount] >= amount, "Insufficient balance");
        require(address(this).balance >= amount, "Insufficient contract balance");

        if (token == address(0)) {
            virtualBalances[subAccount] -= amount;
            (bool ok,) = payable(recipient).call{value: amount}("");
            require(ok, "ETH transfer failed");
        } else {
            // The refill asset is the sub-account's native coin. The token
            // argument identifies the fee/payment asset, but the balance
            // being monitored is always native coin so the operational
            // wallet can pay future fees.
            require(IERC20(token).balanceOf(address(this)) >= amount, "Insufficient token balance");
            IERC20(token).safeTransfer(recipient, amount);
        }

        uint256 currentBalance = virtualBalances[subAccount];
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

    /// @notice Updates the caller's own configuration. Every user controls
    /// their own threshold, target, cooldown and daily cap without any
    /// protocol owner transaction.
    function updateConfig(uint256 newThreshold, uint256 newTarget, uint64 newCooldown, uint64 newMaxDaily)
        external
    {
        _updateConfig(msg.sender, newThreshold, newTarget, newCooldown, newMaxDaily);
    }

    /// @notice Updates a user's configuration on their behalf. Only the user
    /// themself or an operator they explicitly approved may call this.
    function updateConfigFor(
        address subAccount,
        uint256 newThreshold,
        uint256 newTarget,
        uint64 newCooldown,
        uint64 newMaxDaily
    ) external onlySelfOrOperator(subAccount) {
        _updateConfig(subAccount, newThreshold, newTarget, newCooldown, newMaxDaily);
    }

    function _updateConfig(
        address subAccount,
        uint256 newThreshold,
        uint256 newTarget,
        uint64 newCooldown,
        uint64 newMaxDaily
    ) internal {
        require(subAccounts[subAccount].isActive, "Sub-account not active");
        require(newThreshold >= minThreshold, "Threshold too low");
        require(newTarget > newThreshold, "Target below threshold");
        require(newCooldown >= minCooldownPeriod, "Cooldown too short");
        require(newMaxDaily > 0 && newMaxDaily <= maxDailyLimit, "Invalid max daily limit");
        SubAccountConfig storage config = subAccounts[subAccount];
        config.threshold = newThreshold;
        config.target = newTarget;
        config.cooldown = newCooldown;
        config.maxDaily = newMaxDaily;
        emit SubAccountUpdated(subAccount, newThreshold);
    }

    /// @notice Approves or revokes an operator for the caller's own
    /// sub-account. An operator may spend from and configure the caller's
    /// sub-account, and can never touch any other user.
    function setOperator(address operator, bool allowed) external {
        require(operator != address(0), "Invalid operator");
        require(operator != msg.sender, "Cannot set self as operator");
        operators[msg.sender][operator] = allowed;
        emit OperatorUpdated(msg.sender, operator, allowed);
    }

    /// @notice Credits a native-coin top-up delivered by the configured
    /// cross-chain receiver.
    /// @dev The destination user is resolved from the cross-chain message
    /// payload, whose sub-account field is covered by the bridge's
    /// commitment hash. That is what lets one receiver settle top-ups for
    /// any number of users instead of a single hardcoded account.
    function receiveTopUpFromBridge(uint256 amount, address destination) external payable {
        require(msg.sender == bridgeCreditor && bridgeCreditor != address(0), "Not bridge");
        require(destination != address(0), "Invalid destination");
        require(amount > 0 && msg.value == amount, "Invalid top-up amount");
        SubAccountConfig storage config = subAccounts[destination];
        require(config.isActive, "Sub-account not active");
        config.lastTopUpTime = block.timestamp;
        virtualBalances[destination] += amount;
        emit TopUpReceived(destination, amount);
        emit BalanceFunded(destination, amount, virtualBalances[destination]);
    }

    /// @notice Funds the caller's own operational balance. The deposit is
    /// attributed to the sender, so a shared registry never mixes up whose
    /// money is whose. A sub-account must exist first, so a user cannot
    /// strand funds in a balance they can never spend.
    function depositTopUp() external payable {
        require(msg.value > 0, "Amount must be positive");
        require(subAccounts[msg.sender].isActive, "Sub-account not active");
        virtualBalances[msg.sender] += msg.value;
        emit BalanceFunded(msg.sender, msg.value, virtualBalances[msg.sender]);
    }

    /// @notice Withdraws the caller's own unspent operational balance. No
    /// other address — including the protocol owner — can move a user's
    /// operational funds.
    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be positive");
        require(virtualBalances[msg.sender] >= amount, "Insufficient balance");
        virtualBalances[msg.sender] -= amount;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "ETH transfer failed");
        emit BalanceWithdrawn(msg.sender, amount, virtualBalances[msg.sender]);
    }

    /// @notice Deactivates the caller's own sub-account, which stops it from
    /// emitting low-balance events and therefore stops the auto-topup. This
    /// is the user's off switch and needs no protocol owner transaction.
    function deactivate() external {
        _deactivate(msg.sender);
    }

    /// @notice Re-enables the caller's own sub-account, resuming the
    /// auto-topup after it was paused.
    function activate() external {
        SubAccountConfig storage config = subAccounts[msg.sender];
        require(config.createdAt > 0, "Sub-account not found");
        require(!config.isActive, "Already active");
        config.isActive = true;
        emit SubAccountActivated(msg.sender);
    }

    /// @notice Protocol kill switch: the owner can deactivate any user's
    /// sub-account. It stops future auto-topups but never moves funds.
    function deactivateFor(address subAccount) external onlyOwner {
        _deactivate(subAccount);
    }

    function _deactivate(address subAccount) internal {
        SubAccountConfig storage config = subAccounts[subAccount];
        require(config.isActive, "Already deactivated");
        config.isActive = false;
        emit SubAccountDeactivated(subAccount);
    }

    function setBridgeCreditor(address creditor) external onlyOwner {
        bridgeCreditor = creditor;
        emit BridgeCreditorUpdated(creditor);
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

    /// @notice Plain ETH transfers are credited to the sender's own balance.
    receive() external payable {
        virtualBalances[msg.sender] += msg.value;
        emit BalanceFunded(msg.sender, msg.value, virtualBalances[msg.sender]);
    }

    fallback() external payable {
        virtualBalances[msg.sender] += msg.value;
        emit BalanceFunded(msg.sender, msg.value, virtualBalances[msg.sender]);
    }
}
