const hre = require("hardhat");
const fs = require("fs");

async function main() {
  console.log("=== Cross-Chain Configuration ===\\n");

  // Read deployment info
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

  // 1. Set callback recipient on guard
  console.log("\\n--- Setting callback recipient on ReactiveGuard ---");
  const reactiveGuard = await hre.ethers.getContractFactory("TrestleReactiveGuard");
  const guardContract = reactiveGuard.attach(reactiveGuardAddress);
  const currentRecipient = await guardContract.callbackRecipient();
  console.log("Current callbackRecipient:", currentRecipient);
  if (currentRecipient !== mainVaultAddress) {
    const tx = await guardContract.setCallbackRecipient(mainVaultAddress);
    await tx.wait();
    console.log("✅ Set callbackRecipient on ReactiveGuard to:", mainVaultAddress);
  } else {
    console.log("✅ callbackRecipient already set correctly");
  }

  // 3. Register sub-account on guard (if not already)
  console.log("\\n--- Registering sub-account on ReactiveGuard ---");
  const registeredOwner = await guardContract.subAccountOwners(subAccountAddress);
  console.log("Current registered owner:", registeredOwner);
  if (registeredOwner === "0x0000000000000000000000000000000000000000") {
    const tx = await guardContract.registerSubAccount(subAccountAddress);
    await tx.wait();
    console.log("✅ Registered sub-account owner:", deployer.address);
  } else {
    console.log("✅ Sub-account already registered to:", registeredOwner);
  }

  // 4. Setup subscription on ReactiveGuard
  console.log("\\n--- Setting up subscription on ReactiveGuard ---");
  const subscription = await guardContract.getSubscriptionStatus(subAccountAddress);
  console.log("Current subscription:", subscription);
  if (!subscription.isActive) {
    const maxDailyRefills = 10;
    const tx = await guardContract.setupSubscription(subAccountAddress, maxDailyRefills);
    await tx.wait();
    console.log("✅ Subscription created on ReactiveGuard:");
    console.log("   SubAccount:", subAccountAddress);
    console.log("   Max Daily Refills:", maxDailyRefills);
  } else {
    console.log("✅ Subscription already exists:");
    console.log("   Active:", subscription.isActive);
    console.log("   Daily Refills:", subscription.dailyRefillCount, "/", subscription.maxDailyRefills);
  }

  console.log("\\n=== Cross-Chain Configuration Complete ===");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});