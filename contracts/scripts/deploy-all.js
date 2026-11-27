import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Hardhat 3 ships its CLI next to the package entry point.
const hardhatCli = join(dirname(fileURLToPath(import.meta.resolve("hardhat"))), "cli.js");

const steps = [
  ["Unichain Sepolia sub-account", "unichainSepolia", "scripts/deploy-subaccount.js"],
  ["Lasna reactive guard", "lasnaTestnet", "scripts/deploy-reactiveguard.js"],
  ["Base Sepolia main vault", "baseSepolia", "scripts/deploy-mainvault.js"],
  ["Base Sepolia CCIP bridge", "baseSepolia", "scripts/deploy-ccipbridge.js"],
  // The receiver's constructor takes the sub-account registry address, so the
  // registry must be deployed (and its entry created) before the receiver.
  ["Unichain Sepolia sub-account setup", "unichainSepolia", "scripts/setup-unichain.js"],
  ["Unichain Sepolia CCIP receiver", "unichainSepolia", "scripts/deploy-ccipreceiver.js"],
  ["Base Sepolia setup", "baseSepolia", "scripts/setup-baseSepolia.js"],
  ["Lasna setup", "lasnaTestnet", "scripts/setup-lasna.js"],
  ["Cross-chain setup", "lasnaTestnet", "scripts/setup-crosschain.js"],
];

function main() {
  console.log("=== Deploying and Configuring All Set & Forget Contracts ===\n");
  for (const [index, [label, network, script]] of steps.entries()) {
    console.log(`[${index + 1}/${steps.length}] ${label}...`);
    const result = spawnSync(
      process.execPath,
      [hardhatCli, "run", script, "--network", network],
      { stdio: "inherit", env: process.env },
    );
    if (result.status !== 0) {
      throw new Error(`${label} failed with exit code ${result.status}`);
    }
    console.log("");
  }
  console.log("=== Deployment and Configuration Complete ===");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}