/**
 * Verifies every deployed Trestle contract for the network selected with --network.
 *
 * Usage:
 *   npx hardhat run scripts/verify-all.js --network baseSepolia
 *   npx hardhat run scripts/verify-all.js --network unichainSepolia
 *   npx hardhat run scripts/verify-all.js --network lasnaTestnet
 *
 * Constructor arguments are read from deployments/<network>-<Contract>.json so that
 * they always match the addresses actually deployed on-chain.
 *
 * Explorer per chain:
 *   baseSepolia    -> Etherscan V2 unified API (sepolia.basescan.org)
 *   unichainSepolia-> Blockscout (unichain-sepolia.blockscout.com), async verification queue
 *   lasnaTestnet   -> Sourcify v2, which is what the Reactscan explorer serves sources from
 */
import hre from "hardhat";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AbiCoder } from "ethers";
import { buildStandardJson } from "../generate-standard-json.js";

const contractsDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const SOURCIFY_API = "https://sourcify.dev/server";
const SOURCIFY_BROWSER = "https://repo.sourcify.dev";
const BLOCKSCOUT_API = "https://unichain-sepolia.blockscout.com/api";
const BLOCKSCOUT_BROWSER = "https://unichain-sepolia.blockscout.com";
// The compiler the contracts were deployed with (hardhat.config.js pins 0.8.37).
// Sourcify wants the bare version, the Etherscan-compatible APIs want the "v" prefix.
const COMPILER_VERSION = "0.8.37+commit.f401782d";
const COMPILER_VERSION_V2 = "v0.8.37+commit.f401782d";

const connection = await hre.network.create();
const chainId = String(connection.networkConfig.chainId);
const networkName = connection.networkName;

/** Reads the Solidity standard-JSON input (the exact compiler input used for the deployment). */
function loadStandardJsonInput(contractName) {
  const file = path.join(contractsDir, `standard-json-${contractName}.json`);
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  return buildStandardJson(`src/${contractName}.sol`);
}

/**
 * ABI-encodes the constructor arguments that were recorded at deployment time.
 * The Etherscan-compatible APIs expect the hex string without the "0x" prefix.
 */
function encodeConstructorArgs(contractName, constructorArgs) {
  const artifactPath = path.join(
    contractsDir,
    "artifacts",
    "src",
    `${contractName}.sol`,
    `${contractName}.json`,
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const constructor = artifact.abi.find((entry) => entry.type === "constructor");
  const types = (constructor?.inputs ?? []).map((input) => input.type);
  if (types.length === 0) {
    return "";
  }
  return AbiCoder.defaultAbiCoder().encode(types, constructorArgs).replace(/^0x/, "");
}

/** Retries transient explorer failures (connection timeouts, HTTP 429 rate limits). */
async function withRetry(label, action, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      const transient = /network request failed|timeout|429|rate limit|ECONNRESET|fetch failed/i.test(
        error.message,
      );
      if (!transient || attempt === attempts) {
        throw error;
      }
      console.warn(`  ${label} failed (${error.message.split("\n")[0]}) - retrying in ${attempt * 15}s...`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 15000));
    }
  }
  throw lastError;
}

/**
 * Verifies a contract through Sourcify's v2 API.
 * Lasna's Reactscan explorer serves contract sources straight from Sourcify, and
 * Sourcify is the reliable mirror for Unichain (Blockscout rate-limits heavily).
 */
async function verifyViaSourcify(deployment, contractName) {
  const stdJsonInput = loadStandardJsonInput(contractName);

  const submit = await fetch(`${SOURCIFY_API}/v2/verify/${chainId}/${deployment.address}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "trestle-verify-script/1.0" },
    body: JSON.stringify({
      stdJsonInput,
      compilerVersion: COMPILER_VERSION,
      contractIdentifier: `src/${contractName}.sol:${contractName}`,
      creationTransactionHash: deployment.txHash,
    }),
  });
  const submitted = await submit.json().catch(() => ({}));
  if (submitted.customCode === "already_verified") {
    console.log(`Already verified on Sourcify: ${submitted.message}`);
    return true;
  }
  if (!submitted.verificationId) {
    throw new Error(`Sourcify submission failed (http ${submit.status}): ${JSON.stringify(submitted).slice(0, 300)}`);
  }

  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 6000));
    const status = await fetch(`${SOURCIFY_API}/v2/verify/${submitted.verificationId}`, {
      headers: { "User-Agent": "trestle-verify-script/1.0" },
    });
    const result = await status.json().catch(() => ({}));
    if (!result.isJobCompleted) {
      console.log(`  Sourcify verification pending (${attempt + 1})...`);
      continue;
    }
    const match = result.contract?.match || result.match;
    if (result.error) {
      throw new Error(`Sourcify verification failed: ${JSON.stringify(result.error).slice(0, 300)}`);
    }
    if (match !== "exact_match") {
      throw new Error(`Sourcify match is "${match}" (expected exact_match)`);
    }
    console.log(`Sourcify exact_match: ${SOURCIFY_BROWSER}/contracts/full_match/${chainId}/${deployment.address}/`);
    return true;
  }
  throw new Error("Sourcify verification did not complete in time");
}

/** Verifies a contract through the Etherscan V2 unified API (Base Sepolia). */
async function verifyViaEtherscan(deployment, contractName) {
  const stdJsonInput = loadStandardJsonInput(contractName);
  const constructorArguments = encodeConstructorArgs(contractName, deployment.constructorArgs ?? []);
  const contractIdentifier = `src/${contractName}.sol:${contractName}`;
  const { etherscan } = connection.verification;

  let guid;
  try {
    guid = await etherscan.verify({
      contractAddress: deployment.address,
      compilerInput: stdJsonInput,
      contractName: contractIdentifier,
      compilerVersion: COMPILER_VERSION_V2,
      constructorArguments,
    });
  } catch (error) {
    // HHE80022: the contract is already verified on the explorer.
    if (error.message.includes("already verified")) {
      console.log(`Already verified on Etherscan: ${await etherscan.getContractUrl(deployment.address)}`);
      return true;
    }
    throw error;
  }
  const status = await etherscan.pollVerificationStatus(guid, deployment.address, contractIdentifier);
  if (!status.success) {
    throw new Error(`Etherscan verification failed: ${status.message}`);
  }
  console.log(`Etherscan verified: ${await etherscan.getContractUrl(deployment.address)}`);
  return true;
}

/** Verifies a contract through Blockscout's Etherscan-compatible API (Unichain Sepolia). */
async function verifyViaBlockscout(deployment, contractName) {
  const stdJsonInput = loadStandardJsonInput(contractName);
  const constructorArguments = encodeConstructorArgs(contractName, deployment.constructorArgs ?? []);
  const params = new URLSearchParams({
    module: "contract",
    action: "verify",
    code: JSON.stringify(stdJsonInput),
    compilerVersion: COMPILER_VERSION_V2,
    constructorArgs: constructorArguments,
  });

  const submit = await fetch(`${BLOCKSCOUT_API}?${params}`, {
    headers: { "User-Agent": "trestle-verify-script/1.0" },
  });
  const submitted = await submit.json().catch(() => ({}));
  if (submitted.status === "0") {
    throw new Error(
      `Blockscout rejected the submission: ${String(submitted.result ?? JSON.stringify(submitted)).slice(0, 200)}`,
    );
  }
  const guid = submitted.result;

  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 6000));
    const check = new URLSearchParams({
      module: "contract",
      action: "checkverifystatus",
      guid: String(guid),
    });
    const status = await fetch(`${BLOCKSCOUT_API}?${check}`, {
      headers: { "User-Agent": "trestle-verify-script/1.0" },
    });
    const result = await status.json().catch(() => ({}));
    const message = String(result.result ?? "").toLowerCase();
    if (message.includes("already verified")) {
      console.log("Already verified on Blockscout");
      return true;
    }
    if (message.includes("unknown uid")) {
      // Blockscout accepts the request but does not queue it when the contract
      // is already verified, so there is no job to poll.
      console.log("Blockscout did not queue the request (the contract is already verified)");
      return true;
    }
    if (message.includes("pending") || message.includes("in queue")) {
      console.log(`  Blockscout verification pending (${attempt + 1})...`);
      continue;
    }
    if (message.includes("success") || message.includes("verified")) {
      console.log(`Blockscout verified: ${BLOCKSCOUT_BROWSER}/address/${deployment.address}#code`);
      return true;
    }
    throw new Error(
      `Blockscout verification failed: ${String(result.result ?? JSON.stringify(result)).slice(0, 200)}`,
    );
  }
  throw new Error("Blockscout verification did not complete in time");
}

const PLAN = {
  baseSepolia: {
    tasks: [{ name: "etherscan", critical: true }], // Etherscan V2 unified API (sepolia.basescan.org)
    contracts: [
      { file: "baseSepolia-TrestleMainVault.json", contract: "TrestleMainVault" },
      { file: "baseSepolia-TrestleCCIPBridge.json", contract: "TrestleCCIPBridge" },
    ],
  },
  unichainSepolia: {
    // Sourcify mirrors the sources with an exact-match proof, Blockscout is the native explorer.
    // Blockscout is best-effort here: its API rate-limits aggressively (HTTP 429).
    tasks: [
      { name: "sourcify", critical: true },
      { name: "blockscout", critical: false },
    ],
    contracts: [
      { file: "unichainSepolia-TrestleSubAccount.json", contract: "TrestleSubAccount" },
      { file: "unichainSepolia-TrestleCCIPReceiver.json", contract: "TrestleCCIPReceiver" },
    ],
  },
  lasnaTestnet: {
    tasks: [{ name: "sourcify", critical: true }], // Lasna's Reactscan explorer serves sources from Sourcify
    contracts: [{ file: "lasnaTestnet-TrestleReactiveGuard.json", contract: "TrestleReactiveGuard" }],
  },
};

const VERIFIERS = {
  sourcify: verifyViaSourcify,
  etherscan: verifyViaEtherscan,
  blockscout: verifyViaBlockscout,
};

async function main() {
  const plan = PLAN[networkName];
  if (!plan) {
    throw new Error(`No verification plan for network "${networkName}"`);
  }

  let failures = 0;
  for (const item of plan.contracts) {
    const deploymentPath = path.join(contractsDir, "deployments", item.file);
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    for (const task of plan.tasks) {
      const taskName = task.name;
      const critical = task.critical !== false;
      console.log(`\n=== Verifying ${item.contract} @ ${deployment.address} on ${networkName} (${taskName}) ===`);
      try {
        await withRetry(taskName, () => VERIFIERS[taskName](deployment, item.contract));
        console.log(`OK ${item.contract} ${deployment.address} (${taskName})`);
      } catch (error) {
        if (critical) {
          failures += 1;
          console.error(`FAILED ${item.contract} ${deployment.address} (${taskName}): ${error.message}`);
        } else {
          console.warn(`SKIPPED ${item.contract} (${taskName}): ${error.message}`);
          console.warn(`  Check manually: ${BLOCKSCOUT_BROWSER}/address/${deployment.address}#code`);
        }
      }
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} contract(s) failed verification on ${networkName}.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
