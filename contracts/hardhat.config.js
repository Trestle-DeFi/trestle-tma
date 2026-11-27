import { defineConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import hardhatFoundry from "@nomicfoundation/hardhat-foundry";
import dotenv from "dotenv";

dotenv.config();

export default defineConfig({
  // The Foundry compatibility plugin keeps the forge-std based test suite out
  // of Hardhat's compilation graph; the tests are run with `forge test`.
  plugins: [hardhatEthers, hardhatVerify, hardhatFoundry],
  solidity: {
    version: "0.8.37",
    settings: {
      evmVersion: "cancun",
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  paths: {
    sources: "./src",
    tests: "./test",
    artifacts: "./artifacts",
    cache: "./cache",
  },
  networks: {
    hardhat: {
      type: "edr-simulated",
      chainId: 31337,
    },
    baseSepolia: {
      type: "http",
      // Base is an OP-stack chain; "op" selects the right hardfork behaviour.
      chainType: "op",
      chainId: 84532,
      url: process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    unichainSepolia: {
      type: "http",
      chainType: "op",
      chainId: 1301,
      url: process.env.UNICHAIN_SEPOLIA_RPC || "https://sepolia.unichain.org",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    lasnaTestnet: {
      type: "http",
      // Lasna is not an OP-stack chain, so it uses the generic chain type.
      chainType: "generic",
      chainId: 5318007,
      url: process.env.LASNA_TESTNET_RPC || "https://lasna-rpc.rnk.dev/",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
  verify: {
    // hardhat-verify talks to the Etherscan V2 unified API, which covers
    // Base Sepolia without a per-chain endpoint.
    etherscan: {
      apiKey: process.env.ETHERSCAN_API_KEY || "",
    },
    blockscout: {
      enabled: true,
    },
    sourcify: {
      // Lasna's Reactscan explorer reads verified sources from Sourcify (chain id 5318007)
      enabled: true,
      apiUrl: "https://sourcify.dev/server",
    },
  },
});
