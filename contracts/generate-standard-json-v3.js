const fs = require("fs");
const path = require("path");

const contractsDir = path.join(__dirname, "src");
const nodeModulesDir = path.join(__dirname, "node_modules");

// Collect all source files recursively
function collectSources(startFile) {
  const sources = {};
  const visited = new Set();
  const queue = [path.resolve(startFile)];

  while (queue.length > 0) {
    const filePath = queue.shift();
    const resolved = path.resolve(filePath);
    
    if (visited.has(resolved)) continue;
    visited.add(resolved);
    
    let content;
    try {
      content = fs.readFileSync(resolved, "utf8");
    } catch (e) {
      console.warn(`Warning: Could not read ${resolved}: ${e.message}`);
      continue;
    }

    // Store with path relative to contractsDir
    const relPath = path.relative(contractsDir, resolved);
    sources[relPath] = { content };

    // Find all imports - matches both `import "path"` and `import {X} from "path"`
    const importRegex = /(?:import\s+["']([^"']+)["'])|(?:from\s+["']([^"']+)["'])/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1] || match[2];
      const resolvedImport = resolveImport(resolved, importPath);
      if (resolvedImport && !visited.has(path.resolve(resolvedImport))) {
        queue.push(resolvedImport);
      }
    }
  }

  function resolveImport(currentFile, importPath) {
    const currentDir = path.dirname(currentFile);
    
    const candidates = [
      path.join(currentDir, importPath),
      path.join(contractsDir, importPath),
      path.join(nodeModulesDir, importPath),
    ];
    
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
      if (fs.existsSync(candidate + ".sol")) return candidate + ".sol";
    }
    
    return null;
  }

  return sources;
}

const contracts = [
  { name: "TrestleSubAccount", file: "TrestleSubAccount.sol", chain: "unichainSepolia", address: "0x976c6D9F4544E0b2f471698AdaeF54777C6FA3D2" },
  { name: "TrestleMainVault", file: "TrestleMainVault.sol", chain: "baseSepolia", address: "0xd05d1626f7FB992F0B9862EeE29F4Ca688688Be7" },
  { name: "TrestleReactiveGuard", file: "TrestleReactiveGuard.sol", chain: "lasnaTestnet", address: "0x9eD90e296D078Ec4621Dc18d4737dDe951551c88" },
];

for (const { name, file, chain, address } of contracts) {
  console.log(`\n=== Generating Standard JSON for ${name} ===`);
  
  const sources = collectSources(path.join(contractsDir, file));
  
  console.log(`  Sources found: ${Object.keys(sources).length}`);
  Object.keys(sources).forEach(k => console.log(`    - ${k}`));
  
  const standardJson = {
    language: "Solidity",
    sources: sources,
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "cancun",
      viaIR: true,
    },
  };

  const outputPath = path.join(__dirname, `standard-json-${name}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(standardJson, null, 2));
  
  console.log(`  Generated: ${outputPath}`);
  console.log(`  Contract: ${address}`);
  console.log(`  Chain: ${chain}`);
}

console.log("\n=== Done! ===");
