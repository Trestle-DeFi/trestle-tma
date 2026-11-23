import { createPublicClient, http, keccak256, toHex } from "viem";

// ─── On-chain configuration ────────────────────────────────────────────────
// ReactiveGuard lives on Lasna (Reactive Network testnet, chainId 5318007).
export const DEFAULT_GUARD_ADDRESS = "0xf22e65B24B3236B6B4983e81792541139Df6e3Dc";
export const DEFAULT_LASNA_RPC = "https://lasna-rpc.rnk.dev/";

// topic0 of the origin-chain event the guard reacts to:
//   LowBalanceDetected(address indexed subAccount, uint256 currentBalance, uint256 targetTopUp, uint64 sequence)
export const LOW_BALANCE_TOPIC = keccak256(
  toHex("LowBalanceDetected(address,uint256,uint256,uint64)")
);

const GUARD_ABI = [
  {
    type: "function",
    name: "ORIGIN_CHAIN_ID",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "ORIGIN_CONTRACT",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "LOW_BALANCE_TOPIC",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "callbackRecipient",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "getSubscriptionStatus",
    stateMutability: "view",
    inputs: [{ name: "subAccount", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "subAccount", type: "address" },
          { name: "maxDailyRefills", type: "uint64" },
          { name: "dailyRefillCount", type: "uint64" },
          { name: "lastRefillDay", type: "uint256" },
          { name: "lastCooldownAt", type: "uint256" },
          { name: "lastEventHash", type: "bytes32" },
          { name: "isActive", type: "bool" },
          { name: "createdAt", type: "uint256" },
        ],
      },
    ],
  },
];

export function guardConfig(env = {}) {
  return {
    guardAddress: env.REACTIVE_GUARD_ADDRESS || DEFAULT_GUARD_ADDRESS,
    rpcUrl: env.LASNA_RPC_URL || DEFAULT_LASNA_RPC,
  };
}

function lasnaClient(env = {}) {
  const { rpcUrl } = guardConfig(env);
  return createPublicClient({ transport: http(rpcUrl) });
}

// ─── D1 helpers ────────────────────────────────────────────────────────────

/**
 * Read the on-chain subscription for a sub-account from the ReactiveGuard.
 */
export async function readOnChainSubscription(env, subAccountAddress) {
  const { guardAddress } = guardConfig(env);
  const client = lasnaClient(env);
  const status = await client.readContract({
    address: guardAddress,
    abi: GUARD_ABI,
    functionName: "getSubscriptionStatus",
    args: [subAccountAddress],
  });

  return {
    subAccount: status.subAccount,
    isActive: status.isActive,
    createdAt: Number(status.createdAt),
    lastEventHash: status.lastEventHash,
    lastCooldownAt: Number(status.lastCooldownAt),
    maxDailyRefills: Number(status.maxDailyRefills),
    dailyRefillCount: Number(status.dailyRefillCount),
    lastRefillDay: Number(status.lastRefillDay),
  };
}

/**
 * Read the live Reactive Network configuration from the guard on Lasna.
 */
export async function readOnChainGuardConfig(env) {
  const { guardAddress } = guardConfig(env);
  const client = lasnaClient(env);
  const [originChainId, originContract, lowBalanceTopic, recipient] = await Promise.all([
    client.readContract({ address: guardAddress, abi: GUARD_ABI, functionName: "ORIGIN_CHAIN_ID" }),
    client.readContract({ address: guardAddress, abi: GUARD_ABI, functionName: "ORIGIN_CONTRACT" }),
    client.readContract({ address: guardAddress, abi: GUARD_ABI, functionName: "LOW_BALANCE_TOPIC" }),
    client.readContract({ address: guardAddress, abi: GUARD_ABI, functionName: "callbackRecipient" }),
  ]);
  return {
    originChainId: Number(originChainId),
    originContract,
    lowBalanceTopic: `0x${lowBalanceTopic.toString(16).padStart(64, "0")}`,
    callbackRecipient: recipient,
  };
}

function mapSubscription(row) {
  return {
    id: row.id,
    subAccountAddress: row.sub_account_address,
    lasnaTopic: row.lasna_topic,
    callbackUrl: row.callback_url,
    isActive: !!row.is_active,
    lastCheck: row.last_check ?? null,
    createdAt: row.created_at,
  };
}

/**
 * Persist a subscription in D1. Re-subscribing the same sub-account updates
 * the existing row rather than creating a duplicate.
 */
export async function persistSubscription(db, subAccountAddress, callbackUrl, lasnaTopic = LOW_BALANCE_TOPIC) {
  const now = Math.floor(Date.now() / 1000);
  const existing = await db.prepare(
    "SELECT id FROM reactive_subscriptions WHERE sub_account_address = ?"
  ).bind(subAccountAddress).first();

  if (existing) {
    await db.prepare(
      "UPDATE reactive_subscriptions SET callback_url = ?, lasna_topic = ?, is_active = 1, last_check = ? WHERE id = ?"
    ).bind(callbackUrl, lasnaTopic, now, existing.id).run();
  } else {
    await db.prepare(
      "INSERT INTO reactive_subscriptions (sub_account_address, lasna_topic, callback_url, is_active, last_check, created_at) VALUES (?, ?, ?, 1, ?, ?)"
    ).bind(subAccountAddress, lasnaTopic, callbackUrl, now, now).run();
  }

  const row = await db.prepare(
    "SELECT * FROM reactive_subscriptions WHERE sub_account_address = ?"
  ).bind(subAccountAddress).first();

  return mapSubscription(row);
}

export async function listSubscriptions(db) {
  const { results } = await db.prepare(
    "SELECT * FROM reactive_subscriptions ORDER BY created_at DESC"
  ).all();
  return (results || []).map(mapSubscription);
}

/**
 * Build the aggregate status the TMA plugin renders.
 *
 * `isConnected` reflects real reachability of the Lasna RPC — it is never faked.
 * `subscriptionCount` is the number of active on-chain subscriptions mirrored
 * in D1; `pendingCount` and `lastTrigger` come from the worker's own D1 state.
 */
export async function getReactiveStatus(db, env = {}) {
  const { guardAddress } = guardConfig(env);

  let onChainSubscriptionCount = 0;
  let isConnected = false;
  let lastError;
  let subscriptions = [];
  let guardConfigState = null;

  try {
    guardConfigState = await readOnChainGuardConfig(env);
    isConnected = true;
  } catch (e) {
    lastError = `Lasna RPC unreachable: ${e.message}`;
  }

  // Merge the D1 mirror with live on-chain truth where possible.
  const stored = await listSubscriptions(db).catch(() => []);
  subscriptions = await Promise.all(
    stored.map(async (sub) => {
      const configRow = await db
        .prepare(
          "SELECT threshold, target, cooldown, max_daily FROM sub_accounts WHERE user_address = ?"
        )
        .bind(sub.subAccountAddress)
        .first()
        .catch(() => null);

      const userConfig = configRow
        ? {
            threshold: String(configRow.threshold),
            target: String(configRow.target),
            cooldown: Number(configRow.cooldown),
            maxDaily: Number(configRow.max_daily),
          }
        : null;

      if (!isConnected) return { ...sub, config: userConfig };
      try {
        const chain = await readOnChainSubscription(env, sub.subAccountAddress);
        return {
          ...sub,
          isActive: chain.isActive,
          config: userConfig,
          onChain: {
            maxDailyRefills: chain.maxDailyRefills,
            dailyRefillCount: chain.dailyRefillCount,
            lastRefillDay: chain.lastRefillDay,
            lastCooldownAt: chain.lastCooldownAt,
            lastEventHash: chain.lastEventHash,
            createdAt: chain.createdAt,
          },
        };
      } catch {
        return { ...sub, config: userConfig };
      }
    })
  );
  onChainSubscriptionCount = subscriptions.filter((sub) => sub.isActive).length;

  const pendingRow = await db.prepare(
    "SELECT COUNT(*) AS c FROM topup_requests WHERE status = 'pending'"
  ).first().catch(() => null);

  const lastEventRow = await db.prepare(
    "SELECT MAX(timestamp) AS t FROM sub_account_events"
  ).first().catch(() => null);

  const lastTriggerTs = lastEventRow?.t ? Number(lastEventRow.t) : null;

  return {
    subscriptionCount: onChainSubscriptionCount,
    onChainSubscriptionCount,
    pendingCount: pendingRow ? Number(pendingRow.c) : 0,
    lastTrigger: lastTriggerTs ? new Date(lastTriggerTs * 1000).toISOString() : null,
    isConnected,
    guardAddress,
    subscriptions,
    ...(guardConfigState ? { guardConfig: guardConfigState } : {}),
    ...(lastError ? { lastError } : {}),
  };
}

/**
 * Handle a reactive callback delivered to the worker's callback endpoint.
 * Records the top-up request and emits an audit event.
 */
export async function processReactiveCallback(db, env, { subAccountAddress, requestId, amount, eventData }) {
  const subAccount = await db.prepare(
    "SELECT * FROM sub_accounts WHERE user_address = ?"
  ).bind(subAccountAddress).first();

  if (!subAccount) {
    throw new Error(`Sub-account not found: ${subAccountAddress}`);
  }
  if (!subAccount.is_active) {
    throw new Error(`Sub-account is not active: ${subAccountAddress}`);
  }

  const now = Math.floor(Date.now() / 1000);

  if (requestId) {
    await db.prepare(
      `INSERT INTO topup_requests (request_id, sub_account_address, amount, status, created_at, callback_triggered_at, expires_at, callback_data)
       VALUES (?, ?, ?, 'settled', ?, ?, ?, ?)
       ON CONFLICT(request_id) DO UPDATE SET status = 'settled', callback_triggered_at = excluded.callback_triggered_at, callback_data = excluded.callback_data`
    ).bind(
      requestId,
      subAccountAddress,
      String(amount ?? "0"),
      now,
      now,
      now + 3600,
      eventData ? JSON.stringify(eventData) : null
    ).run();
  }

  await db.prepare(
    "INSERT INTO sub_account_events (sub_account_address, event_type, current_balance, target_top_up, timestamp, details) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(
    subAccountAddress,
    "TopUpReceived",
    String(amount ?? "0"),
    "0",
    now,
    eventData ? JSON.stringify(eventData) : null
  ).run();

  return { success: true, requestId, amount: String(amount ?? "0"), timestamp: now };
}