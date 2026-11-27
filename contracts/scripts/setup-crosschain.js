import hre from "hardhat";
import fs from "node:fs";

const connection = await hre.network.create();
const { ethers } = connection;

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
  const [deployer] = await ethers.getSigners();
  // The per-user key: the USER's address. The registry contract address is
  // only the log origin the guard watches.
  const operator = process.env.SUBACCOUNT_OPERATOR_ADDRESS || deployer.address;

  console.log("Deployer:", deployer.address);
  console.log("TrestleSubAccount (Unichain):", subAccountAddress);
  console.log("TrestleMainVault (Base):", mainVaultAddress);
  console.log("TrestleReactiveGuard (Lasna):", reactiveGuardAddress);

  // 1. Set callback recipient on guard
  console.log("\\n--- Setting callback recipient on ReactiveGuard ---");
  const reactiveGuard = await ethers.getContractFactory("TrestleReactiveGuard");
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
  const registeredOwner = await guardContract.subAccountOwners(operator);
  console.log("Current registered owner:", registeredOwner);
  if (registeredOwner === "0x0000000000000000000000000000000000000000") {
    const tx = await guardContract.registerSubAccount(operator);
    await tx.wait();
    console.log("✅ Registered sub-account owner:", deployer.address);
  } else {
    console.log("✅ Sub-account already registered to:", registeredOwner);
  }

  // 4. Setup subscription on ReactiveGuard
  console.log("\\n--- Setting up subscription on ReactiveGuard ---");
  const subscription = await guardContract.getSubscriptionStatus(operator);
  console.log("Current subscription:", subscription);
  if (!subscription.isActive) {
    const maxDailyRefills = 10;
    const cooldown = Number(process.env.SUBACCOUNT_COOLDOWN_SECONDS || "300");
    // Disambiguate the 3-arg overload from the legacy 2-arg one.
    const tx = await guardContract["setupSubscription(address,uint64,uint64)"](operator, maxDailyRefills, cooldown);
    await tx.wait();
    console.log("✅ Subscription created on ReactiveGuard:");
    console.log("   Sub-account owner:", operator);
    console.log("   Max Daily Refills:", maxDailyRefills);
    console.log("   Cooldown (seconds):", cooldown);
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