const { spawnSync } = require("child_process");

const steps = [
  ["Unichain Sepolia sub-account", "unichainSepolia", "scripts/deploy-subaccount.js"],
  ["Lasna reactive guard", "lasnaTestnet", "scripts/deploy-reactiveguard.js"],
  ["Base Sepolia main vault", "baseSepolia", "scripts/deploy-mainvault.js"],
  ["Base Sepolia CCIP bridge", "baseSepolia", "scripts/deploy-ccipbridge.js"],
  // The receiver constructor path requires an existing bridgeCreditAccount, so
  // the sub-account must be created (against the newly deployed vault) first.
  ["Unichain Sepolia sub-account setup", "unichainSepolia", "scripts/setup-unichain.js"],
  ["Unichain Sepolia CCIP receiver", "unichainSepolia", "scripts/deploy-ccipreceiver.js"],
  ["Base Sepolia setup", "baseSepolia", "scripts/setup-baseSepolia.js"],
  ["Lasna setup", "lasnaTestnet", "scripts/setup-lasna.js"],
];

function main() {
  console.log("=== Deploying and Configuring All Set & Forget Contracts ===\n");
  for (const [index, [label, network, script]] of steps.entries()) {
    console.log(`[${index + 1}/${steps.length}] ${label}...`);
    const result = spawnSync(
      process.execPath,
      [require.resolve("hardhat/internal/cli/cli"), "run", script, "--network", network],
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