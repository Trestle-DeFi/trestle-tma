const hre = require("hardhat");
const fs = require("fs");

function readDeployment(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

async function main() {
  const vaultInfo = readDeployment("./deployments/baseSepolia-TrestleMainVault.json");
  const vaultAddress = vaultInfo.address;
  const vault = await hre.ethers.getContractAt("TrestleMainVault", vaultAddress);
  const balance = await hre.ethers.provider.getBalance(vaultAddress);
  console.log("Vault address:", vaultAddress);
  console.log("Vault balance (wei):", balance.toString());
  console.log("Vault balance (ETH):", hre.ethers.formatEther(balance));
}

main().catch(console.error);
