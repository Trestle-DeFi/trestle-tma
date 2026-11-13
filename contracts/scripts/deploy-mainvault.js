const hre = require("hardhat");
const fs = require("fs");

async function main() {
  console.log("=== Deploying TrestleMainVault to Base Sepolia ===");
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const TrestleMainVault = await hre.ethers.getContractFactory("TrestleMainVault");
  const mainVault = await TrestleMainVault.deploy();
  await mainVault.waitForDeployment();
  const address = await mainVault.getAddress();
  console.log("TrestleMainVault deployed to:", address);
  console.log("Network: Base Sepolia (Chain ID: 84532)");
  console.log("Explorer: https://sepolia.basescan.org");

  const deployment = {
    network: "baseSepolia",
    contract: "TrestleMainVault",
    address: address,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    txHash: mainVault.deploymentTransaction().hash
  };

  fs.mkdirSync("./deployments", { recursive: true });
  fs.writeFileSync("./deployments/baseSepolia-TrestleMainVault.json", JSON.stringify(deployment, null, 2));
  console.log("Deployment info saved to deployments/baseSepolia-TrestleMainVault.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});