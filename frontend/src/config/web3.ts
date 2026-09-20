import { http, fallback } from "viem";
import { polygon, polygonAmoy, baseSepolia, arbitrumSepolia } from "viem/chains";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { createAppKit } from "@reown/appkit/react";

export const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "";

// Transports: verified live 2026-09-20 (polygon-rpc.com now requires an API key,
// LlamaNodes/Ankr/BlockPI public endpoints are discontinued, Alchemy /v2/demo keys are
// placeholders — all removed; see TMA-CORRECTIONS-AND-DEPLOY-PLAN.md §6).
const polygonTransports = [
  http("https://polygon.drpc.org", { retryCount: 2, retryDelay: 500 }),
  http("https://1rpc.io/matic", { retryCount: 2, retryDelay: 500 }),
  http("https://polygon-bor-rpc.publicnode.com", { retryCount: 2, retryDelay: 500 }),
].filter(Boolean) as ReturnType<typeof http>[];

const amoyTransports = [
  http("https://polygon-amoy.publicnode.com", { retryCount: 2, retryDelay: 500 }),
  http("https://polygon-amoy.drpc.org", { retryCount: 2, retryDelay: 500 }),
].filter(Boolean) as ReturnType<typeof http>[];

const baseSepoliaTransports = [
  http("https://sepolia.base.org", { retryCount: 2, retryDelay: 500 }),
  http("https://base-sepolia-rpc.publicnode.com", { retryCount: 2, retryDelay: 500 }),
].filter(Boolean) as ReturnType<typeof http>[];

const arbSepoliaTransports = [
  http("https://sepolia-rollup.arbitrum.io/rpc", { retryCount: 2, retryDelay: 500 }),
  http("https://arbitrum-sepolia-rpc.publicnode.com", { retryCount: 2, retryDelay: 500 }),
].filter(Boolean) as ReturnType<typeof http>[];

const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks: [polygon, polygonAmoy, baseSepolia, arbitrumSepolia],
  transports: {
    [polygon.id]: fallback(polygonTransports, { rank: true }),
    [polygonAmoy.id]: fallback(amoyTransports, { rank: true }),
    [baseSepolia.id]: fallback(baseSepoliaTransports, { rank: true }),
    [arbitrumSepolia.id]: fallback(arbSepoliaTransports, { rank: true }),
  },
  ssr: true,
});

export const config = wagmiAdapter.wagmiConfig;

createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks: [polygon, polygonAmoy, baseSepolia, arbitrumSepolia],
  metadata: {
    name: "Trestle DeFi",
    description: "Trestle Telegram Mini App",
    url: import.meta.env.VITE_SITE_URL || "https://trestle.website",
    icons: [`${import.meta.env.VITE_SITE_URL || "https://trestle.website"}/favicon.svg`],
  },
  features: {
    email: true,
    socials: ["google", "github", "discord"],
  },
  themeMode: "light",
  themeVariables: {
    "--w3m-color-mix": "#059669",
    "--w3m-color-mix-strength": 20,
  },
});

export { polygon, polygonAmoy, baseSepolia, arbitrumSepolia };
