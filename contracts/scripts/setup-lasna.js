import hre from "hardhat";
import fs from "node:fs";

const connection = await hre.network.create();
const { ethers } = connection;

function readDeployment(path) {
  if (!fs.existsSync(path)) {
    throw new Error(`Missing deployment file ${path}`);
  }
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

async function main() {
  console.log("=== Configure ReactiveGuard on Lasna Testnet ===\n");
  const guardAddress = readDeployment(
    "./deployments/lasnaTestnet-TrestleReactiveGuard.json",
  ).address;
  const subAccountAddress = readDeployment(
    "./deployments/unichainSepolia-TrestleSubAccount.json",
  ).address;
  const vaultAddress = readDeployment(
    "./deployments/baseSepolia-TrestleMainVault.json",
  ).address;
  const [deployer] = await ethers.getSigners();

  // Everything below runs on Lasna; the sub-account and vault addresses are
  // configuration values only and must not be read through this RPC.
  const code = await ethers.provider.getCode(guardAddress);
  if (code === "0x") {
    throw new Error(
      `No bytecode at ${guardAddress} on Lasna. Check LASNA_TESTNET_RPC.`,
    );
  }

  const guard = (
    await ethers.getContractFactory("TrestleReactiveGuard")
  ).attach(guardAddress);

  // The guard subscribes as origin to the shared sub-account contract, so a
  // stale origin would silently ignore every low-balance log.
  const expectedOriginChainId = BigInt(process.env.ORIGIN_CHAIN_ID || "1301");
  const originContract = await guard.ORIGIN_CONTRACT();
  const originChainId = await guard.ORIGIN_CHAIN_ID();
  if (originContract.toLowerCase() !== subAccountAddress.toLowerCase()) {
    throw new Error(
      `Guard origin ${originContract} does not match sub-account ${subAccountAddress}`,
    );
  }
  if (originChainId !== expectedOriginChainId) {
    throw new Error(
      `Guard origin chain ${originChainId} does not match ${expectedOriginChainId}`,
    );
  }

  if ((await guard.callbackRecipient()) !== vaultAddress) {
    await (await guard.setCallbackRecipient(vaultAddress)).wait();
    console.log("Guard callbackRecipient configured");
  }

  // Subscriptions are keyed by the indexed account in LowBalanceDetected,
  // which is the sub-account owner/operator that calls spend().
  const operator = process.env.SUBACCOUNT_OPERATOR_ADDRESS || deployer.address;

  // Registration is self-service: the account that owns the sub-account
  // registers it and subscribes it, with no protocol owner involvement.
  const registeredOwner = await guard.subAccountOwners(operator);
  if (registeredOwner === "0x0000000000000000000000000000000000000000") {
    await (await guard.registerSubAccount(operator)).wait();
    console.log("Guard sub-account registered for", operator);
  } else {
    console.log("Guard sub-account already registered to", registeredOwner);
  }

  const subscription = await guard.getSubscriptionStatus(operator);
  if (!subscription.isActive) {
    const maxDailyRefills = process.env.MAX_DAILY_REFILLS || "10";
    const cooldown = Number(process.env.SUBACCOUNT_COOLDOWN_SECONDS || "300");
    // The guard deliberately keeps a 2-arg legacy overload alongside the 3-arg
    // one, so ethers v6 must be given the full signature to disambiguate.
    await (
      await guard["setupSubscription(address,uint64,uint64)"](operator, Number(maxDailyRefills), cooldown)
    ).wait();
    console.log("Guard subscription configured for", operator);
  } else {
    console.log("Guard subscription already active for", operator);
  }

  console.log("Deployer:", deployer.address);
  console.log("Sub-account contract:", subAccountAddress);
  console.log("Subscription subject:", operator);
  console.log("MainVault (callback recipient):", vaultAddress);
  console.log("ReactiveGuard:", guardAddress);
  console.log("=== Lasna Testnet Configuration Complete ===");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
