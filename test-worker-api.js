#!/usr/bin/env node
/**
 * Trestle Worker API Test Script
 * Tests all Set & Forget plugin endpoints against a Cloudflare Worker URL.
 * 
 * Usage:
 *   WORKER_URL=https://your-worker.workers.dev node test-worker-api.js
 *   WORKER_URL=http://localhost:8787 node test-worker-api.js
 */

const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8787';
const SUB_ACCOUNT_ADDRESS = process.env.SUB_ACCOUNT || '0x6AE0E1bBE014D222417eF3A350088A0204Ed9bF4';

const BASE = `${WORKER_URL}/api/plugins/set-forget`;

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, ok: res.ok, data };
}

function log(label, result) {
  const icon = result.ok ? '✅' : '❌';
  console.log(`\n${icon} ${label} [${result.status}]`);
  console.log(JSON.stringify(result.data, null, 2));
}

async function runTests() {
  console.log(`\n🧪 Testing Trestle Worker API at ${WORKER_URL}`);
  console.log(`📌 Target sub-account: ${SUB_ACCOUNT_ADDRESS}`);

  // 1. Get Reactive Status
  const status = await fetchJson(`${BASE}/reactive/status`);
  log('GET /reactive/status', status);

  // 2. List Reactive Subscriptions
  const subs = await fetchJson(`${BASE}/reactive/subscriptions`);
  log('GET /reactive/subscriptions', subs);

  // 3. List Sub-Accounts
  const subAccounts = await fetchJson(`${BASE}/subaccounts`);
  log('GET /subaccounts', subAccounts);

  // 4. Get Specific Sub-Account
  const subAccount = await fetchJson(`${BASE}/subaccounts/${SUB_ACCOUNT_ADDRESS}`);
  log(`GET /subaccounts/${SUB_ACCOUNT_ADDRESS}`, subAccount);

  // 5. Create/Subscribe Reactive (POST)
  const callbackUrl = `${WORKER_URL}/api/plugins/set-forget/reactive/callback`;
  const reactiveSub = await fetchJson(`${BASE}/reactive/subscription`, {
    method: 'POST',
    body: JSON.stringify({
      subAccountAddress: SUB_ACCOUNT_ADDRESS,
      callbackUrl,
    }),
  });
  log('POST /reactive/subscription', reactiveSub);

  // 6. Refresh Status After Subscription
  if (reactiveSub.ok) {
    const statusAfter = await fetchJson(`${BASE}/reactive/status`);
    log('GET /reactive/status (after subscribe)', statusAfter);
  }

  console.log('\n📋 Test complete.');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});