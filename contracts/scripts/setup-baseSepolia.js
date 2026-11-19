const hre = require("hardhat");
const fs = require("fs");

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
  const [deployer] = await hre.ethers.getSigners();

  const vault = (await hre.ethers.getContractFactory("TrestleMainVault")).attach(
    vaultAddress,
  );
  if ((await vault.topupBridge()) !== bridgeAddress) {
    await (await vault.setTopupBridge(bridgeAddress)).wait();
    console.log("Vault topupBridge configured");
  }

  const bridge = (
    await hre.ethers.getContractFactory("TrestleCCIPBridge")
  ).attach(bridgeAddress);
  if ((await bridge.vault()) !== vaultAddress) {
    await (await bridge.setVault(vaultAddress)).wait();
    console.log("Bridge vault configured");
  }
  if ((await bridge.destinationReceiver()) !== receiverAddress) {
    await (await bridge.setDestinationReceiver(receiverAddress)).wait();
    console.log("Bridge destinationReceiver configured");
  }

  const feeReserve = process.env.CCIP_FEE_RESERVE_WEI;
  if (!feeReserve) throw new Error("Missing CCIP_FEE_RESERVE_WEI");
  if ((await bridge.feeReserve()) !== BigInt(feeReserve)) {
    await (await bridge.setFeeReserve(feeReserve)).wait();
    console.log("Bridge feeReserve configured");
  }

  const destinationGasLimit = process.env.CCIP_DESTINATION_GAS_LIMIT || "500000";
  if ((await bridge.destinationGasLimit()) !== BigInt(destinationGasLimit)) {
    await (await bridge.setDestinationGasLimit(destinationGasLimit)).wait();
    console.log("Bridge destinationGasLimit configured");
  }

  const bridgeFeeFundingWei = process.env.BRIDGE_FEE_FUNDING_WEI || feeReserve;
  const bridgeBalance = await hre.ethers.provider.getBalance(bridgeAddress);
  if (bridgeBalance < BigInt(bridgeFeeFundingWei)) {
    const tx = await deployer.sendTransaction({
      to: bridgeAddress,
      value: BigInt(bridgeFeeFundingWei) - bridgeBalance,
    });
    await tx.wait();
    console.log("Bridge funded for CCIP native fees");
  }

  const vaultFundingWei = process.env.VAULT_FUNDING_WEI;
  if (!vaultFundingWei) throw new Error("Missing VAULT_FUNDING_WEI");
  const vaultBalance = await hre.ethers.provider.getBalance(vaultAddress);
  if (vaultBalance < BigInt(vaultFundingWei)) {
    const tx = await deployer.sendTransaction({
      to: vaultAddress,
      value: BigInt(vaultFundingWei) - vaultBalance,
    });
    await tx.wait();
    console.log("Vault funded for native top-ups");
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

