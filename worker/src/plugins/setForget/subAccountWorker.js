import { parseEther } from "viem";
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
    thresholdWei: ethToWeiString(row.threshold),
    targetWei: ethToWeiString(row.target),
    cooldown: Number(row.cooldown ?? 0),
    maxDaily: Number(row.max_daily ?? 0),
    isActive: !!row.is_active,
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
    sequence: Number(row.sequence ?? 0),
    totalSpentToday: Number(row.total_spent_today ?? 0),
  };
}

function ethToWeiString(value) {
  try {
    return String(parseEther(String(value ?? "0")));
  } catch {
    return "0";
  }
}

// Protocol bounds for per-user settings. They are configurable per deployment
// (env vars) so a user is never pinned to a hardcoded threshold/cooldown/limit.
export const DEFAULT_BOUNDS = {
  minThresholdWei: 1_000_000_000_000_000n,
  minCooldownSeconds: 300,
  maxDaily: 1000,
};

export function resolveBounds(env = {}) {
  const parseBigInt = (value, fallback) => {
    if (value === undefined || value === null || value === "") return fallback;
    try {
      return BigInt(value);
    } catch {
      return fallback;
    }
  };
  return {
    minThresholdWei: parseBigInt(
      env.SET_FORGET_MIN_THRESHOLD_WEI,
      DEFAULT_BOUNDS.minThresholdWei
    ),
    minCooldownSeconds: Number(
      env.SET_FORGET_MIN_COOLDOWN_SECONDS || DEFAULT_BOUNDS.minCooldownSeconds
    ),
    maxDaily: Number(env.SET_FORGET_MAX_DAILY || DEFAULT_BOUNDS.maxDaily),
  };
}

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
    this.code = "INVALID_CONFIG";
  }
}

// Validate a per-user top-up configuration. Thresholds/targets are expressed
// in ETH (18 decimals on chain) and are converted to wei for the bounds check.
export function validateSubAccountConfig(config, bounds = DEFAULT_BOUNDS) {
  const toWei = (value, label) => {
    try {
      return parseEther(String(value ?? "0"));
    } catch {
      throw new ValidationError(`${label} must be a valid ETH amount`);
    }
  };

  const thresholdWei = toWei(config.threshold, "Threshold");
  const targetWei = toWei(config.target, "Target");
  const cooldown = Number(config.cooldown ?? 0);
  const maxDaily = Number(config.maxDaily ?? 0);

  if (thresholdWei < bounds.minThresholdWei) {
    throw new ValidationError(
      `Threshold must be at least ${bounds.minThresholdWei} wei`
    );
  }
  if (targetWei <= thresholdWei) {
    throw new ValidationError("Target must be greater than threshold");
  }
  if (cooldown < bounds.minCooldownSeconds) {
    throw new ValidationError(
      `Cooldown must be at least ${bounds.minCooldownSeconds} seconds`
    );
  }
  if (!Number.isInteger(maxDaily) || maxDaily < 1 || maxDaily > bounds.maxDaily) {
    throw new ValidationError(
      `Max daily limit must be between 1 and ${bounds.maxDaily}`
    );
  }

  return { thresholdWei, targetWei, cooldown, maxDaily };
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

export async function createSubAccount(db, address, mainVaultRef, config, bounds = DEFAULT_BOUNDS) {
  const {
    threshold = "0",
    target = "0",
    cooldown = 0,
    maxDaily = 0,
  } = config;

  if (!address || !mainVaultRef) {
    throw new Error("address and mainVault are required");
  }

  validateSubAccountConfig({ threshold, target, cooldown, maxDaily }, bounds);

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

    await logConfigurationChanges(db, address, {}, {
      threshold: String(threshold),
      target: String(target),
      cooldown: Number(cooldown) || 0,
      maxDaily: Number(maxDaily) || 0,
    });

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

export async function updateSubAccount(db, address, updates, bounds = DEFAULT_BOUNDS) {
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
    const existing = await db.prepare(
      "SELECT * FROM sub_accounts WHERE user_address = ?"
    ).bind(address).first();

    if (!existing) {
      throw new Error(`Sub-account not found: ${address}`);
    }

    const merged = {
      threshold: filteredUpdates.threshold ?? existing.threshold,
      target: filteredUpdates.target ?? existing.target,
      cooldown: filteredUpdates.cooldown ?? existing.cooldown,
      maxDaily: filteredUpdates.max_daily ?? existing.max_daily,
    };
    validateSubAccountConfig(merged, bounds);

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

    await logConfigurationChanges(
      db,
      address,
      {
        threshold: String(existing.threshold),
        target: String(existing.target),
        cooldown: Number(existing.cooldown),
        maxDaily: Number(existing.max_daily),
      },
      {
        threshold: String(merged.threshold),
        target: String(merged.target),
        cooldown: Number(merged.cooldown),
        maxDaily: Number(merged.maxDaily),
      }
    );

    return toApiSubAccount(row);
  });
}

async function logConfigurationChanges(db, address, previous, next) {
  const entries = Object.entries(next).filter(
    ([key, value]) => String(previous[key] ?? "") !== String(value ?? "")
  );

  for (const [key, value] of entries) {
    await db.prepare(
      "INSERT INTO configuration_history (user_address, setting_key, old_value, new_value, timestamp, changed_by) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(
        address,
        key,
        previous[key] === undefined ? null : String(previous[key]),
        String(value),
        Math.floor(Date.now() / 1000),
        "user"
      )
      .run();
  }
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

// User preferences management
/**
 * @typedef {Object} UserPreferences
 * @property {string} userAddress
 * @property {boolean} autoTopupEnabled
 * @property {boolean} notificationsEnabled
 * @property {'low'|'medium'|'high'} riskLevel
 * @property {boolean} gasOptimization
 * @property {number} lastUpdated
 */

/**
 * @param {any} db
 * @param {string} userAddress
 * @returns {Promise<UserPreferences|null>}
 */
export async function getUserPreferences(db, userAddress) {
  return withPluginSchema(db, async () => {
    const row = await db.prepare(
      "SELECT * FROM user_preferences WHERE user_address = ?"
    ).bind(userAddress).first();
    
    if (!row) return null;
    
    return {
      userAddress: row.user_address,
      autoTopupEnabled: Boolean(row.auto_topup_enabled),
      notificationsEnabled: Boolean(row.notifications_enabled),
      riskLevel: row.risk_level,
      gasOptimization: Boolean(row.gas_optimization),
      lastUpdated: Number(row.last_updated),
    };
  });
}

export async function saveUserPreferences(db, preferences) {
  if (!preferences?.userAddress) {
    throw new ValidationError("userAddress is required");
  }

  const riskLevel = preferences.riskLevel ?? "medium";
  if (!["low", "medium", "high"].includes(riskLevel)) {
    throw new ValidationError("riskLevel must be low, medium or high");
  }

  return withPluginSchema(db, async () => {
    const existing = await db.prepare(
      "SELECT * FROM user_preferences WHERE user_address = ?"
    ).bind(preferences.userAddress).first();

    const autoTopupEnabled =
      preferences.autoTopupEnabled ?? (existing ? Boolean(existing.auto_topup_enabled) : true);
    const notificationsEnabled =
      preferences.notificationsEnabled ?? (existing ? Boolean(existing.notifications_enabled) : true);
    const gasOptimization =
      preferences.gasOptimization ?? (existing ? Boolean(existing.gas_optimization) : true);

    const now = Math.floor(Date.now() / 1000);

    await db.prepare(
      "INSERT INTO user_preferences (user_address, auto_topup_enabled, notifications_enabled, risk_level, gas_optimization, last_updated) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_address) DO UPDATE SET auto_topup_enabled=excluded.auto_topup_enabled, notifications_enabled=excluded.notifications_enabled, risk_level=excluded.risk_level, gas_optimization=excluded.gas_optimization, last_updated=excluded.last_updated"
    ).bind(
      preferences.userAddress,
      autoTopupEnabled ? 1 : 0,
      notificationsEnabled ? 1 : 0,
      riskLevel,
      gasOptimization ? 1 : 0,
      now
    ).run();

    // Log changes for audit trail
    const prev = existing
      ? {
          autoTopupEnabled: Boolean(existing.auto_topup_enabled),
          notificationsEnabled: Boolean(existing.notifications_enabled),
          riskLevel: existing.risk_level,
          gasOptimization: Boolean(existing.gas_optimization),
        }
      : {};
    const next = { autoTopupEnabled, notificationsEnabled, riskLevel, gasOptimization };
    for (const key of Object.keys(next)) {
      if (String(prev[key] ?? "") !== String(next[key])) {
        await logConfigurationChange(db, preferences.userAddress, key, prev[key], next[key]);
      }
    }

    return {
      userAddress: preferences.userAddress,
      autoTopupEnabled,
      notificationsEnabled,
      riskLevel,
      gasOptimization,
      lastUpdated: now,
    };
  });
}

/**
 * @param {any} db
 * @param {string} userAddress
 * @param {number} [limit]
 */
export async function getUserConfigurationHistory(db, userAddress, limit = 50) {
  return withPluginSchema(db, async () => {
    const { results } = await db.prepare(
      "SELECT * FROM configuration_history WHERE user_address = ? ORDER BY timestamp DESC LIMIT ?"
    ).bind(userAddress, limit).all();
    
    return (results || []).map(row => ({
      id: row.id,
      userAddress: row.user_address,
      settingKey: row.setting_key,
      oldValue: row.old_value,
      newValue: row.new_value,
      timestamp: Number(row.timestamp),
      changedBy: row.changed_by,
    }));
  });
}

/**
 * @param {any} db
 * @param {string} userAddress
 * @param {string} settingKey
 * @param {any} oldValue
 * @param {any} newValue
 * @param {string} [changedBy]
 */
export async function logConfigurationChange(db, userAddress, settingKey, oldValue, newValue, changedBy = 'user') {
  return withPluginSchema(db, async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    
    await db.prepare(
      "INSERT INTO configuration_history (user_address, setting_key, old_value, new_value, timestamp, changed_by) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(
      userAddress,
      settingKey,
      typeof oldValue === 'object' ? JSON.stringify(oldValue) : String(oldValue),
      typeof newValue === 'object' ? JSON.stringify(newValue) : String(newValue),
      timestamp,
      changedBy
    ).run();
  });
}