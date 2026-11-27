import hre from "hardhat";
import { ethers } from "ethers";

const connection = await hre.network.create();
const { ethers: hardhatEthers } = connection;

async function main() {
  const [deployer] = await hardhatEthers.getSigners();
  const baseBal = await hardhatEthers.provider.getBalance(deployer.address);
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
