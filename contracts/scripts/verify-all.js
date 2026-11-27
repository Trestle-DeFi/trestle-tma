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
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const SOURCIFY_API = "https://sourcify.dev/server";
const SOURCIFY_BROWSER = "https://repo.sourcify.dev";

/** Reads the Solidity standard-JSON input (the exact compiler input used for the deployment). */
function loadStandardJsonInput(contractName) {
  const buildInfoDir = path.join(__dirname, "..", "artifacts", "build-info");
  for (const file of fs.readdirSync(buildInfoDir)) {
    const buildInfo = JSON.parse(fs.readFileSync(path.join(buildInfoDir, file), "utf8"));
    const sources = buildInfo.input?.sources || {};
    if (Object.keys(sources).some((source) => source.endsWith(`/${contractName}.sol`))) {
      // solcLongVersion carries the commit hash, e.g. "0.8.37+commit.f401782d"
      return { stdJsonInput: buildInfo.input, compilerVersion: buildInfo.solcLongVersion };
    }
  }
  throw new Error(`No build-info found containing ${contractName}.sol - run "npx hardhat compile" first.`);
}

/**
 * Verifies a contract through Sourcify's v2 API.
 * hardhat-verify's own "verify:sourcify" task still targets the removed Sourcify API v1,
 * and Lasna's Reactscan explorer serves contract sources straight from Sourcify.
 */
async function verifyViaSourcify(deployment, contractName) {
  const chainId = String(hre.network.config.chainId);
  const { stdJsonInput, compilerVersion } = loadStandardJsonInput(contractName);

  const submit = await fetch(`${SOURCIFY_API}/v2/verify/${chainId}/${deployment.address}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "trestle-verify-script/1.0" },
    body: JSON.stringify({
      stdJsonInput,
      compilerVersion,
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

const PLAN = {
  baseSepolia: {
    tasks: ["verify:etherscan"], // Etherscan V2 unified API (sepolia.basescan.org)
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
      { name: "verify:blockscout", critical: false },
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

/**
 * Runs a hardhat-verify subtask, retrying transient explorer failures
 * (connection timeouts, HTTP 429 rate limits) a few times.
 */
async function runVerifyTaskWithRetry(taskName, args, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await hre.run(taskName, args);
    } catch (error) {
      lastError = error;
      const transient = /network request failed|timeout|429|rate limit/i.test(error.message);
      if (!transient || attempt === attempts) {
        throw error;
      }
      console.warn(`  ${taskName} failed (${error.message.split("\n")[0]}) - retrying in ${attempt * 15}s...`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 15000));
    }
  }
  throw lastError;
}

async function main() {
  const networkName = hre.network.name;
  const plan = PLAN[networkName];
  if (!plan) {
    throw new Error(`No verification plan for network "${networkName}"`);
  }

  let failures = 0;
  for (const item of plan.contracts) {
    const deploymentPath = path.join(__dirname, "..", "deployments", item.file);
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    for (const task of plan.tasks) {
      const taskName = typeof task === "string" ? task : task.name;
      const critical = typeof task === "string" ? true : task.critical !== false;
      console.log(`\n=== Verifying ${item.contract} @ ${deployment.address} on ${networkName} (${taskName}) ===`);
      try {
        if (taskName === "sourcify") {
          await verifyViaSourcify(deployment, item.contract);
        } else {
          await runVerifyTaskWithRetry(taskName, {
            address: deployment.address,
            contract: `src/${item.contract}.sol:${item.contract}`,
            constructorArgsParams: deployment.constructorArgs,
          });
        }
        console.log(`OK ${item.contract} ${deployment.address} (${taskName})`);
      } catch (error) {
        if (critical) {
          failures += 1;
          console.error(`FAILED ${item.contract} ${deployment.address} (${taskName}): ${error.message}`);
        } else {
          console.warn(`SKIPPED ${item.contract} (${taskName}): ${error.message}`);
          console.warn(`  Check manually: https://unichain-sepolia.blockscout.com/address/${deployment.address}#code`);
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
