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

export async function generateSettlementVoucher(db, env, address) {
  const bal = await getVirtualBalance(db, address);

  if (BigInt(bal.btr_claimable) <= 0n && BigInt(bal.virtual_hnobt) <= 0n) {
    throw new Error("Nothing to settle");
  }

  let nonceRow = await db.prepare("SELECT * FROM settlement_nonces WHERE user_address = ?").bind(address).first();
  const nonce = nonceRow ? nonceRow.nonce + 1 : 0;
  if (!nonceRow) {
    await db.prepare("INSERT INTO settlement_nonces (user_address, nonce) VALUES (?, ?)").bind(address, nonce).run();
  } else {
    await db.prepare("UPDATE settlement_nonces SET nonce = ? WHERE user_address = ?").bind(nonce, address).run();
  }

  const deadline = Math.floor(Date.now() / 1000) + 600;
  const btrAmount = bal.btr_claimable;
  const hNobtStaked = bal.virtual_hnobt;

  const chainId = 137;

  const domain = {
    name: "TrestleVault",
    version: "1",
    chainId,
    verifyingContract: env.VAULT_SETTLEMENT_ADDRESS || "0x89e1404902a861DCFedbC685617B6cc986fD852E",
  };

  const types = {
    Voucher: [
      { name: "walletAddress", type: "address" },
      { name: "btrAmount", type: "uint256" },
      { name: "hNobtStaked", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const value = {
    walletAddress: address,
    btrAmount: btrAmount,
    hNobtStaked: hNobtStaked,
    nonce: BigInt(nonce),
    deadline: BigInt(deadline),
  };

  const signature = await signerAccount.signTypedData({
    domain,
    types,
    primaryType: "Voucher",
    message: {
      walletAddress: value.walletAddress,
      btrAmount: value.btrAmount,
      hNobtStaked: value.hNobtStaked,
      nonce: value.nonce,
      deadline: value.deadline,
    },
  });

  await db.prepare(
    "UPDATE virtual_balances SET virtual_hnobt = '0', btr_claimable = '0', staking_active = 0, staking_tier = 0, last_yield_time = NULL, updated_at = datetime('now') WHERE user_address = ?"
  ).bind(address).run();

  return {
    voucher: {
      walletAddress: address,
      btrAmount,
      hNobtStaked,
      nonce,
      deadline,
    },
    signature,
    domain,
  };
}

export async function processReactiveCallback(db, subAccountAddress, requestId, amount) {
  // Process reactive callback from MainVault
  // Validate callback authorization
  // Update sub-account balance
  // Log the event

  const subAccount = await getSubAccount(db, subAccountAddress);
  if (!subAccount) {
    throw new Error(`Sub-account not found: ${subAccountAddress}`);
  }

  if (!subAccount.isActive) {
    throw new Error(`Sub-account is not active: ${subAccountAddress}`);
  }

  // TODO: Add callback authorization validation
  // TODO: Add balance update logic
  // TODO: Add event logging

  await db.prepare(
    "INSERT INTO sub_account_events (sub_account_address, event_type, current_balance, target_top_up, timestamp) VALUES (?, ?, ?, ?, ?)"
  ).bind(
    subAccountAddress,
    "TopUpReceived",
    amount,
    0,
    Math.floor(Date.now() / 1000)
  ).run();
}

// Helper function to get virtual balance
async function getVirtualBalance(db, address) {
  let row = await db.prepare("SELECT * FROM virtual_balances WHERE user_address = ?").bind(address).first();
  if (!row) {
    await db.prepare("INSERT INTO virtual_balances (user_address) VALUES (?)").bind(address).run();
    row = { user_address: address, virtual_hnobt: "0", btr_claimable: "0", staking_active: 0, staking_tier: 0, last_yield_time: null };
  }
  return row;
}

// Helper function to get sub-account
async function getSubAccount(db, address) {
  return await db.prepare(
    "SELECT * FROM sub_accounts WHERE user_address = ?"
  ).bind(address).first();
}