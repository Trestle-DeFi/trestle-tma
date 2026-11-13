// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract TrestleMainVault is Ownable, ReentrancyGuard {
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

    mapping(address => bool) public authorizedCallers;
    address public reactiveContract;

    event TopUpRequested(bytes32 indexed requestId, address indexed subAccount, uint256 amount);
    event TopUpReleased(bytes32 indexed requestId, address indexed subAccount, uint256 amount);
    event TopUpFailed(bytes32 indexed requestId, address indexed subAccount, string reason);
    event TopUpExpired(bytes32 indexed requestId, address indexed subAccount);

    constructor() Ownable(msg.sender) {
        authorizedCallers[msg.sender] = true;
        reactiveContract = msg.sender; // Owner is initial reactive contract
    }

    modifier onlyAuthorizedCaller() {
        require(authorizedCallers[msg.sender] || msg.sender == owner(), "Not authorized");
        _;
    }

    modifier onlyReactiveCallback() {
        require(msg.sender == reactiveContract, "Not reactive contract");
        _;
    }

    modifier validRequest(bytes32 requestId) {
        require(requests[requestId].settled == false, "Request settled");
        require(requests[requestId].expired == false, "Request expired");
        _;
    }

    function requestTopUp(address subAccount, uint256 amount) external onlyAuthorizedCaller {
        require(amount >= MIN_TOPUP_AMOUNT, "Amount too small");
        bytes32 requestId = keccak256(abi.encodePacked(block.timestamp, subAccount, amount, msg.sender));
        requests[requestId] = TopUpRequest({requestId: requestId, subAccount: subAccount, amount: amount, timestamp: block.timestamp, settled: false, expired: false});
        subAccountRequests[subAccount].push(requestId);
        require(subAccountRequests[subAccount].length <= MAX_DAILY_REQUESTS, "Daily request limit exceeded");
        emit TopUpRequested(requestId, subAccount, amount);
    }

    function releaseTopup(bytes32 requestId, address subAccount, uint256 amount) external onlyReactiveCallback validRequest(requestId) {
        TopUpRequest storage request = requests[requestId];
        if (block.timestamp > request.timestamp + REQUEST_EXPIRY_TIME) {
            request.expired = true;
            emit TopUpExpired(requestId, request.subAccount);
            return;
        }
        require(request.subAccount == subAccount, "Sub-account mismatch");
        require(request.amount == amount, "Amount mismatch");
        request.settled = true;
        if (request.subAccount != address(0)) {
            payable(request.subAccount).transfer(request.amount);
        }
        emit TopUpReleased(requestId, request.subAccount, request.amount);
    }

    function expireRequest(bytes32 requestId) external onlyOwner {
        require(!requests[requestId].settled, "Request already settled");
        requests[requestId].expired = true;
        emit TopUpExpired(requestId, requests[requestId].subAccount);
    }

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
    }

    function setReactiveContract(address _reactive) external onlyOwner {
        require(_reactive != address(0), "Invalid reactive contract");
        reactiveContract = _reactive;
    }

    function getRequestStatus(bytes32 requestId) external view returns (bool settled, bool expired, uint256 amount) {
        TopUpRequest storage request = requests[requestId];
        return (request.settled, request.expired, request.amount);
    }

    function getSubAccountRequests(address subAccount) external view returns (bytes32[] memory) {
        return subAccountRequests[subAccount];
    }

    receive() external payable {}
}