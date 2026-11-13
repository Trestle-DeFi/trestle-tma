-- Sub-accounts table for Set & Forget plugin
CREATE TABLE IF NOT EXISTS sub_accounts (
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
);

-- Reactive subscriptions table for tracking event subscriptions
CREATE TABLE IF NOT EXISTS reactive_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sub_account_address TEXT NOT NULL,
    lasna_topic TEXT NOT NULL,
    callback_url TEXT NOT NULL,
    is_active BOOLEAN DEFAULT 1,
    last_check INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY sub_account_address REFERENCES sub_accounts(user_address)
);

-- Top-up requests table for tracking reactive callbacks
CREATE TABLE IF NOT EXISTS topup_requests (
    request_id TEXT PRIMARY KEY,
    sub_account_address TEXT NOT NULL,
    amount TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    callback_triggered_at INTEGER,
    expires_at INTEGER NOT NULL,
    callback_data TEXT,
    FOREIGN KEY sub_account_address REFERENCES sub_accounts(user_address)
);

-- Sub-account events table for audit logging
CREATE TABLE IF NOT EXISTS sub_account_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sub_account_address TEXT NOT NULL,
    event_type TEXT NOT NULL,
    current_balance TEXT,
    target_top_up TEXT,
    timestamp INTEGER NOT NULL,
    details TEXT,
    FOREIGN KEY sub_account_address REFERENCES sub_accounts(user_address)
);

-- Reactive callback logs table for tracking subscription callbacks
CREATE TABLE IF NOT EXISTS reactive_callback_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscription_id INTEGER,
    event_type TEXT NOT NULL,
    event_data TEXT,
    callback_sent_at INTEGER NOT NULL,
    callback_response TEXT,
    callback_status TEXT DEFAULT 'pending',
    FOREIGN KEY subscription_id REFERENCES reactive_subscriptions(id)
);