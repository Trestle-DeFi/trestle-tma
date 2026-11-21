const fs = require("fs");
const path = require("path");

const contractsDir = __dirname;
const nodeModulesDir = path.join(contractsDir, "node_modules");

const SOLC_SETTINGS = {
  optimizer: { enabled: true, runs: 200 },
  evmVersion: "cancun",
  viaIR: true,
  outputSelection: {
    "*": {
      "*": ["abi", "evm.bytecode", "evm.deployedBytecode", "evm.methodIdentifiers", "metadata"],
      "": ["ast"],
    },
  },
};

const IMPORT_REGEX = /import\s+(?:[^;]*?from\s+)?["']([^"']+)["']\s*;/g;

function sourceRoot(key) {
  return key.startsWith("src/") ? contractsDir : nodeModulesDir;
}

function resolveImportPath(importerKey, importPath) {
  if (importPath.startsWith(".")) {
    const normalized = path.posix.normalize(path.posix.join(path.posix.dirname(importerKey), importPath));
    return { key: normalized, file: path.join(sourceRoot(normalized), normalized) };
  }
  return { key: importPath, file: path.join(nodeModulesDir, importPath) };
}

function collectSources(entryKey) {
  const sources = {};
  const visited = new Set();
  const stack = [entryKey];

  while (stack.length > 0) {
    const key = stack.pop();
    if (visited.has(key)) continue;
    visited.add(key);

    const file = path.join(sourceRoot(key), key);
    if (!fs.existsSync(file)) {
      console.warn(`Warning: source not found for ${key}`);
      continue;
    }

    const content = fs.readFileSync(file, "utf8");
    sources[key] = { content };

    IMPORT_REGEX.lastIndex = 0;
    let match;
    while ((match = IMPORT_REGEX.exec(content)) !== null) {
      const resolved = resolveImportPath(key, match[1]);
      if (fs.existsSync(resolved.file) || fs.existsSync(resolved.file + ".sol")) {
        stack.push(fs.existsSync(resolved.file) ? resolved.key : resolved.key + ".sol");
      } else {
        console.warn(`Warning: could not resolve import ${match[1]} from ${key}`);
      }
    }
  }

  return sources;
}

const contracts = [
  {
    name: "TrestleSubAccount",
    key: "src/TrestleSubAccount.sol",
    chain: "unichainSepolia",
    deployment: "unichainSepolia-TrestleSubAccount.json",
  },
  {
    name: "TrestleCCIPReceiver",
    key: "src/TrestleCCIPReceiver.sol",
    chain: "unichainSepolia",
    deployment: "unichainSepolia-TrestleCCIPReceiver.json",
  },
  {
    name: "TrestleMainVault",
    key: "src/TrestleMainVault.sol",
    chain: "baseSepolia",
    deployment: "baseSepolia-TrestleMainVault.json",
  },
  {
    name: "TrestleCCIPBridge",
    key: "src/TrestleCCIPBridge.sol",
    chain: "baseSepolia",
    deployment: "baseSepolia-TrestleCCIPBridge.json",
  },
  {
    name: "TrestleReactiveGuard",
    key: "src/TrestleReactiveGuard.sol",
    chain: "lasnaTestnet",
    deployment: "lasnaTestnet-TrestleReactiveGuard.json",
  },
];

for (const { name, key, chain, deployment } of contracts) {
  const deploymentPath = path.join(contractsDir, "deployments", deployment);
  const address = fs.existsSync(deploymentPath)
    ? JSON.parse(fs.readFileSync(deploymentPath, "utf8")).address
    : "";

  const standardJson = {
    language: "Solidity",
    sources: collectSources(key),
    settings: SOLC_SETTINGS,
  };

  const outputPath = path.join(contractsDir, `standard-json-${name}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(standardJson, null, 2));

  console.log(`Generated ${outputPath}`);
  console.log(`  contract: ${name} | chain: ${chain} | address: ${address}`);
  console.log(`  sources: ${Object.keys(standardJson.sources).length}`);
}

console.log("\nUpload each standard-json-*.json to the matching explorer (Sourcify v2 / Blockscout / Etherscan).");
