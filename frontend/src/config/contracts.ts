export const REWARD_API = import.meta.env.VITE_REWARD_API_URL || "https://reward-api.trestle.website";
export const TESTNET_API = import.meta.env.VITE_TESTNET_API_URL || "https://vault.trestle.website";
export const VAULT_API = import.meta.env.VITE_VAULT_API_URL || "https://vault.trestle.website";
export const AI_API = import.meta.env.VITE_AI_API_URL || "https://ai.trestle.website";

// Legacy aliases
export const API_BASE = REWARD_API;
export const AI_API_BASE = AI_API;
export const VAULT_API_BASE = VAULT_API;

export const LINKS = {
  mainSite: import.meta.env.VITE_MAIN_SITE_URL || "https://trestle.website",
  testnet: import.meta.env.VITE_TESTNET_URL || "https://testnet.trestle.website",
  docs: "https://docs.trestle.website",
  telegram: "https://t.me/TrestleDeFi",
  telegramBot: "https://t.me/trestlehub_bot",
  discord: "https://discord.gg/4dCCvnJYGT",
  github: "https://github.com/Trestle-DeFi",
} as const;

export const CHAIN_CONFIG = {
  polygon: {
    id: 137,
    name: "Polygon Mainnet",
    shortName: "Polygon",
    rpc: "https://polygon-bor-rpc.publicnode.com",
    explorer: "https://polygonscan.com",
    currency: { name: "POL", symbol: "POL", decimals: 18 },
  },
  amoy: {
    id: 80002,
    name: "Polygon Amoy",
    shortName: "Amoy",
    rpc: "https://polygon-amoy.publicnode.com",
    explorer: "https://www.oklink.com/amoy",
    currency: { name: "POL", symbol: "POL", decimals: 18 },
  },
  baseSepolia: {
    id: 84532,
    name: "Base Sepolia",
    shortName: "Base",
    rpc: "https://sepolia.base.org",
    explorer: "https://sepolia.basescan.org",
    currency: { name: "ETH", symbol: "ETH", decimals: 18 },
  },
  arbitrumSepolia: {
    id: 421614,
    name: "Arbitrum Sepolia",
    shortName: "Arbitrum",
    rpc: "https://sepolia-rollup.arbitrum.io/rpc",
    explorer: "https://sepolia.arbiscan.io",
    currency: { name: "ETH", symbol: "ETH", decimals: 18 },
  },
} as const;

export type ChainKey = keyof typeof CHAIN_CONFIG;
export const SUPPORTED_CHAIN_IDS = Object.values(CHAIN_CONFIG).map(c => c.id) as readonly number[];
export const DEFAULT_CHAIN = CHAIN_CONFIG.amoy.id;

export const BROILER_INFO = {
  supply: "1,000,000,000,000,000",
  supplyDisplay: "1 Quadrillion",
  taxBps: 500,
  taxPercent: 5,
  recommendedSlippage: "6-7%",
  lpPair: "BRT/WMATIC",
} as const;

export const STAKING_DURATIONS = [
  { id: 0, label: "3 Months", seconds: 90 * 86400, multiplier: "1x" },
  { id: 1, label: "6 Months", seconds: 180 * 86400, multiplier: "1.5x" },
  { id: 2, label: "12 Months", seconds: 365 * 86400, multiplier: "2x" },
] as const;

// ─── On-chain contract addresses per testnet ──────────────────────────
export type ContractName = "DigitalGoods" | "FreelancerEscrow" | "DigitalRWA";

export const CONTRACT_ADDRESSES: Record<number, Record<ContractName, `0x${string}`>> = {
  // Polygon Amoy — Redeployed 2026-09-18
  80002: {
    DigitalGoods: "0x756CF434FAB30A18117810B9dC3a8f7F68e891DB",
    FreelancerEscrow: "0xb02cca2D8Fd71bE960f6C261EAD2f460dF8b0cBb",
    DigitalRWA: "0xBCe3E78Cac1Dd60857880Eb833700ec09FcF2483",
  },
  // Base Sepolia — Redeployed 2026-09-18
  84532: {
    DigitalGoods: "0xe5665d1D2F180D27d328acCBB83f5fBE32A6666A",
    FreelancerEscrow: "0x1a112d7D350976A7b5015868F4DF3bdC8A46570d",
    DigitalRWA: "0xb0a742a2302B043718b60053b135dC432C892852",
  },
  // Arbitrum Sepolia — Redeployed 2026-09-18
  421614: {
    DigitalGoods: "0xAe743AC8eBE1fe05114bB82F68b51A9a2BabD9Df",
    FreelancerEscrow: "0x88fB6Ae65B2c6011F4dE243BbDa100dC57Cd5FE5",
    DigitalRWA: "0x81C11612df53Bf2564CFDEc7C7E11407db6E10Ce",
  },
} as const;
