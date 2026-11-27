import hre from "hardhat";
import fs from "node:fs";

const connection = await hre.network.create();
const { ethers } = connection;

function readDeployment(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

async function main() {
  const vaultInfo = readDeployment("./deployments/baseSepolia-TrestleMainVault.json");
  const vaultAddress = vaultInfo.address;
  const vault = await ethers.getContractAt("TrestleMainVault", vaultAddress);
  const balance = await ethers.provider.getBalance(vaultAddress);
  console.log("Vault address:", vaultAddress);
  console.log("Vault balance (wei):", balance.toString());
  console.log("Vault balance (ETH):", ethers.formatEther(balance));
}

main().catch(console.error);
