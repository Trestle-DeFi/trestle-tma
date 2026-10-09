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
  // Polygon Amoy — DG/RWA 2026-09-25, FreelancerEscrow re-redeployed 2026-10-09 (ZAFRAN-H1)
  80002: {
    DigitalGoods: "0xBd124c4395b47093CEc78497ec8b098977416396",
    FreelancerEscrow: "0x05f6B7e45833A4Cb9f934dB4116993b6c2522546",
    DigitalRWA: "0x7f750E8BD9c9C2685710A03De5307961BC50aF31",
  },
  // Base Sepolia — DG/RWA 2026-09-24, FreelancerEscrow re-redeployed 2026-10-09 (ZAFRAN-H1)
  84532: {
    DigitalGoods: "0x89f5394a468343F405285040664Fd77843D2a2e6",
    FreelancerEscrow: "0xA8fb99180AdfFD8d0986A32f472faD2A17B57D7D",
    DigitalRWA: "0x5582496273a71E60e457D19773050CC848A2F52C",
  },
  // Arbitrum Sepolia — DG/RWA 2026-09-24, FreelancerEscrow re-redeployed 2026-10-09 (ZAFRAN-H1)
  421614: {
    DigitalGoods: "0x6D6C679279f5C680e5a6ef33306F2e9A78577DCa",
    FreelancerEscrow: "0xFd919cE133d356bdeb0577e6b35b20b7caD69722",
    DigitalRWA: "0x4eC3777B16FC7Da556B451679A10A8fDFC5Fd48D",
  },
} as const;
