import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  initVaultSigner as initSubAccountSigner,
  createSubAccount,
  getSubAccount,
  listSubAccounts,
  updateSubAccount,
  deleteSubAccount,
  getUserPreferences,
  saveUserPreferences,
  getUserConfigurationHistory,
  resolveBounds,
} from "./subAccountWorker.js";
import {
  getReactiveStatus,
  persistSubscription,
  listSubscriptions,
  readOnChainSubscription,
  processReactiveCallback,
  LOW_BALANCE_TOPIC,
} from "./reactiveWorker.js";
import { writeLog } from "../../log.js";
import { withPluginSchema } from "./schema.js";

const app = new Hono();

app.use("*", cors());

function ensureInitialized(env) {
  if (env.SIGNER_PRIVATE_KEY) initSubAccountSigner(env.SIGNER_PRIVATE_KEY);
}

// Sub-Account API endpoints
app.post("/api/plugins/set-forget/subaccounts", async (c) => {
  try {
    ensureInitialized(c.env);
    const body = await c.req.json();
    const { address, mainVault, ...config } = body;

    if (!address || !mainVault) {
      return c.json({ error: "address and mainVault are required" }, 400);
    }

    const subAccount = await createSubAccount(
      c.env.DB,
      address,
      mainVault,
      config,
      resolveBounds(c.env)
    );

    return c.json(subAccount);
  } catch (e) {
    await writeLog(c.env.DB, {
      message: e.message,
      source: "create-subaccount",
      user: "unknown"
    });
    return c.json({ error: e.message }, e.code === "INVALID_CONFIG" ? 400 : 500);
  }
});

app.get("/api/plugins/set-forget/subaccounts", async (c) => {
  try {
    ensureInitialized(c.env);
    const subAccounts = await listSubAccounts(c.env.DB);
    return c.json({ subaccounts: subAccounts });
  } catch (e) {
    await writeLog(c.env.DB, {
      message: e.message,
      source: "list-subaccounts"
    });
    return c.json({ error: e.message }, 500);
  }
});

app.get("/api/plugins/set-forget/subaccounts/:address", async (c) => {
  try {
    ensureInitialized(c.env);
    const address = c.req.param("address");
    const subAccount = await getSubAccount(c.env.DB, address);
    
    if (!subAccount) {
      return c.json({ error: "Sub-account not found" }, 404);
    }
    
    return c.json(subAccount);
  } catch (e) {
    await writeLog(c.env.DB, { 
      message: e.message, 
      source: "get-subaccount", 
      user: c.req.param("address") 
    });
    return c.json({ error: e.message }, 500);
  }
});

app.put("/api/plugins/set-forget/subaccounts/:address", async (c) => {
  try {
    ensureInitialized(c.env);
    const address = c.req.param("address");
    const updates = await c.req.json();
    
    const subAccount = await updateSubAccount(
      c.env.DB, 
      address, 
      updates,
      resolveBounds(c.env)
    );
    
    return c.json(subAccount);
  } catch (e) {
    await writeLog(c.env.DB, { 
      message: e.message, 
      source: "update-subaccount", 
      user: c.req.param("address") 
    });
    return c.json({ error: e.message }, e.code === "INVALID_CONFIG" ? 400 : 500);
  }
});

app.delete("/api/plugins/set-forget/subaccounts/:address", async (c) => {
  try {
    ensureInitialized(c.env);
    const address = c.req.param("address");
    await deleteSubAccount(c.env.DB, address);
    return c.json({ success: true });
  } catch (e) {
    await writeLog(c.env.DB, { 
      message: e.message, 
      source: "delete-subaccount", 
      user: c.req.param("address") 
    });
    return c.json({ error: e.message }, 500);
  }
});

// ─── Per-user configuration API ───────────────────────────────────────────

app.get("/api/plugins/set-forget/configuration/preferences", async (c) => {
  try {
    const address = c.req.query("address");
    if (!address) {
      return c.json({ error: "address is required" }, 400);
    }

    const preferences = await withPluginSchema(c.env.DB, () =>
      getUserPreferences(c.env.DB, address)
    );

    return c.json({ preferences });
  } catch (e) {
    await writeLog(c.env.DB, {
      message: e.message,
      source: "get-preferences",
    });
    return c.json({ error: e.message }, 500);
  }
});

app.put("/api/plugins/set-forget/configuration/preferences", async (c) => {
  try {
    const body = await c.req.json();
    const { userAddress, ...preferences } = body;

    if (!userAddress) {
      return c.json({ error: "userAddress is required" }, 400);
    }

    const saved = await withPluginSchema(c.env.DB, () =>
      saveUserPreferences(c.env.DB, { userAddress, ...preferences })
    );

    return c.json({ preferences: saved });
  } catch (e) {
    await writeLog(c.env.DB, {
      message: e.message,
      source: "save-preferences",
      user: "unknown",
    });
    return c.json({ error: e.message }, e.code === "INVALID_CONFIG" ? 400 : 500);
  }
});

app.get("/api/plugins/set-forget/configuration/history", async (c) => {
  try {
    const address = c.req.query("address");
    if (!address) {
      return c.json({ error: "address is required" }, 400);
    }

    const limit = Number(c.req.query("limit") || 50);
    const history = await withPluginSchema(c.env.DB, () =>
      getUserConfigurationHistory(c.env.DB, address, limit)
    );

    return c.json({ history });
  } catch (e) {
    await writeLog(c.env.DB, {
      message: e.message,
      source: "get-configuration-history",
    });
    return c.json({ error: e.message }, 500);
  }
});

// ─── Reactive API endpoints ───────────────────────────────────────────────

/**
 * Create or refresh a reactive subscription for a sub-account.
 *
 * The on-chain subscription is managed by the ReactiveGuard contract on Lasna
 * (owner-only `setupSubscription`). This endpoint mirrors that state into D1
 * and reports the live on-chain truth alongside it.
 */
app.post("/api/plugins/set-forget/reactive/subscription", async (c) => {
  try {
    const body = await c.req.json();
    const { subAccountAddress, callbackUrl } = body;

    if (!subAccountAddress) {
      return c.json({ error: "subAccountAddress is required" }, 400);
    }

    const subAccount = await getSubAccount(c.env.DB, subAccountAddress);
    if (!subAccount) {
      return c.json({ error: "Sub-account not found" }, 404);
    }

    const resolvedCallbackUrl =
      callbackUrl || `${c.req.url.split("/api/")[0]}/api/plugins/set-forget/reactive/callback`;

    const subscription = await withPluginSchema(c.env.DB, () =>
      persistSubscription(c.env.DB, subAccountAddress, resolvedCallbackUrl, LOW_BALANCE_TOPIC)
    );

    // Best-effort: surface the live on-chain subscription when the guard has one.
    let onChain = null;
    try {
      onChain = await readOnChainSubscription(c.env, subAccountAddress);
    } catch {
      onChain = null;
    }

    await writeLog(c.env.DB, {
      level: "info",
      message: `Reactive subscription mirrored for ${subAccountAddress}`,
      source: "create-subscription",
      user: subAccountAddress,
    });

    return c.json({
      subscriptionId: subscription.id,
      subAccountAddress,
      callbackUrl: resolvedCallbackUrl,
      lasnaTopic: subscription.lasnaTopic,
      isActive: subscription.isActive,
      config: {
        threshold: subAccount.threshold,
        target: subAccount.target,
        thresholdWei: subAccount.thresholdWei,
        targetWei: subAccount.targetWei,
        cooldown: subAccount.cooldown,
        maxDaily: subAccount.maxDaily,
      },
      onChain,
      events: ["LowBalanceDetected"],
    });
  } catch (e) {
    await writeLog(c.env.DB, {
      message: e.message,
      source: "create-subscription",
      user: "unknown"
    });
    return c.json({ error: e.message }, 500);
  }
});

app.get("/api/plugins/set-forget/reactive/subscriptions", async (c) => {
  try {
    const subscriptions = await withPluginSchema(c.env.DB, () =>
      listSubscriptions(c.env.DB)
    );
    return c.json({ subscriptions });
  } catch (e) {
    await writeLog(c.env.DB, {
      message: e.message,
      source: "list-subscriptions"
    });
    return c.json({ error: e.message }, 500);
  }
});

/**
 * Live Reactive Network status: on-chain guard state from Lasna plus the
 * worker's own pending/last-trigger bookkeeping from D1.
 */
app.get("/api/plugins/set-forget/reactive/status", async (c) => {
  try {
    const status = await withPluginSchema(c.env.DB, () =>
      getReactiveStatus(c.env.DB, c.env)
    );
    return c.json(status);
  } catch (e) {
    await writeLog(c.env.DB, {
      message: e.message,
      source: "get-reactive-status"
    });
    return c.json({ error: e.message }, 500);
  }
});

/**
 * Callback receiver for the Reactive Network / MainVault top-up flow.
 */
app.post("/api/plugins/set-forget/reactive/callback", async (c) => {
  try {
    const body = await c.req.json();
    const { subAccountAddress, requestId, amount, eventData } = body;

    if (!subAccountAddress) {
      return c.json({ error: "subAccountAddress is required" }, 400);
    }

    const result = await processReactiveCallback(c.env.DB, c.env, {
      subAccountAddress,
      requestId,
      amount,
      eventData,
    });

    return c.json(result);
  } catch (e) {
    await writeLog(c.env.DB, {
      message: e.message,
      source: "reactive-callback"
    });
    return c.json({ error: e.message }, 500);
  }
});

// Export the Hono app itself so the parent worker can mount it with
// `app.route("/", setForgetPlugin)`. Hono's route() copies `app.routes` —
// exporting a bare `{ fetch }` object makes the mount throw at worker startup.
export default app;