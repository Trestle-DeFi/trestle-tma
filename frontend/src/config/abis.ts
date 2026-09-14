export const DIGITAL_GOODS_ABI = [
  {
    type: "function", name: "listingCount", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function", name: "listings", stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{
      name: "", type: "tuple",
      components: [
        { name: "id", type: "uint256" },
        { name: "seller", type: "address" },
        { name: "metadataURI", type: "string" },
        { name: "pricing", type: "uint8" },
        { name: "price", type: "uint256" },
        { name: "auction", type: "tuple", components: [
          { name: "startPrice", type: "uint256" },
          { name: "reservePrice", type: "uint256" },
          { name: "duration", type: "uint256" },
          { name: "startedAt", type: "uint256" },
        ]},
        { name: "status", type: "uint8" },
        { name: "buyer", type: "address" },
        { name: "escrowedAmount", type: "uint256" },
        { name: "createdAt", type: "uint256" },
        { name: "disputeDeadline", type: "uint256" },
        { name: "deliveryConfirmed", type: "bool" },
        { name: "paymentToken", type: "address" },
        { name: "category", type: "string" },
        { name: "deliveryURI", type: "string" },
      ],
    }],
  },
  {
    type: "function", name: "currentPrice", stateMutability: "view",
    inputs: [{ name: "_id", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function", name: "PLATFORM_FEE_BPS", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const FREELANCER_ESCROW_ABI = [
  {
    type: "function", name: "projectCount", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function", name: "gigCount", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function", name: "projects", stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{
      name: "", type: "tuple",
      components: [
        { name: "id", type: "uint256" },
        { name: "client", type: "address" },
        { name: "freelancer", type: "address" },
        { name: "title", type: "string" },
        { name: "descriptionURI", type: "string" },
        { name: "pricing", type: "uint8" },
        { name: "totalBudget", type: "uint256" },
        { name: "auction", type: "tuple", components: [
          { name: "startPrice", type: "uint256" },
          { name: "reservePrice", type: "uint256" },
          { name: "duration", type: "uint256" },
          { name: "startedAt", type: "uint256" },
        ]},
        { name: "status", type: "uint8" },
        { name: "milestones", type: "tuple[]", components: [
          { name: "description", type: "string" },
          { name: "amount", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "submittedAt", type: "uint256" },
          { name: "deliveryHash", type: "string" },
        ]},
        { name: "escrowedAmount", type: "uint256" },
        { name: "disputeDeadline", type: "uint256" },
        { name: "createdAt", type: "uint256" },
        { name: "paymentToken", type: "address" },
      ],
    }],
  },
  {
    type: "function", name: "gigs", stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{
      name: "", type: "tuple",
      components: [
        { name: "id", type: "uint256" },
        { name: "freelancer", type: "address" },
        { name: "title", type: "string" },
        { name: "descriptionURI", type: "string" },
        { name: "price", type: "uint256" },
        { name: "active", type: "bool" },
        { name: "milestones", type: "tuple[]", components: [
          { name: "description", type: "string" },
          { name: "amount", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ]},
      ],
    }],
  },
  {
    type: "function", name: "PLATFORM_FEE_BPS", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const DIGITAL_RWA_ABI = [
  {
    type: "function", name: "assetInfo", stateMutability: "view",
    inputs: [], outputs: [{
      name: "", type: "tuple",
      components: [
        { name: "name", type: "string" },
        { name: "description", type: "string" },
        { name: "lockupDuration", type: "uint256" },
        { name: "expectedReturnBps", type: "uint256" },
        { name: "underlyingAsset", type: "string" },
        { name: "redemptionDate", type: "uint256" },
        { name: "redemptionPrice", type: "uint256" },
      ],
    }],
  },
  {
    type: "function", name: "assetInfoSet", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function", name: "currentPrice", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function", name: "cap", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function", name: "totalSupply", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function", name: "metadataURI", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function", name: "name", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function", name: "symbol", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function", name: "decimals", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint8" }],
  },
] as const;
