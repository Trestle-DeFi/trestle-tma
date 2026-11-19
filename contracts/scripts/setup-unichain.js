const hre = require("hardhat");
const fs = require("fs");

function readDeployment(path) {
  if (!fs.existsSync(path)) {
    throw new Error(`Missing deployment file ${path}`);
  }
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

async function main() {
  console.log("=== Configure TrestleSubAccount on Unichain Sepolia ===\n");

  const subAccountAddress = readDeployment(
    "./deployments/unichainSepolia-TrestleSubAccount.json",
  ).address;
  const vaultAddress = readDeployment(
    "./deployments/baseSepolia-TrestleMainVault.json",
  ).address;
  const [deployer] = await hre.ethers.getSigners();

  if (deployer.address === vaultAddress) {
    throw new Error("Deployer and MainVault must be distinct addresses");
  }

  // Guard against reading an address through the wrong RPC: every call below
  // targets Unichain Sepolia, where the sub-account must actually live.
  const code = await hre.ethers.provider.getCode(subAccountAddress);
  if (code === "0x") {
    throw new Error(
      `No bytecode at ${subAccountAddress} on Unichain Sepolia. Check UNICHAIN_SEPOLIA_RPC.`,
    );
  }

  const subAccount = (
    await hre.ethers.getContractFactory("TrestleSubAccount")
  ).attach(subAccountAddress);

  // createSubAccount is onlyOwner and registers msg.sender, so the operator
  // must be the contract owner. This account is also the indexed key the
  // reactive guard subscribes to.
  const owner = await subAccount.owner();
  const operator = process.env.SUBACCOUNT_OPERATOR_ADDRESS || deployer.address;
  if (operator.toLowerCase() !== owner.toLowerCase()) {
    throw new Error(
      `SUBACCOUNT_OPERATOR_ADDRESS ${operator} must be the TrestleSubAccount owner ${owner}`,
    );
  }

  const threshold = process.env.SUBACCOUNT_THRESHOLD_WEI || "1000000000000000";
  const target = process.env.SUBACCOUNT_TARGET_WEI || "10000000000000000";
  const cooldown = process.env.SUBACCOUNT_COOLDOWN_SECONDS || "300";
  const maxDaily = process.env.SUBACCOUNT_MAX_DAILY_SPENDS || "10";

  if (await subAccount.isSubAccountActive(operator)) {
    console.log("Sub-account already active for", operator);
    const existing = await subAccount.getSubAccountInfo(operator);
    if (existing.mainVault.toLowerCase() !== vaultAddress.toLowerCase()) {
      throw new Error(
        `Active sub-account points at MainVault ${existing.mainVault}, expected ${vaultAddress}. `
          + "Deactivate it on Unichain before re-running setup.",
      );
    }
  } else {
    const tx = await subAccount.createSubAccount(
      vaultAddress,
      threshold,
      target,
      cooldown,
      maxDaily,
    );
    await tx.wait();
    console.log("Sub-account created for", operator);
  }

  const config = await subAccount.getSubAccountInfo(operator);
  const bridgeCreditAccount = await subAccount.bridgeCreditAccount();
  const bridgeCreditor = await subAccount.bridgeCreditor();

  if (bridgeCreditAccount.toLowerCase() !== operator.toLowerCase()) {
    console.log(
      "Warning: bridgeCreditAccount is",
      bridgeCreditAccount,
      "- refills are credited to that account, not",
      operator,
    );
  }

  const receiverPath = "./deployments/unichainSepolia-TrestleCCIPReceiver.json";
  if (fs.existsSync(receiverPath)) {
    const receiverAddress = readDeployment(receiverPath).address;
    if (bridgeCreditor.toLowerCase() !== receiverAddress.toLowerCase()) {
      console.log(
        "Warning: bridgeCreditor is",
        bridgeCreditor,
        "- deploy-ccipreceiver.js configures",
        receiverAddress,
      );
    }
  } else {
    console.log("CCIP receiver not deployed yet; run deploy:ccipReceiver next.");
  }

  console.log("Deployer:", deployer.address);
  console.log("Sub-account contract:", subAccountAddress);
  console.log("Sub-account owner/operator:", operator);
  console.log("MainVault:", config.mainVault);
  console.log("Threshold (wei):", config.threshold.toString());
  console.log("Target (wei):", config.target.toString());
  console.log("Cooldown (seconds):", config.cooldown.toString());
  console.log("Max daily spends:", config.maxDaily.toString());
  console.log("=== Unichain Sepolia Configuration Complete ===");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
