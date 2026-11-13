import { privateKeyToAccount } from "viem/accounts";

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

export async function createSubAccount(db, address, mainVaultRef, config) {
  const {
    threshold = "0",
    target = "0", 
    cooldown = 0,
    maxDaily = 0,
  } = config;

  const existing = await db.prepare(
    "SELECT * FROM sub_accounts WHERE user_address = ?"
  ).bind(address).first();

  if (existing) {
    throw new Error(`Sub-account already exists for address ${address}`);
  }

  await db.prepare(
    "INSERT INTO sub_accounts (user_address, main_vault_ref, threshold, target, cooldown, max_daily, is_active, created_at, sequence, total_spent_today) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 0, 0)"
  ).bind(
    address,
    mainVaultRef,
    threshold,
    target,
    cooldown,
    maxDaily,
    Math.floor(Date.now() / 1000)
  ).run();

  return { address, mainVault: mainVaultRef, ...config, isActive: true };
}

export async function getSubAccount(db, address) {
  return await db.prepare(
    "SELECT * FROM sub_accounts WHERE user_address = ?"
  ).bind(address).first();
}

export async function updateSubAccount(db, address, updates) {
  const allowedUpdates = ["threshold", "target", "cooldown", "max_daily", "is_active"];
  const filteredUpdates = Object.keys(updates)
    .filter(key => allowedUpdates.includes(key))
    .reduce((obj, key) => {
      obj[key] = updates[key];
      return obj;
    }, {});

  if (Object.keys(filteredUpdates).length === 0) {
    throw new Error("No valid updates provided");
  }

  const setClause = Object.keys(filteredUpdates)
    .map(key => `${key} = ?`)
    .join(", ");

  const values = Object.values(filteredUpdates);

  await db.prepare(
    `UPDATE sub_accounts SET ${setClause}, updated_at = datetime('now') WHERE user_address = ?`
  )
    .bind(...values, address)
    .run();

  return await getSubAccount(db, address);
}

export async function deleteSubAccount(db, address) {
  await db.prepare("DELETE FROM sub_accounts WHERE user_address = ?").bind(address).run();
}

export async function emitLowBalanceEvent(db, subAccountAddress, currentBalance, targetTopUp) {
  const timestamp = Math.floor(Date.now() / 1000);

  await db.prepare(
    "INSERT INTO sub_account_events (sub_account_address, event_type, current_balance, target_top_up, timestamp) VALUES (?, ?, ?, ?, ?)"
  ).bind(
    subAccountAddress,
    "LowBalanceDetected",
    currentBalance,
    targetTopUp,
    timestamp
  ).run();
}