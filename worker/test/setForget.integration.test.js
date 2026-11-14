// Integration test for the Set & Forget plugin routes.
//
// Boots the real worker with `wrangler dev --local` (so D1 is a real local
// SQLite database and the worker is the actual deployed entrypoint) and drives
// the plugin's HTTP routes.
//
// The reactive status assertions read the REAL ReactiveGuard on Lasna, so this
// test verifies the on-chain wiring end to end.
//
// Run with: node --test test/setForget.integration.test.js

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { keccak256, toHex } from "viem";

const GUARD_ADDRESS = "0x9eD90e296D078Ec4621Dc18d4737dDe951551c88";
const MAIN_VAULT = "0xd05d1626f7FB992F0B9862EeE29F4Ca688688Be7";
const SUB_ACCOUNT = "0x976c6D9F4544E0b2f471698AdaeF54777C6FA3D2";

const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;

let wrangler;

async function waitForServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/plugins/set-forget/reactive/status`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error("wrangler dev did not become ready in time");
}

before(async () => {
  wrangler = spawn(
    "npx",
    ["wrangler", "dev", "--local", "--port", String(PORT), "--ip", "127.0.0.1"],
    {
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, WRANGLER_LOG: "error" },
      stdio: ["ignore", "pipe", "pipe"],
      // Own process group so we can tear down the whole tree (npx -> wrangler).
      detached: true,
    }
  );
  wrangler.stdout.on("data", () => {});
  wrangler.stderr.on("data", () => {});
  await waitForServer();
});

after(async () => {
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

test("schema is created on demand and sub-account CRUD round-trips in camelCase", async () => {
  // Start from a clean slate to prove the self-heal creates the tables.
  await call(`/api/plugins/set-forget/subaccounts/${SUB_ACCOUNT}`, { method: "DELETE" });

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
});

test("reactive status reports live on-chain guard state, not placeholders", async () => {
  const status = await call("/api/plugins/set-forget/reactive/status");
  assert.equal(status.status, 200, JSON.stringify(status.json));

  // subscriptionCount comes from the REAL ReactiveGuard on Lasna (verified: 1).
  assert.equal(status.json.onChainSubscriptionCount, 1);
  assert.equal(status.json.subscriptionCount, 1);
  assert.equal(status.json.isConnected, true);
  assert.equal(status.json.guardAddress, GUARD_ADDRESS);
  assert.equal(status.json.pendingCount, 0);
});

test("reactive subscription persists to D1 and surfaces the live guard subscription", async () => {
  const res = await call(
    "/api/plugins/set-forget/reactive/subscription",
    jsonPost({
      subAccountAddress: SUB_ACCOUNT,
      callbackUrl: "https://vault.trestle.website/api/plugins/set-forget/reactive/callback",
    })
  );

  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(typeof res.json.subscriptionId, "number");
  assert.notEqual(res.json.subscriptionId, 0);
  assert.equal(res.json.subAccountAddress, SUB_ACCOUNT);
  // Live on-chain values from the ReactiveGuard.
  assert.equal(res.json.onChain.isActive, true);
  assert.equal(res.json.onChain.maxDailyRefills, 10);
  assert.equal(res.json.onChain.mainVault.toLowerCase(), MAIN_VAULT.toLowerCase());
  assert.equal(
    res.json.lasnaTopic,
    keccak256(toHex("LowBalanceDetected(address,uint256,uint256,uint64)"))
  );

  // Status now reflects the mirrored subscription.
  const status = await call("/api/plugins/set-forget/reactive/status");
  assert.equal(status.json.subscriptions.length, 1);
  assert.equal(status.json.subscriptions[0].subAccountAddress, SUB_ACCOUNT);
  assert.equal(status.json.subscriptions[0].onChain.dailyRefillCount, 0);
});

test("callback endpoint records the top-up and updates lastTrigger", async () => {
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
});

test("callback for an unknown sub-account is rejected", async () => {
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
});
