const hre = require("hardhat");
const fs = require("fs");

async function main() {
  console.log("=== Configure MainVault on Base Sepolia ===\n");

  const mainVaultDeploy = JSON.parse(
    fs.readFileSync("./deployments/baseSepolia-TrestleMainVault.json", "utf8")
  );
  const reactiveGuardDeploy = JSON.parse(
    fs.readFileSync("./deployments/lasnaTestnet-TrestleReactiveGuard.json", "utf8")
  );

  const mainVaultAddress = mainVaultDeploy.address;
  const reactiveGuardAddress = reactiveGuardDeploy.address;
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deployer:", deployer.address);
  console.log("MainVault address:", mainVaultAddress);
  console.log("ReactiveGuard (Lasna) address:", reactiveGuardAddress);

  // Set reactiveContract on MainVault
  console.log("\n--- Setting reactiveContract on MainVault ---");
  const mainVault = await hre.ethers.getContractFactory("TrestleMainVault");
  const vaultContract = mainVault.attach(mainVaultAddress);
  
  const currentReactive = await vaultContract.reactiveContract();
  console.log("Current reactiveContract:", currentReactive);
  
  if (currentReactive !== reactiveGuardAddress) {
    const tx = await vaultContract.setReactiveContract(reactiveGuardAddress);
    await tx.wait();
    console.log("Set reactiveContract on MainVault to:", reactiveGuardAddress);
  } else {
    console.log("reactiveContract already set correctly");
  }

  console.log("\n=== Base Sepolia Configuration Complete ===");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
