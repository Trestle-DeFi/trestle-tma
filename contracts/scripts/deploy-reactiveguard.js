import hre from "hardhat";
import fs from "node:fs";
import { ethers } from "ethers";

const connection = await hre.network.create();
const { ethers: hardhatEthers } = connection;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

async function main() {
  console.log("=== Deploying TrestleReactiveGuard to Lasna Testnet ===");
  const [deployer] = await hardhatEthers.getSigners();
  const originChainId = process.env.ORIGIN_CHAIN_ID || "1301";
  const originContract =
    process.env.SUBACCOUNT_ADDRESS ||
    JSON.parse(
      fs.readFileSync("./deployments/unichainSepolia-TrestleSubAccount.json", "utf8"),
    ).address;
  const topic =
    process.env.LOW_BALANCE_TOPIC ||
    ethers.id("LowBalanceDetected(address,uint256,uint256,uint64)");

  console.log("Deployer:", deployer.address);
  console.log("Origin chain ID:", originChainId);
  console.log("Origin contract:", originContract);
  console.log("Low-balance topic:", topic);

  const TrestleReactiveGuard = await hardhatEthers.getContractFactory("TrestleReactiveGuard");
  const reactiveGuard = await TrestleReactiveGuard.deploy(originChainId, originContract, topic);
  await reactiveGuard.waitForDeployment();
  const address = await reactiveGuard.getAddress();

  const deployment = {
    network: "lasnaTestnet",
    contract: "TrestleReactiveGuard",
    address,
    deployer: deployer.address,
    originChainId: Number(originChainId),
    originContract,
    lowBalanceTopic: topic,
    constructorArgs: [Number(originChainId), originContract, topic],
    timestamp: new Date().toISOString(),
    txHash: reactiveGuard.deploymentTransaction().hash,
  };

  fs.mkdirSync("./deployments", { recursive: true });
  fs.writeFileSync(
    "./deployments/lasnaTestnet-TrestleReactiveGuard.json",
    JSON.stringify(deployment, null, 2),
  );
  console.log("TrestleReactiveGuard deployed to:", address);
  console.log("Deployment info saved to deployments/lasnaTestnet-TrestleReactiveGuard.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
