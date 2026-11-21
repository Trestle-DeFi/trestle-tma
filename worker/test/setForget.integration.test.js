// Integration test for the Set & Forget plugin routes.
//
// Boots the real worker with `wrangler dev` in local mode (so D1 is a real
// local SQLite database and the worker is the actual deployed entrypoint) and
// drives the plugin's HTTP routes.
//
// The reactive status assertions read the REAL ReactiveGuard on Lasna, so this
// test verifies the on-chain wiring end to end.
//
// Run with: node --test test/setForget.integration.test.js
// Opt out with: SKIP_INTEGRATION_TESTS=1 npm test

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { keccak256, toHex } from "viem";

// Live deployment (contracts/deployments/*.json, deployed 2026-11-18):
//   TrestleSubAccount    0xf4Fef25b23171586E8C87994B8f3D1a3AfCe4c71  Unichain Sepolia (1301)
//   TrestleReactiveGuard 0x27fcAdD5142ECB1b6FC13314a2bDfB71dC92CeF3  Lasna (5318007)
//   TrestleMainVault     0xd8FD13A95e54640206167d31bb39eF5FfF5dF231  Base Sepolia (84532)
const GUARD_ADDRESS = "0x27fcAdD5142ECB1b6FC13314a2bDfB71dC92CeF3";
const MAIN_VAULT = "0xd8FD13A95e54640206167d31bb39eF5FfF5dF231";
// The guard keys subscriptions by the operator that spends from the
// sub-account — that is the address holding the live on-chain subscription.
const SUB_ACCOUNT = "0x9280b24542a52cEE54a78dB65A497D8BeC4BAB94";
const ORIGIN_CONTRACT = "0xf4Fef25b23171586E8C87994B8f3D1a3AfCe4c71";
const ORIGIN_CHAIN_ID = 1301;
const LOW_BALANCE_TOPIC =
  "0x51ade1b66b4d8c165822344a89904b54817158763b47b9faacee15c7645199ec";

const PORT = Number(process.env.SET_FORGET_TEST_PORT || 8791);
const BASE = `http://127.0.0.1:${PORT}`;
const WORKER_DIR = fileURLToPath(new URL("..", import.meta.url));
const SKIP = Boolean(process.env.SKIP_INTEGRATION_TESTS);
const READY_TIMEOUT_MS = Number(
  process.env.SET_FORGET_READY_TIMEOUT_MS || 120_000
);

let wrangler;
let persistDir;
let serverOutput = "";

const integrationTest = SKIP ? test.skip : test;

async function waitForServer(timeoutMs = READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (wrangler && wrangler.exitCode !== null) {
      throw new Error(
        `wrangler dev exited with code ${wrangler.exitCode}\n${serverOutput}`
      );
    }
    try {
      const res = await fetch(`${BASE}/api/plugins/set-forget/reactive/status`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error(
    `wrangler dev did not become ready within ${timeoutMs}ms\n${serverOutput}`
  );
}

before(async () => {
  if (SKIP) {
    return;
  }

  // Fresh local state per run so the suite never depends on leftovers from a
  // previous run (the reactive status reflects the D1 mirror, not just the chain).
  persistDir = await mkdtemp(join(tmpdir(), "trestle-setforget-"));

  wrangler = spawn(
    "npx",
    [
      "wrangler",
      "dev",
      "--local",
      "--port",
      String(PORT),
      "--ip",
      "127.0.0.1",
      "--persist-to",
      persistDir,
      "--log-level",
      "error",
    ],
    {
      cwd: WORKER_DIR,
      env: { ...process.env, WRANGLER_LOG: "error" },
      stdio: ["ignore", "pipe", "pipe"],
      // Own process group so we can tear down the whole tree (npx -> wrangler).
      detached: true,
    }
  );
  wrangler.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  wrangler.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  await waitForServer();
});

after(async () => {
  if (SKIP) {
    return;
  }

  if (wrangler?.pid) {
    try {
      process.kill(-wrangler.pid, "SIGTERM");
    } catch {
      try {
        wrangler.kill("SIGKILL");
      } catch {
        // already gone
      }
    }
  }
  await sleep(500);

  if (persistDir) {
    await rm(persistDir, { recursive: true, force: true }).catch(() => {});
  }
});

async function call(path, init) {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

const jsonPost = (body) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

integrationTest(
  "schema is created on demand and sub-account CRUD round-trips in camelCase",
  async () => {
    // Start from a clean slate to prove the self-heal creates the tables.
    await call(`/api/plugins/set-forget/subaccounts/${SUB_ACCOUNT}`, {
      method: "DELETE",
    });

    const created = await call(
      "/api/plugins/set-forget/subaccounts",
      jsonPost({
        address: SUB_ACCOUNT,
        mainVault: MAIN_VAULT,
        threshold: "0.01",
        target: "0.05",
        cooldown: 300,
        maxDaily: 10,
      })
    );

    assert.equal(created.status, 200, JSON.stringify(created.json));
    assert.equal(created.json.address, SUB_ACCOUNT);
    assert.equal(created.json.mainVault, MAIN_VAULT);
    assert.equal(created.json.maxDaily, 10);
    assert.equal(created.json.isActive, true);
    assert.equal(created.json.threshold, "0.01");

    const list = await call("/api/plugins/set-forget/subaccounts");
    assert.equal(list.status, 200);
    assert.equal(list.json.subaccounts.length, 1);
    assert.equal(list.json.subaccounts[0].address, SUB_ACCOUNT);
    assert.equal(list.json.subaccounts[0].maxDaily, 10);

    // The update bug: camelCase `maxDaily` was previously rejected.
    const updated = await call(
      `/api/plugins/set-forget/subaccounts/${SUB_ACCOUNT}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxDaily: 7, threshold: "0.02" }),
      }
    );
    assert.equal(updated.status, 200, JSON.stringify(updated.json));
    assert.equal(updated.json.maxDaily, 7);
    assert.equal(updated.json.threshold, "0.02");

    const single = await call(`/api/plugins/set-forget/subaccounts/${SUB_ACCOUNT}`);
    assert.equal(single.status, 200);
    assert.equal(single.json.maxDaily, 7);
  }
);

integrationTest(
  "reactive subscription persists to D1 and surfaces the live guard subscription",
  async () => {
    const res = await call(
      "/api/plugins/set-forget/reactive/subscription",
      jsonPost({
        subAccountAddress: SUB_ACCOUNT,
        callbackUrl:
          "https://vault.trestle.website/api/plugins/set-forget/reactive/callback",
      })
    );

    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(typeof res.json.subscriptionId, "number");
    assert.notEqual(res.json.subscriptionId, 0);
    assert.equal(res.json.subAccountAddress, SUB_ACCOUNT);
    // Live on-chain values from the ReactiveGuard.
    assert.ok(res.json.onChain, "expected live on-chain subscription data");
    assert.equal(res.json.onChain.isActive, true);
    assert.equal(res.json.onChain.maxDailyRefills, 10);
    assert.equal(res.json.onChain.dailyRefillCount, 0);
    assert.equal(
      res.json.onChain.subAccount.toLowerCase(),
      SUB_ACCOUNT.toLowerCase()
    );
    assert.equal(
      res.json.lasnaTopic,
      keccak256(toHex("LowBalanceDetected(address,uint256,uint256,uint64)"))
    );
    assert.equal(res.json.lasnaTopic, LOW_BALANCE_TOPIC);
  }
);

integrationTest(
  "reactive status reports live on-chain guard state, not placeholders",
  async () => {
    const status = await call("/api/plugins/set-forget/reactive/status");
    assert.equal(status.status, 200, JSON.stringify(status.json));

    // The mirrored subscription exists and its on-chain counterpart is active.
    assert.equal(status.json.onChainSubscriptionCount, 1);
    assert.equal(status.json.subscriptionCount, 1);
    assert.equal(status.json.isConnected, true);
    assert.equal(status.json.guardAddress, GUARD_ADDRESS);
    assert.equal(status.json.pendingCount, 0);

    // The guard points at the deployed origin contract and callback recipient.
    assert.equal(status.json.guardConfig.originChainId, ORIGIN_CHAIN_ID);
    assert.equal(
      status.json.guardConfig.originContract.toLowerCase(),
      ORIGIN_CONTRACT.toLowerCase()
    );
    assert.equal(status.json.guardConfig.lowBalanceTopic, LOW_BALANCE_TOPIC);
    assert.equal(
      status.json.guardConfig.callbackRecipient.toLowerCase(),
      MAIN_VAULT.toLowerCase()
    );

    // Status now reflects the mirrored subscription.
    assert.equal(status.json.subscriptions.length, 1);
    assert.equal(status.json.subscriptions[0].subAccountAddress, SUB_ACCOUNT);
    assert.equal(status.json.subscriptions[0].onChain.dailyRefillCount, 0);
  }
);

integrationTest(
  "callback endpoint records the top-up and updates lastTrigger",
  async () => {
    const res = await call(
      "/api/plugins/set-forget/reactive/callback",
      jsonPost({
        subAccountAddress: SUB_ACCOUNT,
        requestId: "0x" + "ab".repeat(32),
        amount: "1000000000000000",
        eventData: { source: "reactive-guard" },
      })
    );

    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.success, true);

    const status = await call("/api/plugins/set-forget/reactive/status");
    assert.ok(status.json.lastTrigger, "lastTrigger should be set after a callback");
  }
);

integrationTest(
  "callback for an unknown sub-account is rejected",
  async () => {
    const res = await call(
      "/api/plugins/set-forget/reactive/callback",
      jsonPost({
        subAccountAddress: "0x1111111111111111111111111111111111111111",
        requestId: "0x" + "cd".repeat(32),
        amount: "1",
      })
    );

    assert.equal(res.status, 500);
    assert.match(res.json.error, /not found/i);
  }
);

integrationTest(
  "per-user top-up settings are validated against protocol bounds",
  async () => {
    const invalidTarget = await call(
      "/api/plugins/set-forget/subaccounts",
      jsonPost({
        address: SUB_ACCOUNT,
        mainVault: MAIN_VAULT,
        threshold: "0.05",
        target: "0.01",
        cooldown: 300,
        maxDaily: 10,
      })
    );
    assert.equal(invalidTarget.status, 400, JSON.stringify(invalidTarget.json));
    assert.match(invalidTarget.json.error, /target must be greater/i);

    const shortCooldown = await call(
      "/api/plugins/set-forget/subaccounts",
      jsonPost({
        address: SUB_ACCOUNT,
        mainVault: MAIN_VAULT,
        threshold: "0.01",
        target: "0.05",
        cooldown: 10,
        maxDaily: 10,
      })
    );
    assert.equal(shortCooldown.status, 400, JSON.stringify(shortCooldown.json));
    assert.match(shortCooldown.json.error, /cooldown/i);

    const excessiveLimit = await call(
      "/api/plugins/set-forget/subaccounts",
      jsonPost({
        address: SUB_ACCOUNT,
        mainVault: MAIN_VAULT,
        threshold: "0.01",
        target: "0.05",
        cooldown: 300,
        maxDaily: 5000,
      })
    );
    assert.equal(excessiveLimit.status, 400, JSON.stringify(excessiveLimit.json));
    assert.match(excessiveLimit.json.error, /max daily/i);
  }
);

integrationTest(
  "preferences and configuration history are stored per user",
  async () => {
    const address = "0x2222222222222222222222222222222222222222";

    const saved = await call("/api/plugins/set-forget/configuration/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userAddress: address,
        autoTopupEnabled: false,
        notificationsEnabled: true,
        riskLevel: "high",
        gasOptimization: false,
      }),
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(saved.json.preferences.riskLevel, "high");
    assert.equal(saved.json.preferences.autoTopupEnabled, false);

    const loaded = await call(
      `/api/plugins/set-forget/configuration/preferences?address=${address}`
    );
    assert.equal(loaded.status, 200, JSON.stringify(loaded.json));
    assert.equal(loaded.json.preferences.riskLevel, "high");
    assert.equal(loaded.json.preferences.gasOptimization, false);

    const invalid = await call("/api/plugins/set-forget/configuration/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userAddress: address, riskLevel: "extreme" }),
    });
    assert.equal(invalid.status, 400, JSON.stringify(invalid.json));

    const history = await call(
      `/api/plugins/set-forget/configuration/history?address=${SUB_ACCOUNT}`
    );
    assert.equal(history.status, 200, JSON.stringify(history.json));
    assert.ok(history.json.history.length >= 1);
    const keys = history.json.history.map((entry) => entry.settingKey);
    assert.ok(
      keys.includes("maxDaily") || keys.includes("threshold"),
      `expected per-user history entries, got ${keys.join(",")}`
    );
  }
);
