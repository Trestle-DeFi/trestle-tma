const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();
  const baseBal = await ethers.provider.getBalance(deployer.address);
  const unichainBal = await new ethers.JsonRpcProvider(process.env.UNICHAIN_SEPOLIA_RPC || "https://sepolia.unichain.org").getBalance(deployer.address);
  const lasnaBal = await new ethers.JsonRpcProvider(process.env.LASNA_TESTNET_RPC || "https://lasna-rpc.rnk.dev/").getBalance(deployer.address);

  console.log("Deployer:", deployer.address);
  console.log("Base Sepolia balance (wei):", baseBal.toString());
  console.log("Base Sepolia balance (ETH):", ethers.formatEther(baseBal));
  console.log("Unichain Sepolia balance (wei):", unichainBal.toString());
  console.log("Unichain Sepolia balance (ETH):", ethers.formatEther(unichainBal));
  console.log("Lasna Testnet balance (wei):", lasnaBal.toString());
  console.log("Lasna Testnet balance (ETH):", ethers.formatEther(lasnaBal));
}

main().catch(console.error);
