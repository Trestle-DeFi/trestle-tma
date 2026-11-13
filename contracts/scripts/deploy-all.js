const hre = require("hardhat");
const fs = require("fs");

async function main() {
  console.log("=== Deploying All Set & Forget Contracts ===\n");

  const deployments = {};

  // 1. Deploy TrestleSubAccount to Unichain Sepolia
  console.log("[1/3] Deploying TrestleSubAccount to Unichain Sepolia...");
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const TrestleSubAccount = await hre.ethers.getContractFactory("TrestleSubAccount");
  const subAccount = await TrestleSubAccount.deploy();
  await subAccount.waitForDeployment();
  const subAccountAddr = await subAccount.getAddress();
  deployments.unichainSepolia = {
    contract: "TrestleSubAccount",
    address: subAccountAddr,
    txHash: subAccount.deploymentTransaction().hash
  };
  console.log("  ->", subAccountAddr, "\n");

  // 2. Deploy TrestleMainVault to Base Sepolia
  console.log("[2/3] Deploying TrestleMainVault to Base Sepolia...");
  const TrestleMainVault = await hre.ethers.getContractFactory("TrestleMainVault");
  const mainVault = await TrestleMainVault.deploy();
  await mainVault.waitForDeployment();
  const mainVaultAddr = await mainVault.getAddress();
  deployments.baseSepolia = {
    contract: "TrestleMainVault",
    address: mainVaultAddr,
    txHash: mainVault.deploymentTransaction().hash
  };
  console.log("  ->", mainVaultAddr, "\n");

  // 3. Deploy TrestleReactiveGuard to Lasna Testnet
  console.log("[3/3] Deploying TrestleReactiveGuard to Lasna Testnet...");
  const TrestleReactiveGuard = await hre.ethers.getContractFactory("TrestleReactiveGuard");
  const reactiveGuard = await TrestleReactiveGuard.deploy();
  await reactiveGuard.waitForDeployment();
  const reactiveGuardAddr = await reactiveGuard.getAddress();
  deployments.lasnaTestnet = {
    contract: "TrestleReactiveGuard",
    address: reactiveGuardAddr,
    txHash: reactiveGuard.deploymentTransaction().hash
  };
  console.log("  ->", reactiveGuardAddr, "\n");

  // Save all deployments
  fs.mkdirSync("./deployments", { recursive: true });
  fs.writeFileSync("./deployments/all-deployments.json", JSON.stringify({
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    deployments: deployments
  }, null, 2));

  console.log("=== Deployment Complete ===");
  console.log("Summary:");
  console.log("  Unichain Sepolia - TrestleSubAccount:", deployments.unichainSepolia.address);
  console.log("  Base Sepolia - TrestleMainVault:", deployments.baseSepolia.address);
  console.log("  Lasna Testnet - TrestleReactiveGuard:", deployments.lasnaTestnet.address);
  console.log("\nDeployment info saved to deployments/all-deployments.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});