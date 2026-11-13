// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract TrestleReactiveGuard is Ownable, ReentrancyGuard {
    struct Subscription {
        address subAccount;
        address mainVault;
        string callbackUrl;
        bool isActive;
        uint256 createdAt;
        bytes32 lastEventHash;
        uint256 lastCooldownBlock;
        uint64 maxDailyRefills;
        uint64 dailyRefillCount;
        uint256 lastRefillDay;
    }

    mapping(address => Subscription) public subscriptions;
    mapping(string => address) public callbackUrlToSubAccount;
    address public reactiveSender;
    mapping(address => bool) public authorizedReactiveSenders;

    uint256 public constant MAX_SUBSCRIPTIONS = 100;
    uint256 public subscriptionCount;
    string public reactiveNetworkUrl;
    uint256 public constant COOLDOWN_BLOCKS = 5;
    uint64  public constant MAX_DAILY_DEFAULT = 10;
    uint256 public constant REFILL_LOCK_TTL = 3600;

    mapping(bytes32 => bool) public refillInFlight;
    mapping(bytes32 => uint256) public refillLockTimestamp;

    event SubscriptionCreated(address indexed subAccount, address mainVault, string callbackUrl, uint256 timestamp);
    event EventProcessed(bytes32 indexed eventHash, address indexed subAccount, uint256 amount, uint256 timestamp);
    event CallbackError(bytes32 indexed eventHash, address indexed subAccount, string errorReason);
    event TopupCallbackRequested(bytes32 indexed requestId, address indexed subAccount, uint256 amount, address indexed mainVault);
    event CooldownEnforced(address indexed subAccount, uint256 remainingBlocks);
    event DailyLimitReached(address indexed subAccount);

    constructor() Ownable(msg.sender) {
        reactiveNetworkUrl = "https://rpc.testnet.reactivenetwork.org";
        reactiveSender = owner();
    }

    function setReactiveSender(address _sender) external onlyOwner {
        require(_sender != address(0), "Invalid sender address");
        authorizedReactiveSenders[_sender] = true;
        reactiveSender = _sender;
    }

    function isAuthorizedReactive(address caller) public view returns (bool) {
        return authorizedReactiveSenders[caller] || caller == reactiveSender;
    }

    function setupSubscription(
        address subAccount,
        address mainVault,
        string memory callbackUrl,
        uint64 maxDailyRefills
    ) external onlyOwner {
        require(subscriptionCount < MAX_SUBSCRIPTIONS, "Max subscriptions reached");
        require(!subscriptions[subAccount].isActive, "Subscription exists");
        require(bytes(callbackUrl).length > 0, "Callback URL required");
        require(mainVault != address(0), "Main vault required");
        require(maxDailyRefills > 0 && maxDailyRefills <= MAX_DAILY_DEFAULT, "Invalid max daily refills");
        subscriptions[subAccount] = Subscription({
            subAccount: subAccount,
            mainVault: mainVault,
            callbackUrl: callbackUrl,
            isActive: true,
            createdAt: block.timestamp,
            lastEventHash: bytes32(0),
            lastCooldownBlock: 0,
            maxDailyRefills: maxDailyRefills,
            dailyRefillCount: 0,
            lastRefillDay: block.timestamp / 86400
        });
        callbackUrlToSubAccount[callbackUrl] = subAccount;
        subscriptionCount++;
        emit SubscriptionCreated(subAccount, mainVault, callbackUrl, block.timestamp);
    }

    function updateSubscription(
        address subAccount,
        bool isActive,
        uint64 newMaxDailyRefills
    ) external onlyOwner {
        require(subscriptions[subAccount].isActive != isActive || subscriptions[subAccount].maxDailyRefills != newMaxDailyRefills, "No change needed");
        Subscription storage sub = subscriptions[subAccount];
        sub.isActive = isActive;
        sub.maxDailyRefills = newMaxDailyRefills;
        sub.dailyRefillCount = 0;
        if (!isActive) {
            delete callbackUrlToSubAccount[sub.callbackUrl];
        }
    }

    function react(bytes calldata eventData) external nonReentrant {
        require(isAuthorizedReactive(msg.sender), "Not authorized reactive sender");
        (
            address subAccount,
            uint256 currentBalance,
            uint256 targetTopUp,
            uint64 sequence
        ) = abi.decode(eventData, (address, uint256, uint256, uint64));
        Subscription storage sub = subscriptions[subAccount];
        require(sub.isActive, "Subscription not active");
        uint256 currentDay = block.timestamp / 86400;
        if (sub.lastRefillDay < currentDay) {
            sub.dailyRefillCount = 0;
            sub.lastRefillDay = currentDay;
        }
        if (sub.dailyRefillCount >= sub.maxDailyRefills) {
            emit DailyLimitReached(subAccount);
            revert("Daily refill limit reached");
        }
        if (block.number < sub.lastCooldownBlock + COOLDOWN_BLOCKS) {
            uint256 remaining = sub.lastCooldownBlock + COOLDOWN_BLOCKS - block.number;
            emit CooldownEnforced(subAccount, remaining);
            revert("Cooldown period active");
        }
        uint256 refillAmount = targetTopUp > currentBalance ? targetTopUp - currentBalance : 0;
        require(refillAmount > 0, "No refill needed");
        bytes32 requestId = keccak256(abi.encodePacked(subAccount, sequence, block.timestamp));
        require(!refillInFlight[requestId], "Refill already in flight");
        refillInFlight[requestId] = true;
        refillLockTimestamp[requestId] = block.timestamp;
        sub.lastEventHash = keccak256(eventData);
        sub.lastCooldownBlock = block.number;
        sub.dailyRefillCount++;
        emit TopupCallbackRequested(requestId, subAccount, refillAmount, sub.mainVault);
        emit EventProcessed(requestId, subAccount, refillAmount, block.timestamp);
    }

    function releaseLock(bytes32 requestId) external {
        require(refillInFlight[requestId], "No active lock");
        require(block.timestamp > refillLockTimestamp[requestId] + REFILL_LOCK_TTL, "Lock TTL not expired");
        delete refillInFlight[requestId];
        delete refillLockTimestamp[requestId];
    }

    function getSubscriptionStatus(address subAccount) external view returns (Subscription memory) {
        return subscriptions[subAccount];
    }

    function setReactiveNetworkUrl(string memory _url) external onlyOwner {
        reactiveNetworkUrl = _url;
    }

    receive() external payable {}
}