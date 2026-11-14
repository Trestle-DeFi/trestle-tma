import { privateKeyToAccount } from "viem/accounts";
import { withPluginSchema } from "./schema.js";

let signerAccount = null;

export function initVaultSigner(privateKey) {
  if (!privateKey) {
    console.warn("SIGNER_PRIVATE_KEY not set — vault settlement signing disabled");
    return null;
  }
  const key = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  signerAccount = privateKeyToAccount(key);
  return signerAccount;
}

export function getVaultSignerAddress() {
  return signerAccount?.address ?? null;
}

// Map a D1 row (snake_case) to the camelCase shape the TMA client consumes.
function toApiSubAccount(row) {
  if (!row) return null;
  return {
    address: row.user_address,
    mainVault: row.main_vault_ref,
    threshold: String(row.threshold ?? "0"),
    target: String(row.target ?? "0"),
    cooldown: Number(row.cooldown ?? 0),
    maxDaily: Number(row.max_daily ?? 0),
    isActive: !!row.is_active,
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
    sequence: Number(row.sequence ?? 0),
    totalSpentToday: Number(row.total_spent_today ?? 0),
  };
}

// Accept both camelCase (from the TMA) and snake_case (internal) update keys.
const UPDATE_FIELDS = {
  threshold: "threshold",
  target: "target",
  cooldown: "cooldown",
  maxDaily: "max_daily",
  max_daily: "max_daily",
  isActive: "is_active",
  is_active: "is_active",
  sequence: "sequence",
};

export async function createSubAccount(db, address, mainVaultRef, config) {
  const {
    threshold = "0",
    target = "0",
    cooldown = 0,
    maxDaily = 0,
  } = config;

  if (!address || !mainVaultRef) {
    throw new Error("address and mainVault are required");
  }

  return withPluginSchema(db, async () => {
    const existing = await db.prepare(
      "SELECT * FROM sub_accounts WHERE user_address = ?"
    ).bind(address).first();

    if (existing) {
      throw new Error(`Sub-account already exists for address ${address}`);
    }

    const now = Math.floor(Date.now() / 1000);
    await db.prepare(
      "INSERT INTO sub_accounts (user_address, main_vault_ref, threshold, target, cooldown, max_daily, is_active, created_at, updated_at, sequence, total_spent_today) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 0, '0')"
    ).bind(
      address,
      mainVaultRef,
      String(threshold),
      String(target),
      Number(cooldown) || 0,
      Number(maxDaily) || 0,
      now,
      now
    ).run();

    const row = await db.prepare(
      "SELECT * FROM sub_accounts WHERE user_address = ?"
    ).bind(address).first();

    return toApiSubAccount(row);
  });
}

export async function getSubAccount(db, address) {
  return withPluginSchema(db, async () => {
    const row = await db.prepare(
      "SELECT * FROM sub_accounts WHERE user_address = ?"
    ).bind(address).first();
    return toApiSubAccount(row);
  });
}

export async function listSubAccounts(db) {
  return withPluginSchema(db, async () => {
    const { results } = await db.prepare(
      "SELECT * FROM sub_accounts ORDER BY created_at DESC"
    ).all();
    return (results || []).map(toApiSubAccount);
  });
}

export async function updateSubAccount(db, address, updates) {
  const filteredUpdates = {};
  for (const [key, value] of Object.entries(updates || {})) {
    const column = UPDATE_FIELDS[key];
    if (!column) continue;
    filteredUpdates[column] = value;
  }

  if (Object.keys(filteredUpdates).length === 0) {
    throw new Error("No valid updates provided");
  }

  return withPluginSchema(db, async () => {
    const setClause = Object.keys(filteredUpdates)
      .map(key => `${key} = ?`)
      .join(", ");
    const values = Object.values(filteredUpdates).map(v =>
      typeof v === "boolean" ? (v ? 1 : 0) : v
    );

    await db.prepare(
      `UPDATE sub_accounts SET ${setClause}, updated_at = strftime('%s', 'now') WHERE user_address = ?`
    )
      .bind(...values, address)
      .run();

    const row = await db.prepare(
      "SELECT * FROM sub_accounts WHERE user_address = ?"
    ).bind(address).first();

    if (!row) {
      throw new Error(`Sub-account not found: ${address}`);
    }

    return toApiSubAccount(row);
  });
}

export async function deleteSubAccount(db, address) {
  return withPluginSchema(db, async () => {
    // Clean up dependent rows so FKs stay consistent.
    await db.prepare(
      "DELETE FROM reactive_callback_logs WHERE subscription_id IN (SELECT id FROM reactive_subscriptions WHERE sub_account_address = ?)"
    ).bind(address).run();
    await db.prepare(
      "DELETE FROM reactive_subscriptions WHERE sub_account_address = ?"
    ).bind(address).run();
    await db.prepare(
      "DELETE FROM topup_requests WHERE sub_account_address = ?"
    ).bind(address).run();
    await db.prepare(
      "DELETE FROM sub_account_events WHERE sub_account_address = ?"
    ).bind(address).run();
    await db.prepare(
      "DELETE FROM sub_accounts WHERE user_address = ?"
    ).bind(address).run();
  });
}

export async function emitLowBalanceEvent(db, subAccountAddress, currentBalance, targetTopUp) {
  const timestamp = Math.floor(Date.now() / 1000);

  await withPluginSchema(db, () =>
    db.prepare(
      "INSERT INTO sub_account_events (sub_account_address, event_type, current_balance, target_top_up, timestamp) VALUES (?, ?, ?, ?, ?)"
    ).bind(
      subAccountAddress,
      "LowBalanceDetected",
      String(currentBalance ?? "0"),
      String(targetTopUp ?? "0"),
      timestamp
    ).run()
  );
}