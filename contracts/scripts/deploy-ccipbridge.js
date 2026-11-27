import hre from "hardhat";
import fs from "node:fs";

const connection = await hre.network.create();
const { ethers } = connection;

const BASE_SEPOLIA = {
  ccipRouter: "0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93",
  weth: "0x4200000000000000000000000000000000000006",
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  basePool: "0x46880b404CD35c165EDdefF7421019F8dD25F4Ad",
  destinationSelector: "14135854469784514356",
  sourceSelector: "10344971235874465080",
};

function readDeployment(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

async function main() {
  console.log("=== Deploying TrestleCCIPBridge to Base Sepolia ===");
  const [deployer] = await ethers.getSigners();
  const vault = readDeployment("./deployments/baseSepolia-TrestleMainVault.json").address;
  // The receiver address is configured after the receiver is deployed because
  // the receiver constructor needs this bridge's address.
  const destinationReceiver = "0x0000000000000000000000000000000000000000";

  const TrestleCCIPBridge = await ethers.getContractFactory("TrestleCCIPBridge");
  const bridge = await TrestleCCIPBridge.deploy(
    vault,
    BASE_SEPOLIA.ccipRouter,
    BASE_SEPOLIA.weth,
    BASE_SEPOLIA.usdc,
    BASE_SEPOLIA.basePool,
    BASE_SEPOLIA.destinationSelector,
    BASE_SEPOLIA.sourceSelector,
  );
  await bridge.waitForDeployment();
  const address = await bridge.getAddress();

  const deployment = {
    network: "baseSepolia",
    contract: "TrestleCCIPBridge",
    address,
    deployer: deployer.address,
    vault,
    destinationReceiver,
    constructorArgs: [
      vault,
      BASE_SEPOLIA.ccipRouter,
      BASE_SEPOLIA.weth,
      BASE_SEPOLIA.usdc,
      BASE_SEPOLIA.basePool,
      BASE_SEPOLIA.destinationSelector,
      BASE_SEPOLIA.sourceSelector,
    ],
    ...BASE_SEPOLIA,
    timestamp: new Date().toISOString(),
    txHash: bridge.deploymentTransaction().hash,
  };

  fs.mkdirSync("./deployments", { recursive: true });
  fs.writeFileSync(
    "./deployments/baseSepolia-TrestleCCIPBridge.json",
    JSON.stringify(deployment, null, 2),
  );
  console.log("TrestleCCIPBridge deployed to:", address);
  console.log("Deployment info saved to deployments/baseSepolia-TrestleCCIPBridge.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
