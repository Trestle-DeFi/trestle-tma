const hre = require("hardhat");
const fs = require("fs");
const { ZeroAddress } = require("ethers");

const UNICHAIN = {
  ccipRouter: "0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93",
  usdc: "0x31d0220469e10c4e71834a79b1f276d740d3768f",
  weth: "0x4200000000000000000000000000000000000006",
  pool: "0xBeAD5792bB6C299AB11Eaa425aC3fE11ebA47b3B",
  destinationSelector: "14135854469784514356",
  sourceSelector: "10344971235874465080",
};

function readDeployment(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

async function main() {
  console.log("=== Deploying TrestleCCIPReceiver to Unichain Sepolia ===");
  const [deployer] = await hre.ethers.getSigners();
  const sourceBridge = readDeployment("./deployments/baseSepolia-TrestleCCIPBridge.json").address;
  const subAccount = readDeployment("./deployments/unichainSepolia-TrestleSubAccount.json").address;

  const TrestleSubAccount = await hre.ethers.getContractFactory("TrestleSubAccount");
  const subAccountContract = TrestleSubAccount.attach(subAccount);
  const bridgeCreditAccount = await subAccountContract.bridgeCreditAccount();
  if (bridgeCreditAccount === "0x0000000000000000000000000000000000000000") {
    throw new Error("Sub-account must be created before deploying the CCIP receiver");
  }

  const TrestleCCIPReceiver = await hre.ethers.getContractFactory("TrestleCCIPReceiver");
  const receiver = await TrestleCCIPReceiver.deploy(
    sourceBridge,
    UNICHAIN.ccipRouter,
    UNICHAIN.sourceSelector,
    UNICHAIN.destinationSelector,
    UNICHAIN.usdc,
    UNICHAIN.weth,
    UNICHAIN.pool,
    subAccount,
  );
  await receiver.waitForDeployment();
  const address = await receiver.getAddress();

  const deployment = {
    network: "unichainSepolia",
    contract: "TrestleCCIPReceiver",
    address,
    deployer: deployer.address,
    sourceBridge,
    subAccount,
    constructorArgs: [
      sourceBridge,
      UNICHAIN.ccipRouter,
      UNICHAIN.sourceSelector,
      UNICHAIN.destinationSelector,
      UNICHAIN.usdc,
      UNICHAIN.weth,
      UNICHAIN.pool,
      subAccount,
    ],
    ...UNICHAIN,
    timestamp: new Date().toISOString(),
    txHash: receiver.deploymentTransaction().hash,
  };

  fs.mkdirSync("./deployments", { recursive: true });
  fs.writeFileSync(
    "./deployments/unichainSepolia-TrestleCCIPReceiver.json",
    JSON.stringify(deployment, null, 2),
  );

  // Authorize this receiver to credit native ETH to the sub-account.
  if ((await subAccountContract.bridgeCreditor()) !== address) {
    const tx = await subAccountContract.setBridgeCreditor(address);
    await tx.wait();
  }
  console.log("TrestleCCIPReceiver deployed to:", address);
  console.log("Sub-account bridgeCreditor configured");
  console.log("Deployment info saved to deployments/unichainSepolia-TrestleCCIPReceiver.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
