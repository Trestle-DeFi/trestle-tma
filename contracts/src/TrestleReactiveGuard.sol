// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IReactive} from "@reactive/reactive-lib-omni/src/interfaces/IReactive.sol";
import {ISystemContract} from "@reactive/reactive-lib-omni/src/interfaces/ISystemContract.sol";
import {AbstractReactive} from "@reactive/reactive-lib-omni/src/base/AbstractReactive.sol";

/// @title Trestle Reactive Guard
/// @notice Watches TrestleSubAccount low-balance logs on Unichain Sepolia and
/// requests an authenticated callback to the MainVault on Base Sepolia.
contract TrestleReactiveGuard is AbstractReactive, Ownable, ReentrancyGuard {
    struct Subscription {
        address subAccount;
        uint64 maxDailyRefills;
        uint64 dailyRefillCount;
        uint256 lastRefillDay;
        uint256 lastCooldownAt;
        /// @notice Per-user cooldown in seconds. The user picks this value
        /// and can change it at any time; it is not a deployment constant.
        uint64 cooldown;
        bytes32 lastEventHash;
        bool isActive;
        uint256 createdAt;
    }

    uint256 public constant DESTINATION_CHAIN_ID = 84532;
    uint64 public constant CALLBACK_GAS_LIMIT = 250000;
    uint64 public constant MAX_DAILY_DEFAULT = 10;
    uint64 public constant COOLDOWN_PERIOD = 300;

    uint64 public maxDailyRefillsLimit = MAX_DAILY_DEFAULT;
    /// @notice Protocol floor on the per-user cooldown. Zero means users may
    /// pick any cooldown above zero; the owner can raise the floor to keep
    /// refills from being spammed across all users at once.
    uint64 public minCooldownPeriod;

    uint256 public immutable ORIGIN_CHAIN_ID;
    address public immutable ORIGIN_CONTRACT;
    uint256 public immutable LOW_BALANCE_TOPIC;

    address public callbackRecipient;
    mapping(address => Subscription) public subscriptions;
    mapping(bytes32 => bool) public processedEvents;
    mapping(address => address) public subAccountOwners;

    event SubscriptionCreated(address indexed subAccount, uint64 maxDailyRefills, uint64 cooldown, uint256 timestamp);
    event SubAccountRegistered(address indexed subAccount, address indexed owner, uint256 timestamp);
    event TopupCallbackRequested(
        bytes32 indexed requestId,
        address indexed subAccount,
        uint256 amount,
        uint256 destinationChainId,
        address indexed callbackRecipient
    );
    event EventProcessed(bytes32 indexed eventHash, address indexed subAccount, uint256 amount, uint256 timestamp);
    event DailyLimitReached(address indexed subAccount);
    event CooldownEnforced(address indexed subAccount, uint256 retryAfter);
    event MaxDailyRefillsLimitUpdated(uint64 limit);
    event MinCooldownPeriodUpdated(uint64 period);
    event SubscriptionPaused(address indexed subAccount, uint256 timestamp);

    constructor(uint256 originChainId_, address originContract_, uint256 lowBalanceTopic_) payable Ownable(msg.sender) {
        require(originChainId_ != 0, "Origin chain required");
        require(originContract_ != address(0), "Origin contract required");
        require(lowBalanceTopic_ != 0, "Low balance topic required");

        ORIGIN_CHAIN_ID = originChainId_;
        ORIGIN_CONTRACT = originContract_;
        LOW_BALANCE_TOPIC = lowBalanceTopic_;

        SYSTEM.subscribe(
            originChainId_, originContract_, lowBalanceTopic_, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE
        );
    }

    function setCallbackRecipient(address recipient) external onlyOwner {
        require(recipient != address(0), "Callback recipient required");
        callbackRecipient = recipient;
    }

    function setMaxDailyRefillsLimit(uint64 limit) external onlyOwner {
        require(limit > 0, "Invalid max daily refills limit");
        maxDailyRefillsLimit = limit;
        emit MaxDailyRefillsLimitUpdated(limit);
    }

    /// @notice Raises the protocol floor on every user's cooldown.
    function setMinCooldownPeriod(uint64 period) external onlyOwner {
        minCooldownPeriod = period;
        emit MinCooldownPeriodUpdated(period);
    }

    /// @notice Registers the caller as the owner of its own subscription.
    /// @dev The sub-account address IS the user, and it is always its own
    /// subscription owner. Registration is therefore idempotent and cannot be
    /// griefed: a third party can neither register on a user's behalf nor
    /// lock a user out by registering first. The protocol owner may register
    /// a user during scripted onboarding, but the subscription still belongs
    /// to the user.
    function registerSubAccount(address subAccount) external {
        require(subAccount != address(0), "Invalid sub-account");
        require(subAccount == msg.sender || msg.sender == owner(), "Can only register yourself");
        subAccountOwners[subAccount] = subAccount;
        emit SubAccountRegistered(subAccount, subAccount, block.timestamp);
    }

    /// @notice Subscribes a sub-account using the default cooldown.
    function setupSubscription(address subAccount, uint64 maxDailyRefills) external {
        _setupSubscription(subAccount, maxDailyRefills, COOLDOWN_PERIOD);
    }

    /// @notice Subscribes a sub-account with the user's own cooldown. The
    /// subscription owner is the address that registered the sub-account, so
    /// any user can onboard themselves without the protocol owner.
    function setupSubscription(address subAccount, uint64 maxDailyRefills, uint64 cooldown) external {
        _setupSubscription(subAccount, maxDailyRefills, cooldown);
    }

    function _setupSubscription(address subAccount, uint64 maxDailyRefills, uint64 cooldown) internal {
        address subOwner = subAccountOwners[subAccount];
        require(subOwner != address(0), "Sub-account not registered");
        require(subOwner == msg.sender || msg.sender == owner(), "Not sub-account owner nor contract owner");
        require(!subscriptions[subAccount].isActive, "Subscription exists");
        require(maxDailyRefills > 0 && maxDailyRefills <= maxDailyRefillsLimit, "Invalid max daily refills");
        require(cooldown > 0, "Invalid cooldown");
        require(cooldown >= minCooldownPeriod, "Cooldown too short");

        subscriptions[subAccount] = Subscription({
            subAccount: subAccount,
            maxDailyRefills: maxDailyRefills,
            dailyRefillCount: 0,
            lastRefillDay: block.timestamp / 86400,
            lastCooldownAt: 0,
            cooldown: cooldown,
            lastEventHash: bytes32(0),
            isActive: true,
            createdAt: block.timestamp
        });

        emit SubscriptionCreated(subAccount, maxDailyRefills, cooldown, block.timestamp);
    }

    /// @notice Updates a subscription, keeping its current cooldown.
    function updateSubscription(address subAccount, bool isActive, uint64 newMaxDailyRefills) external {
        _updateSubscription(subAccount, isActive, newMaxDailyRefills, subscriptions[subAccount].cooldown);
    }

    /// @notice Updates a subscription including the user's own cooldown.
    function updateSubscription(address subAccount, bool isActive, uint64 newMaxDailyRefills, uint64 newCooldown)
        external
    {
        _updateSubscription(subAccount, isActive, newMaxDailyRefills, newCooldown);
    }

    function _updateSubscription(address subAccount, bool isActive, uint64 newMaxDailyRefills, uint64 newCooldown)
        internal
    {
        address subOwner = subAccountOwners[subAccount];
        require(subOwner != address(0), "Sub-account not registered");
        require(subOwner == msg.sender || msg.sender == owner(), "Not sub-account owner nor contract owner");
        require(
            subscriptions[subAccount].isActive != isActive
                || subscriptions[subAccount].maxDailyRefills != newMaxDailyRefills
                || subscriptions[subAccount].cooldown != newCooldown,
            "No change needed"
        );
        require(newMaxDailyRefills > 0 && newMaxDailyRefills <= maxDailyRefillsLimit, "Invalid max daily refills");
        require(newCooldown > 0, "Invalid cooldown");
        require(newCooldown >= minCooldownPeriod, "Cooldown too short");
        Subscription storage sub = subscriptions[subAccount];
        sub.isActive = isActive;
        sub.maxDailyRefills = newMaxDailyRefills;
        sub.cooldown = newCooldown;
        sub.dailyRefillCount = 0;
    }

    /// @notice Pauses the caller's own subscription. This is the user's off
    /// switch: no further refills are requested, and the daily counter is
    /// cleared so a later resume starts fresh.
    function pauseSubscription(address subAccount) external {
        address subOwner = subAccountOwners[subAccount];
        require(subOwner != address(0), "Sub-account not registered");
        require(subOwner == msg.sender || msg.sender == owner(), "Not sub-account owner nor contract owner");
        subscriptions[subAccount].isActive = false;
        subscriptions[subAccount].dailyRefillCount = 0;
        emit SubscriptionPaused(subAccount, block.timestamp);
    }

    /// @inheritdoc IReactive
    function react(LogRecord calldata log_) external override onlySystem nonReentrant {
        require(log_.chainId == ORIGIN_CHAIN_ID, "Unexpected origin chain");
        require(log_.contractAddress == ORIGIN_CONTRACT, "Unexpected origin contract");
        require(uint256(log_.topic0) == LOW_BALANCE_TOPIC, "Unexpected event topic");

        address subAccount = address(uint160(log_.topic1));
        (uint256 currentBalance, uint256 targetTopUp, uint64 sequence) =
            abi.decode(log_.data, (uint256, uint256, uint64));
        require(subAccount != address(0), "Missing sub-account");
        require(targetTopUp > currentBalance, "No refill needed");

        Subscription storage sub = subscriptions[subAccount];
        require(sub.isActive, "Subscription not active");
        require(callbackRecipient != address(0), "Callback recipient not configured");

        uint256 currentDay = block.timestamp / 86400;
        if (sub.lastRefillDay < currentDay) {
            sub.dailyRefillCount = 0;
            sub.lastRefillDay = currentDay;
        }
        if (sub.dailyRefillCount >= sub.maxDailyRefills) {
            emit DailyLimitReached(subAccount);
            revert("Daily refill limit reached");
        }

        bytes32 eventHash = keccak256(abi.encode(log_.chainId, log_.txHash, log_.logIndex));
        require(!processedEvents[eventHash], "Event already processed");

        uint64 cooldown = sub.cooldown == 0 ? COOLDOWN_PERIOD : sub.cooldown;
        if (sub.lastCooldownAt != 0 && block.timestamp < sub.lastCooldownAt + cooldown) {
            uint256 retryAfter = sub.lastCooldownAt + cooldown - block.timestamp;
            emit CooldownEnforced(subAccount, retryAfter);
            revert("Cooldown period active");
        }

        uint256 refillAmount = targetTopUp - currentBalance;

        bytes32 requestId = keccak256(abi.encode(ORIGIN_CHAIN_ID, subAccount, sequence));
        processedEvents[eventHash] = true;
        sub.lastEventHash = eventHash;
        sub.lastCooldownAt = block.timestamp;
        sub.dailyRefillCount++;

        bytes memory payload = abi.encode(address(0), requestId, subAccount, refillAmount, block.timestamp, sequence);

        SYSTEM.requestCallbackV_1_0(
            ISystemContract.CallbackConfiguration_V_1_0({
                chainId: DESTINATION_CHAIN_ID,
                recipient: callbackRecipient,
                gasLimit: CALLBACK_GAS_LIMIT,
                payload: payload
            })
        );

        emit TopupCallbackRequested(requestId, subAccount, refillAmount, DESTINATION_CHAIN_ID, callbackRecipient);
        emit EventProcessed(eventHash, subAccount, refillAmount, block.timestamp);
    }

    function getSubscriptionStatus(address subAccount) external view returns (Subscription memory) {
        return subscriptions[subAccount];
    }

    function coverDebt() external {
        _coverDebt();
    }
}
