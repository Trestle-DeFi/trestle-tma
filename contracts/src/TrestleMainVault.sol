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
}

contract TrestleMainVault is AbstractCallback, Ownable, ReentrancyGuard {
    struct TopUpRequest {
        bytes32 requestId;
        address subAccount;
        uint256 amount;
        uint256 timestamp;
        bool settled;
        bool expired;
    }

    mapping(bytes32 => TopUpRequest) public requests;
    mapping(address => bytes32[]) public subAccountRequests;

    uint256 public constant REQUEST_EXPIRY_TIME = 3600;
    uint64 public constant MAX_DAILY_REQUESTS = 10;
    uint256 public constant MIN_TOPUP_AMOUNT = 1e15;
    uint256 public constant BRIDGE_FUNDING_BUFFER_BPS = 100;
    uint256 public constant ORIGIN_CHAIN_ID = 1301;

    mapping(address => bool) public authorizedCallers;
    ITopupBridge public topupBridge;

    event TopUpRequested(bytes32 indexed requestId, address indexed subAccount, uint256 amount);
    event TopUpReleased(bytes32 indexed requestId, address indexed subAccount, uint256 amount, bytes32 bridgeMessageId);
    event TopUpFailed(bytes32 indexed requestId, address indexed subAccount, string reason);
    event TopUpExpired(bytes32 indexed requestId, address indexed subAccount);
    event BridgeConfigured(address indexed bridge);

    constructor(IPayable callbackProxy_, address reactiveSender_)
        payable
        AbstractCallback(callbackProxy_, reactiveSender_)
        Ownable(msg.sender)
    {
        authorizedCallers[msg.sender] = true;
    }

    modifier onlyAuthorizedCaller() {
        require(authorizedCallers[msg.sender] || msg.sender == owner(), "Not authorized");
        _;
    }

    modifier validRequest(bytes32 requestId) {
        require(requests[requestId].settled == false, "Request settled");
        require(requests[requestId].expired == false, "Request expired");
        _;
    }

    function requestTopUp(address subAccount, uint64 sequence, uint256 amount) external onlyAuthorizedCaller {
        require(amount >= MIN_TOPUP_AMOUNT, "Amount too small");
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
        require(subAccountRequests[subAccount].length <= MAX_DAILY_REQUESTS, "Daily request limit exceeded");
        emit TopUpRequested(requestId, subAccount, amount);
    }

    function setTopupBridge(address bridge) external onlyOwner {
        require(bridge != address(0), "Bridge required");
        topupBridge = ITopupBridge(bridge);
        emit BridgeConfigured(bridge);
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
        require(requestId == keccak256(abi.encode(ORIGIN_CHAIN_ID, subAccount, sequence)), "Invalid request ID");

        uint256 fundingAmount = amount * (10_000 + BRIDGE_FUNDING_BUFFER_BPS) / 10_000;
        require(address(this).balance >= fundingAmount, "Insufficient vault balance");

        TopUpRequest storage request = requests[requestId];
        if (request.requestId == bytes32(0)) {
            requests[requestId] = TopUpRequest({
                requestId: requestId,
                subAccount: subAccount,
                amount: amount,
                timestamp: requestTimestamp,
                settled: false,
                expired: false
            });
            subAccountRequests[subAccount].push(requestId);
            require(subAccountRequests[subAccount].length <= MAX_DAILY_REQUESTS, "Daily request limit exceeded");
        } else {
            require(!request.settled, "Request settled");
            require(!request.expired, "Request expired");
            require(request.subAccount == subAccount, "Sub-account mismatch");
            require(request.amount == amount, "Amount mismatch");
        }

        bytes32 bridgeMessageId = topupBridge.sendTopup{value: fundingAmount}(requestId, subAccount, amount);
        requests[requestId].settled = true;
        emit TopUpReleased(requestId, subAccount, amount, bridgeMessageId);
    }

    function expireRequest(bytes32 requestId) external onlyOwner {
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
