const hre = require("hardhat");
const fs = require("fs");

async function main() {
  console.log("=== Configure ReactiveGuard on Lasna Testnet ===\n");

  const subAccountDeploy = JSON.parse(
    fs.readFileSync("./deployments/unichainSepolia-TrestleSubAccount.json", "utf8")
  );
  const mainVaultDeploy = JSON.parse(
    fs.readFileSync("./deployments/baseSepolia-TrestleMainVault.json", "utf8")
  );
  const reactiveGuardDeploy = JSON.parse(
    fs.readFileSync("./deployments/lasnaTestnet-TrestleReactiveGuard.json", "utf8")
  );

  const subAccountAddress = subAccountDeploy.address;
  const mainVaultAddress = mainVaultDeploy.address;
  const reactiveGuardAddress = reactiveGuardDeploy.address;
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deployer:", deployer.address);
  console.log("TrestleSubAccount (Unichain):", subAccountAddress);
  console.log("TrestleMainVault (Base):", mainVaultAddress);
  console.log("TrestleReactiveGuard (Lasna):", reactiveGuardAddress);

  // Set reactiveSender on ReactiveGuard
  console.log("\n--- Setting reactiveSender on ReactiveGuard ---");
  const reactiveGuard = await hre.ethers.getContractFactory("TrestleReactiveGuard");
  const guardContract = reactiveGuard.attach(reactiveGuardAddress);
  
  const currentSender = await guardContract.reactiveSender();
  console.log("Current reactiveSender:", currentSender);
  
  if (currentSender !== deployer.address) {
    const tx = await guardContract.setReactiveSender(deployer.address);
    await tx.wait();
    console.log("Set reactiveSender on ReactiveGuard to:", deployer.address);
  } else {
    console.log("reactiveSender already set correctly");
  }

  // Setup subscription on ReactiveGuard
  console.log("\n--- Setting up subscription on ReactiveGuard ---");
  const isSubscribed = await guardContract.getSubscriptionStatus(subAccountAddress);
  if (!isSubscribed.isActive) {
    const callbackUrl = "https://callback.trestle.website";
    const maxDailyRefills = 10;
    
    const tx = await guardContract.setupSubscription(
      subAccountAddress,
      mainVaultAddress,
      callbackUrl,
      maxDailyRefills
    );
    await tx.wait();
    console.log("Subscription created on ReactiveGuard:");
    console.log("  SubAccount:", subAccountAddress);
    console.log("  MainVault:", mainVaultAddress);
    console.log("  Callback URL:", callbackUrl);
    console.log("  Max Daily Refills:", maxDailyRefills);
  } else {
    console.log("Subscription already exists:");
    console.log("  Active:", isSubscribed.isActive);
    console.log("  MainVault:", isSubscribed.mainVault);
    console.log("  Daily Refills:", isSubscribed.dailyRefillCount, "/", isSubscribed.maxDailyRefills);
  }

  console.log("\n=== Lasna Testnet Configuration Complete ===");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
