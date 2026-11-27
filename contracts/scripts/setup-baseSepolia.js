import hre from "hardhat";
import fs from "node:fs";

const connection = await hre.network.create();
const { ethers } = connection;

function readDeployment(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

async function main() {
  console.log("=== Configure Base Sepolia Set & Forget Contracts ===\n");
  const vaultAddress = readDeployment(
    "./deployments/baseSepolia-TrestleMainVault.json",
  ).address;
  const bridgeAddress = readDeployment(
    "./deployments/baseSepolia-TrestleCCIPBridge.json",
  ).address;
  const receiverAddress = readDeployment(
    "./deployments/unichainSepolia-TrestleCCIPReceiver.json",
  ).address;
  const [deployer] = await ethers.getSigners();

  const vault = (await ethers.getContractFactory("TrestleMainVault")).attach(
    vaultAddress,
  );
  if ((await vault.topupBridge()) !== bridgeAddress) {
    await (await vault.setTopupBridge(bridgeAddress)).wait();
    console.log("Vault topupBridge configured");
  }

  const bridge = (
    await ethers.getContractFactory("TrestleCCIPBridge")
  ).attach(bridgeAddress);
  if ((await bridge.vault()) !== vaultAddress) {
    await (await bridge.setVault(vaultAddress)).wait();
    console.log("Bridge vault configured");
  }
  if ((await bridge.destinationReceiver()) !== receiverAddress) {
    await (await bridge.setDestinationReceiver(receiverAddress)).wait();
    console.log("Bridge destinationReceiver configured");
  }

  // The CCIP fee is paid out of the incoming funding, so the bridge itself
  // needs no capital at all. `feeReserve` is an optional emergency buffer.
  const feeReserve = process.env.CCIP_FEE_RESERVE_WEI || "0";
  if (BigInt(feeReserve) > 0n && (await bridge.feeReserve()) !== BigInt(feeReserve)) {
    await (await bridge.setFeeReserve(feeReserve)).wait();
    console.log("Bridge feeReserve configured");
  }

  const destinationGasLimit = process.env.CCIP_DESTINATION_GAS_LIMIT || "500000";
  if ((await bridge.destinationGasLimit()) !== BigInt(destinationGasLimit)) {
    await (await bridge.setDestinationGasLimit(destinationGasLimit)).wait();
    console.log("Bridge destinationGasLimit configured");
  }

  // Protocol capital is zero: the bridge never pays a CCIP fee out of its own
  // balance, it reserves the fee out of the user's funding instead.
  const feeQuote = await bridge.quoteFee();
  console.log("Quoted CCIP fee per top-up:", ethers.formatEther(feeQuote), "ETH (charged to the user's reserve)");
  console.log("Bridge balance:", ethers.formatEther(await ethers.provider.getBalance(bridgeAddress)), "ETH");

  // Every user funds their own reserve. This is a USER deposit made by the
  // signer, credited to the signer's own balance — not a protocol-owned pot
  // that the deployer has to keep topped up. Use setup:user.js to onboard a
  // different user with their own key.
  const vaultFundingWei = process.env.VAULT_FUNDING_WEI;
  if (vaultFundingWei) {
    const current = await vault.balances(deployer.address);
    if (current < BigInt(vaultFundingWei)) {
      const tx = await vault.depositFor(deployer.address, { value: BigInt(vaultFundingWei) - current });
      await tx.wait();
      console.log("Reserve funded for", deployer.address, "(user deposit)");
    }
  } else {
    console.log("VAULT_FUNDING_WEI not set — no reserve funded (run setup:user.js to fund your own)");
  }

  console.log("Deployer:", deployer.address);
  console.log("Vault:", vaultAddress);
  console.log("Bridge:", bridgeAddress);
  console.log("Unichain receiver:", receiverAddress);
  console.log("=== Base Sepolia Configuration Complete ===");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

