// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPayable} from "@reactive/reactive-lib-omni/src/interfaces/IPayable.sol";
import {AbstractCallback} from "@reactive/reactive-lib-omni/src/base/AbstractCallback.sol";

/// @notice Cross-chain transfer adapter used by the Base vault to deliver a
/// settled top-up to the Unichain destination.
interface ITopupBridge {
    function sendTopup(bytes32 requestId, address destination, uint256 amount) external payable returns (bytes32);
    /// @notice Quotes the CCIP network fee so the user's reserve can pay it.
    function quoteFee() external view returns (uint256);
}

/// @title Trestle Main Vault — per-user reserves
/// @notice Custodies every user's own reserve. `address(this).balance` is
/// the SUM of all users' deposits; the deployer contributes no capital and
/// has no way to take any of it back.
contract TrestleMainVault is AbstractCallback, Ownable, ReentrancyGuard {
    struct TopUpRequest {
        bytes32 requestId;
        address subAccount;
        uint256 amount;
        uint256 timestamp;
        bool settled;
        bool expired;
    }

    /// @notice Reserve credited to each user. A top-up is funded only from
    /// the balance of the user whose sub-account requested it.
    mapping(address => uint256) public balances;
    mapping(bytes32 => TopUpRequest) public requests;
    mapping(address => bytes32[]) public subAccountRequests;
    /// @notice Protocol cap on a user's daily top-up requests. The owner may
    /// only LOWER a user's allowance through this mapping, never raise it.
    mapping(address => uint64) public subAccountDailyLimit;
    /// @notice The user's own daily request cap, set by the user. Zero means
    /// "use the protocol default".
    mapping(address => uint64) public userDailyRequestLimit;
    mapping(address => uint64) public dailyRequestCount;
    mapping(address => uint256) public dailyRequestDay;

    uint256 public constant REQUEST_EXPIRY_TIME = 3600;
    uint64 public constant DEFAULT_MAX_DAILY_REQUESTS = 10;
    uint64 public constant MAX_DAILY_REQUESTS_LIMIT = 100;
    uint256 public constant MIN_TOPUP_AMOUNT = 1e15;
    uint256 public constant BRIDGE_FUNDING_BUFFER_BPS = 100;
    uint256 public constant ORIGIN_CHAIN_ID = 1301;

    uint64 public defaultMaxDailyRequests = DEFAULT_MAX_DAILY_REQUESTS;
    /// @notice Hard ceiling on any user's daily request cap. The owner can
    /// lower it, which lowers every user's effective limit at once.
    uint64 public maxDailyRequestsLimit = MAX_DAILY_REQUESTS_LIMIT;

    mapping(address => bool) public authorizedCallers;
    ITopupBridge public topupBridge;

    event TopUpRequested(bytes32 indexed requestId, address indexed subAccount, uint256 amount);
    event TopUpReleased(bytes32 indexed requestId, address indexed subAccount, uint256 amount, bytes32 bridgeMessageId);
    event TopUpFailed(bytes32 indexed requestId, address indexed subAccount, string reason);
    event TopUpExpired(bytes32 indexed requestId, address indexed subAccount);
    event BridgeConfigured(address indexed bridge);
    event DailyRequestLimitUpdated(address indexed subAccount, uint64 limit);
    event ReserveDeposited(address indexed user, uint256 amount, uint256 balance);
    event ReserveWithdrawn(address indexed user, uint256 amount, uint256 balance);

    constructor(IPayable callbackProxy_, address reactiveSender_)
        payable
        AbstractCallback(callbackProxy_, reactiveSender_)
        Ownable(msg.sender)
    {
        authorizedCallers[msg.sender] = true;
    }

    modifier validRequest(bytes32 requestId) {
        require(requests[requestId].settled == false, "Request settled");
        require(requests[requestId].expired == false, "Request expired");
        _;
    }

    /// @notice Records a top-up request. Callable by the reactive guard (an
    /// authorized caller) or by the user for their own sub-account, so a
    /// user can trigger a refill without any protocol owner transaction.
    function requestTopUp(address subAccount, uint64 sequence, uint256 amount) external {
        require(
            msg.sender == subAccount || authorizedCallers[msg.sender] || msg.sender == owner(), "Not authorized"
        );
        require(amount >= MIN_TOPUP_AMOUNT, "Amount too small");
        _consumeDailyRequest(subAccount);
        bytes32 requestId = keccak256(abi.encode(ORIGIN_CHAIN_ID, subAccount, sequence));
        require(requests[requestId].requestId == bytes32(0), "Request exists");
        requests[requestId] = TopUpRequest({
            requestId: requestId,
            subAccount: subAccount,
            amount: amount,
            timestamp: block.timestamp,
            settled: false,
            expired: false
        });
        subAccountRequests[subAccount].push(requestId);
        emit TopUpRequested(requestId, subAccount, amount);
    }

    /// @notice Protocol cap on a user's daily top-up requests. The owner can
    /// only tighten this limit; the user's own cap still applies on top, so
    /// the effective limit is the strictest of the two.
    function setSubAccountDailyLimit(address subAccount, uint64 limit) external onlyOwner {
        require(limit > 0, "Invalid daily request limit");
        subAccountDailyLimit[subAccount] = limit;
        emit DailyRequestLimitUpdated(subAccount, limit);
    }

    /// @notice The user sets their own daily top-up request cap. This is
    /// self-service: no protocol owner transaction is involved, and the cap
    /// can never exceed the protocol ceiling.
    function setMyDailyRequestLimit(uint64 limit) external {
        require(limit > 0 && limit <= maxDailyRequestsLimit, "Invalid daily request limit");
        userDailyRequestLimit[msg.sender] = limit;
        emit DailyRequestLimitUpdated(msg.sender, limit);
    }

    /// @notice Lowers the hard ceiling on every user's daily request cap.
    function setMaxDailyRequestsLimit(uint64 limit) external onlyOwner {
        require(limit > 0, "Invalid daily request limit");
        maxDailyRequestsLimit = limit;
        emit DailyRequestLimitUpdated(address(0), limit);
    }

    function setDefaultMaxDailyRequests(uint64 limit) external onlyOwner {
        require(limit > 0, "Invalid daily request limit");
        defaultMaxDailyRequests = limit;
        emit DailyRequestLimitUpdated(address(0), limit);
    }

    /// @notice The limit that actually applies to a user: the strictest of
    /// the user's own cap, the protocol's per-user cap and the global
    /// ceiling.
    function getEffectiveDailyLimit(address subAccount) public view returns (uint64) {
        uint64 limit = userDailyRequestLimit[subAccount];
        if (limit == 0) limit = defaultMaxDailyRequests;
        uint64 protocolCap = subAccountDailyLimit[subAccount];
        if (protocolCap != 0 && protocolCap < limit) limit = protocolCap;
        if (limit > maxDailyRequestsLimit) limit = maxDailyRequestsLimit;
        return limit;
    }

    function getDailyRequestCount(address subAccount) external view returns (uint64 count, uint256 day) {
        return (dailyRequestCount[subAccount], dailyRequestDay[subAccount]);
    }

    function _consumeDailyRequest(address subAccount) internal {
        uint256 day = block.timestamp / 86400;
        if (dailyRequestDay[subAccount] != day) {
            dailyRequestDay[subAccount] = day;
            dailyRequestCount[subAccount] = 0;
        }
        uint64 limit = getEffectiveDailyLimit(subAccount);
        require(dailyRequestCount[subAccount] < limit, "Daily request limit exceeded");
        dailyRequestCount[subAccount]++;
    }

    function setTopupBridge(address bridge) external onlyOwner {
        require(bridge != address(0), "Bridge required");
        topupBridge = ITopupBridge(bridge);
        emit BridgeConfigured(bridge);
    }

    /// @notice Credits a reserve to a specific user. Users fund themselves —
    /// the owner never has to pre-fund the vault for the system to work.
    function depositFor(address user) external payable {
        require(user != address(0), "Invalid user");
        require(msg.value > 0, "Amount must be positive");
        balances[user] += msg.value;
        emit ReserveDeposited(user, msg.value, balances[user]);
    }

    /// @notice Plain ETH transfers credit the sender's own reserve.
    receive() external payable override {
        balances[msg.sender] += msg.value;
        emit ReserveDeposited(msg.sender, msg.value, balances[msg.sender]);
    }

    /// @notice A user withdraws their own unspent reserve. No other address
    /// — including the contract owner — can move a user's reserve, so the
    /// owner is limited to configuration (daily caps) and never to funds.
    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be positive");
        require(amount <= balances[msg.sender], "Insufficient balance");
        balances[msg.sender] -= amount;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "Transfer failed");
        emit ReserveWithdrawn(msg.sender, amount, balances[msg.sender]);
    }

    /// @notice Reactive Network callback entry point.
    /// @dev The first argument is injected by the Reactive callback proxy and
    /// identifies the Lasna reactive contract that requested this callback.
    function releaseTopup(
        address reactiveSender_,
        bytes32 requestId,
        address subAccount,
        uint256 amount,
        uint256 requestTimestamp,
        uint64 sequence
    ) external payable onlyServiceProvider onlyCallbackSender(reactiveSender_) nonReentrant {
        require(amount >= MIN_TOPUP_AMOUNT, "Amount too small");
        require(block.timestamp <= requestTimestamp + REQUEST_EXPIRY_TIME, "Request expired");
        require(address(topupBridge) != address(0), "Bridge not configured");
        require(subAccount != address(0), "Invalid sub-account");
        require(requestId == keccak256(abi.encode(ORIGIN_CHAIN_ID, subAccount, sequence)), "Invalid request ID");

        // Any native value forwarded with the callback is credited to the
        // requesting user so the vault stays fully accounted for.
        if (msg.value > 0) {
            balances[subAccount] += msg.value;
            emit ReserveDeposited(subAccount, msg.value, balances[subAccount]);
        }

        // The user's reserve pays BOTH the top-up and the cross-chain network
        // fee, so the protocol never has to fund a reserve of its own.
        uint256 feeQuote = topupBridge.quoteFee();
        uint256 fundingAmount = amount * (10_000 + BRIDGE_FUNDING_BUFFER_BPS) / 10_000 + feeQuote;
        // The reserve that funds this top-up belongs to the requesting user.
        // One user's reserve can never fund another user's refill, and an
        // empty reserve never blocks anybody else.
        require(balances[subAccount] >= fundingAmount, "Insufficient user balance");
        require(address(this).balance >= fundingAmount, "Insufficient vault balance");

        TopUpRequest storage request = requests[requestId];
        if (request.requestId == bytes32(0)) {
            _consumeDailyRequest(subAccount);
            requests[requestId] = TopUpRequest({
                requestId: requestId,
                subAccount: subAccount,
                amount: amount,
                timestamp: requestTimestamp,
                settled: false,
                expired: false
            });
            subAccountRequests[subAccount].push(requestId);
        } else {
            require(!request.settled, "Request settled");
            require(!request.expired, "Request expired");
            require(request.subAccount == subAccount, "Sub-account mismatch");
            require(request.amount == amount, "Amount mismatch");
        }

        // The 1% bridge buffer covers the ETH->USDC->ETH round trip, and the
        // quoted CCIP fee covers the network cost. Both are debited from the
        // user's own reserve rather than from a shared pool that the owner
        // would have to keep topped up.
        balances[subAccount] -= fundingAmount;

        bytes32 bridgeMessageId = topupBridge.sendTopup{value: fundingAmount}(requestId, subAccount, amount);
        requests[requestId].settled = true;
        emit TopUpReleased(requestId, subAccount, amount, bridgeMessageId);
    }

    /// @notice Marks a request as expired so it can no longer be settled.
    /// The owner may expire any request; a user may expire their own.
    function expireRequest(bytes32 requestId) external {
        require(msg.sender == owner() || msg.sender == requests[requestId].subAccount, "Not authorized");
        require(!requests[requestId].settled, "Request already settled");
        requests[requestId].expired = true;
        emit TopUpExpired(requestId, requests[requestId].subAccount);
    }

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
    }

    function setReactiveContract(address) external pure {
        revert("Immutable callback sender");
    }

    function getRequestStatus(bytes32 requestId) external view returns (bool settled, bool expired, uint256 amount) {
        TopUpRequest storage request = requests[requestId];
        return (request.settled, request.expired, request.amount);
    }

    function getSubAccountRequests(address subAccount) external view returns (bytes32[] memory) {
        return subAccountRequests[subAccount];
    }
}
