import hre from "hardhat";
import fs from "node:fs";

const connection = await hre.network.create();
const { ethers } = connection;

async function main() {
  console.log("=== Deploying TrestleSubAccount to Unichain Sepolia ===");
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const TrestleSubAccount = await ethers.getContractFactory("TrestleSubAccount");
  const subAccount = await TrestleSubAccount.deploy();
  await subAccount.waitForDeployment();
  const address = await subAccount.getAddress();
  console.log("TrestleSubAccount deployed to:", address);
  console.log("Network: Unichain Sepolia (Chain ID: 1301)");
  console.log("Explorer: https://sepolia.uniscan.org");

  const deployment = {
    network: "unichainSepolia",
    contract: "TrestleSubAccount",
    address: address,
    deployer: deployer.address,
    constructorArgs: [],
    timestamp: new Date().toISOString(),
    txHash: subAccount.deploymentTransaction().hash
  };

  fs.mkdirSync("./deployments", { recursive: true });
  fs.writeFileSync("./deployments/unichainSepolia-TrestleSubAccount.json", JSON.stringify(deployment, null, 2));
  console.log("Deployment info saved to deployments/unichainSepolia-TrestleSubAccount.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});