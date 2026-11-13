const hre = require("hardhat");
const fs = require("fs");

async function main() {
  console.log("=== Deploying TrestleReactiveGuard to Lasna Testnet ===");
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const TrestleReactiveGuard = await hre.ethers.getContractFactory("TrestleReactiveGuard");
  const reactiveGuard = await TrestleReactiveGuard.deploy();
  await reactiveGuard.waitForDeployment();
  const address = await reactiveGuard.getAddress();
  console.log("TrestleReactiveGuard deployed to:", address);
  console.log("Network: Lasna Testnet (Chain ID: 5318007)");
  console.log("Explorer: https://explorer.testnet.reactivenetwork.org");

  const deployment = {
    network: "lasnaTestnet",
    contract: "TrestleReactiveGuard",
    address: address,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    txHash: reactiveGuard.deploymentTransaction().hash
  };

  fs.mkdirSync("./deployments", { recursive: true });
  fs.writeFileSync("./deployments/lasnaTestnet-TrestleReactiveGuard.json", JSON.stringify(deployment, null, 2));
  console.log("Deployment info saved to deployments/lasnaTestnet-TrestleReactiveGuard.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});