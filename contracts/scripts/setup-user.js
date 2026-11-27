const hre = require("hardhat");
const fs = require("fs");

/**
 * Set & Forget — complete self-service onboarding for ONE user.
 *
 * Every transaction in this script is sent by the USER's own key. The
 * protocol owner never funds a reserve and never configures a user's
 * settings: the user opens their sub-account, funds their own operational
 * wallet and their own cross-chain reserve, picks their own daily caps and
 * cooldowns, and registers their own reactive subscription.
 *
 * The protocol owner is only used as a fallback for the two steps that
 * cannot be self-signed when the signer is not the user
 * (`createSubAccountFor` and the guard's `registerSubAccount`), and only when
 * the signer really is the owner.
 *
 * Usage:
 *   npx hardhat run scripts/setup-user.js --network baseSepolia
 *
 * Environment:
 *   SET_FORGET_USER_ADDRESS      the user's EOA (defaults to the signer)
 *   SET_FORGET_THRESHOLD_WEI     low-balance threshold        (default 0.005 ETH)
 *   SET_FORGET_TARGET_WEI        refill target                (default 0.01 ETH)
 *   SET_FORGET_COOLDOWN_SECONDS  source spend cooldown        (default 300)
 *   SET_FORGET_MAX_DAILY_SPENDS  source daily spend cap       (default 10)
 *   SET_FORGET_GUARD_COOLDOWN    reactive guard cooldown       (default 300)
 *   SET_FORGET_MAX_DAILY_REFILLS reactive daily refill cap    (default 5)
 *   SET_FORGET_DAILY_REQUESTS    vault daily request cap      (default 10)
 *   SET_FORGET_OPERATIONAL_WEI   ETH for the operational wallet (optional)
 *   SET_FORGET_RESERVE_WEI       ETH for the cross-chain reserve (optional)
 */

function readDeployment(path) {
  if (!fs.existsSync(path)) {
    throw new Error(`Missing deployment file ${path}. Run deploy:all first.`);
  }
  return JSON.parse(fs.readFileSync(path, "utf8")).address;
}

function connect(rpcEnvVar, label) {
  const url = process.env[rpcEnvVar];
  if (!url) throw new Error(`Missing ${rpcEnvVar} in the environment`);
  const provider = new hre.ethers.JsonRpcProvider(url);
  if (!process.env.PRIVATE_KEY) throw new Error("Missing PRIVATE_KEY in the environment");
  const wallet = new hre.ethers.Wallet(process.env.PRIVATE_KEY, provider);
  return { provider, wallet, label };
}

function envWei(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return hre.ethers.parseUnits(raw, "wei");
}

async function main() {
  console.log("=== Set & Forget — self-service onboarding for one user ===\n");

  const registryAddress = readDeployment("./deployments/unichainSepolia-TrestleSubAccount.json");
  const vaultAddress = readDeployment("./deployments/baseSepolia-TrestleMainVault.json");
  const bridgeAddress = readDeployment("./deployments/baseSepolia-TrestleCCIPBridge.json");
  const receiverAddress = readDeployment("./deployments/unichainSepolia-TrestleCCIPReceiver.json");
  const guardAddress = readDeployment("./deployments/lasnaTestnet-TrestleReactiveGuard.json");

  const unichain = connect("UNICHAIN_SEPOLIA_RPC", "Unichain Sepolia");
  const base = connect("BASE_SEPOLIA_RPC", "Base Sepolia");
  const lasna = connect("LASNA_TESTNET_RPC", "Lasna Testnet");

  const signerAddress = await base.wallet.getAddress();
  const user = process.env.SET_FORGET_USER_ADDRESS || signerAddress;
  const isSelfService = user.toLowerCase() === signerAddress.toLowerCase();

  console.log("Signer (user key):", signerAddress);
  console.log("User address      :", user);
  console.log("Self-service mode :", isSelfService ? "yes" : "no (owner-assisted steps only)");

  const threshold = envWei("SET_FORGET_THRESHOLD_WEI", hre.ethers.parseEther("0.005"));
  const target = envWei("SET_FORGET_TARGET_WEI", hre.ethers.parseEther("0.01"));
  const cooldown = Number(process.env.SET_FORGET_COOLDOWN_SECONDS || "300");
  const maxDaily = Number(process.env.SET_FORGET_MAX_DAILY_SPENDS || "10");
  const guardCooldown = Number(process.env.SET_FORGET_GUARD_COOLDOWN || "300");
  const maxDailyRefills = Number(process.env.SET_FORGET_MAX_DAILY_REFILLS || "5");
  const dailyRequests = Number(process.env.SET_FORGET_DAILY_REQUESTS || "10");
  const operationalWei = process.env.SET_FORGET_OPERATIONAL_WEI
    ? hre.ethers.parseEther(process.env.SET_FORGET_OPERATIONAL_WEI)
    : null;
  const reserveWei = process.env.SET_FORGET_RESERVE_WEI
    ? hre.ethers.parseEther(process.env.SET_FORGET_RESERVE_WEI)
    : null;

  // ── 1. Unichain: open the sub-account and fund the operational wallet ────
  console.log("\n--- 1/3  Unichain Sepolia: sub-account ---");
  const registry = (await hre.ethers.getContractFactory("TrestleSubAccount"))
    .connect(unichain.wallet)
    .attach(registryAddress);

  if (await registry.isSubAccountActive(user)) {
    console.log("Sub-account already active for", user);
  } else if (isSelfService) {
    const tx = await registry.createSubAccount(vaultAddress, threshold, target, cooldown, maxDaily);
    await tx.wait();
    console.log("✅ Sub-account opened by the user:", user);
  } else if ((await registry.owner()) === signerAddress) {
    const tx = await registry.createSubAccountFor(user, vaultAddress, threshold, target, cooldown, maxDaily);
    await tx.wait();
    console.log("✅ Sub-account opened by the owner for:", user);
  } else {
    throw new Error("The signer is neither the user nor the registry owner — ask the user to run this script");
  }

  if (operationalWei && operationalWei > 0n) {
    if (!isSelfService) {
      console.log("⚠️  Skipping the operational deposit: only the user can fund their own wallet");
    } else {
      const tx = await registry.depositTopUp({ value: operationalWei });
      await tx.wait();
      console.log("✅ Operational wallet funded:", hre.ethers.formatEther(operationalWei), "ETH");
    }
  }

  const creditor = await registry.bridgeCreditor();
  if (creditor.toLowerCase() !== receiverAddress.toLowerCase()) {
    console.log("⚠️  bridgeCreditor is", creditor, "but the CCIP receiver is", receiverAddress);
    console.log("   Run deploy:ccipReceiver / setup:unichainSepolia to rewire it.");
  } else {
    console.log("✅ bridgeCreditor points at the CCIP receiver");
  }


  // ── 2. Base: fund the reserve and set the daily request cap ─────────────
  console.log("\n--- 2/3  Base Sepolia: reserve ---");
  const vault = (await hre.ethers.getContractFactory("TrestleMainVault"))
    .connect(base.wallet)
    .attach(vaultAddress);
  const bridge = (await hre.ethers.getContractFactory("TrestleCCIPBridge"))
    .connect(base.wallet)
    .attach(bridgeAddress);

  const feeQuote = await bridge.quoteFee();
  console.log("Quoted CCIP fee per top-up:", hre.ethers.formatEther(feeQuote), "ETH (paid by the user)");

  if (reserveWei && reserveWei > 0n) {
    if (!isSelfService) {
      console.log("⚠️  Skipping the reserve deposit: only the user can fund their own reserve");
    } else {
      const tx = await vault.depositFor(user, { value: reserveWei });
      await tx.wait();
      console.log("✅ Cross-chain reserve funded:", hre.ethers.formatEther(reserveWei), "ETH");
    }
  }

  if (isSelfService) {
    const tx = await vault.setMyDailyRequestLimit(dailyRequests);
    await tx.wait();
    console.log("✅ User daily request cap set to", dailyRequests);
  } else {
    console.log("⚠️  Skipping the daily request cap: only the user can set their own cap");
  }

  console.log("Reserve balance    :", hre.ethers.formatEther(await vault.balances(user)), "ETH");
  console.log("Effective daily cap:", (await vault.getEffectiveDailyLimit(user)).toString());

  // ── 3. Lasna: register and subscribe ─────────────────────────────────────
  console.log("\n--- 3/3  Lasna Testnet: reactive subscription ---");
  const guard = (await hre.ethers.getContractFactory("TrestleReactiveGuard"))
    .connect(lasna.wallet)
    .attach(guardAddress);

  if ((await guard.callbackRecipient()) !== vaultAddress) {
    if ((await guard.owner()) !== signerAddress) {
      throw new Error("The guard callbackRecipient still points at the old vault and only the owner can rewire it");
    }
    const tx = await guard.setCallbackRecipient(vaultAddress);
    await tx.wait();
    console.log("✅ Guard callbackRecipient rewired to the vault");
  }

  const registeredOwner = await guard.subAccountOwners(user);
  if (registeredOwner === hre.ethers.ZeroAddress) {
    if (!isSelfService && (await guard.owner()) !== signerAddress) {
      throw new Error("The signer is neither the user nor the guard owner — ask the user to register themselves");
    }
    const tx = await guard.registerSubAccount(user);
    await tx.wait();
    console.log("✅ Sub-account registered on the guard");
  } else {
    console.log("Sub-account already registered to", registeredOwner);
  }

  const subscription = await guard.getSubscriptionStatus(user);
  if (!subscription.isActive) {
    // Disambiguate the 3-arg overload from the legacy 2-arg one.
    const tx = await guard["setupSubscription(address,uint64,uint64)"](user, maxDailyRefills, guardCooldown);
    await tx.wait();
    console.log("✅ Reactive subscription created (cooldown", guardCooldown + "s)");
  } else {
    console.log("Subscription already active (cooldown", subscription.cooldown.toString() + "s)");
  }

  console.log("\n=== Onboarding complete ===");
  console.log("Every refill is paid from the user's own reserve. The protocol holds no capital.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

