// Runtime self-heal for the Set & Forget plugin tables.
//
// The vault worker shares D1 `trestle-reward-db` with the reward worker, and
// wrangler only applies migrations from the top level of `migrations/`.
// Rather than depend on a CI migration step racing the shared ledger, the
// plugin creates its own tables on demand (same pattern as the reward
// worker's `shared/report.js` ensureTable() + retry).

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS sub_accounts (
    user_address TEXT PRIMARY KEY,
    main_vault_ref TEXT NOT NULL,
    threshold TEXT NOT NULL DEFAULT '0',
    target TEXT NOT NULL DEFAULT '0',
    sequence INTEGER DEFAULT 0,
    cooldown INTEGER DEFAULT 0,
    max_daily INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    total_spent_today TEXT DEFAULT '0'
  )`,
  `CREATE TABLE IF NOT EXISTS reactive_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sub_account_address TEXT NOT NULL,
    lasna_topic TEXT NOT NULL,
    callback_url TEXT NOT NULL,
    is_active BOOLEAN DEFAULT 1,
    last_check INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (sub_account_address) REFERENCES sub_accounts(user_address)
  )`,
  `CREATE TABLE IF NOT EXISTS topup_requests (
    request_id TEXT PRIMARY KEY,
    sub_account_address TEXT NOT NULL,
    amount TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    callback_triggered_at INTEGER,
    expires_at INTEGER NOT NULL,
    callback_data TEXT,
    FOREIGN KEY (sub_account_address) REFERENCES sub_accounts(user_address)
  )`,
  `CREATE TABLE IF NOT EXISTS sub_account_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sub_account_address TEXT NOT NULL,
    event_type TEXT NOT NULL,
    current_balance TEXT,
    target_top_up TEXT,
    timestamp INTEGER NOT NULL,
    details TEXT,
    FOREIGN KEY (sub_account_address) REFERENCES sub_accounts(user_address)
  )`,
  `CREATE TABLE IF NOT EXISTS reactive_callback_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscription_id INTEGER,
    event_type TEXT NOT NULL,
    event_data TEXT,
    callback_sent_at INTEGER NOT NULL,
    callback_response TEXT,
    callback_status TEXT DEFAULT 'pending',
    FOREIGN KEY (subscription_id) REFERENCES reactive_subscriptions(id)
  )`,
  `CREATE TABLE IF NOT EXISTS user_preferences (
    user_address TEXT PRIMARY KEY,
    auto_topup_enabled BOOLEAN DEFAULT 1,
    notifications_enabled BOOLEAN DEFAULT 1,
    risk_level TEXT DEFAULT 'medium',
    gas_optimization BOOLEAN DEFAULT 1,
    last_updated INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  )`,
  `CREATE TABLE IF NOT EXISTS configuration_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_address TEXT NOT NULL,
    setting_key TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    timestamp INTEGER NOT NULL,
    changed_by TEXT
  )`,
];

let schemaReady = false;

/**
 * Ensure the plugin's D1 tables exist. Idempotent and safe to call per-request.
 */
export async function ensurePluginSchema(db) {
  if (!db) return;
  if (schemaReady) return;
  for (const stmt of SCHEMA_STATEMENTS) {
    try {
      await db.prepare(stmt).run();
    } catch (e) {
      // A concurrent worker instance may have created it first — harmless.
      if (!/already exists/i.test(e.message)) throw e;
    }
  }
  schemaReady = true;
}

/**
 * Run `fn`, and if D1 reports a missing table, create the schema and retry once.
 */
export async function withPluginSchema(db, fn) {
  await ensurePluginSchema(db);
  try {
    return await fn();
  } catch (e) {
    if (/no such table/i.test(e.message)) {
      schemaReady = false;
      await ensurePluginSchema(db);
      return await fn();
    }
    throw e;
  }
}

export { SCHEMA_STATEMENTS };
