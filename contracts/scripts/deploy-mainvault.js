const hre = require("hardhat");
const fs = require("fs");

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

async function main() {
  console.log("=== Deploying TrestleMainVault to Base Sepolia ===");
  const [deployer] = await hre.ethers.getSigners();
  const callbackProxy = requiredEnv("REACTIVE_CALLBACK_PROXY_BASE_SEPOLIA");
  const reactiveSender =
    process.env.REACTIVE_GUARD_ADDRESS ||
    JSON.parse(
      fs.readFileSync("./deployments/lasnaTestnet-TrestleReactiveGuard.json", "utf8"),
    ).address;

  console.log("Deployer:", deployer.address);
  console.log("Reactive callback proxy:", callbackProxy);
  console.log("Reactive callback sender:", reactiveSender);

  const TrestleMainVault = await hre.ethers.getContractFactory("TrestleMainVault");
  const mainVault = await TrestleMainVault.deploy(callbackProxy, reactiveSender);
  await mainVault.waitForDeployment();
  const address = await mainVault.getAddress();

  const deployment = {
    network: "baseSepolia",
    contract: "TrestleMainVault",
    address,
    deployer: deployer.address,
    callbackProxy,
    reactiveSender,
    constructorArgs: [callbackProxy, reactiveSender],
    timestamp: new Date().toISOString(),
    txHash: mainVault.deploymentTransaction().hash,
  };

  fs.mkdirSync("./deployments", { recursive: true });
  fs.writeFileSync(
    "./deployments/baseSepolia-TrestleMainVault.json",
    JSON.stringify(deployment, null, 2),
  );
  console.log("TrestleMainVault deployed to:", address);
  console.log("Deployment info saved to deployments/baseSepolia-TrestleMainVault.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
