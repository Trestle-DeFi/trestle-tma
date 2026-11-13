import { Hono } from "hono";
import { cors } from "hono/cors";
import { subAccountWorker } from "./subAccountWorker.js";
import { reactiveWorker } from "./reactiveWorker.js";

const app = new Hono();

app.use("*", cors());

let initialized = false;
function ensureInitialized(env) {
  if (initialized) return;
  if (env.SIGNER_PRIVATE_KEY) subAccountWorker.initVaultSigner(env.SIGNER_PRIVATE_KEY);
  if (env.SIGNER_PRIVATE_KEY) reactiveWorker.initVaultSigner(env.SIGNER_PRIVATE_KEY);
  initialized = true;
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
    
    const subAccount = await subAccountWorker.createSubAccount(
      c.env.DB, 
      address, 
      mainVault, 
      config
    );
    
    return c.json(subAccount);
  } catch (e) {
    await writeLog(c.env.DB, { 
      message: e.message, 
      source: "create-subaccount", 
      user: c.req.json()?.address || "unknown" 
    });
    return c.json({ error: e.message }, 500);
  }
});

app.get("/api/plugins/set-forget/subaccounts/:address", async (c) => {
  try {
    ensureInitialized(c.env);
    const address = c.req.param("address");
    const subAccount = await subAccountWorker.getSubAccount(c.env.DB, address);
    
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
    
    const subAccount = await subAccountWorker.updateSubAccount(
      c.env.DB, 
      address, 
      updates
    );
    
    return c.json(subAccount);
  } catch (e) {
    await writeLog(c.env.DB, { 
      message: e.message, 
      source: "update-subaccount", 
      user: c.req.param("address") 
    });
    return c.json({ error: e.message }, 500);
  }
});

app.delete("/api/plugins/set-forget/subaccounts/:address", async (c) => {
  try {
    ensureInitialized(c.env);
    const address = c.req.param("address");
    await subAccountWorker.deleteSubAccount(c.env.DB, address);
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

// Reactive API endpoints
app.post("/api/plugins/set-forget/reactive/subscription", async (c) => {
  try {
    ensureInitialized(c.env);
    const body = await c.req.json();
    const { subAccountAddress, callbackUrl } = body;
    
    if (!subAccountAddress || !callbackUrl) {
      return c.json({ error: "subAccountAddress and callbackUrl are required" }, 400);
    }
    
    // Check if sub-account exists
    const subAccount = await subAccountWorker.getSubAccount(c.env.DB, subAccountAddress);
    if (!subAccount) {
      return c.json({ error: "Sub-account not found" }, 404);
    }
    
    // TODO: Implement reactive subscription setup
    // For now, return a placeholder response
    return c.json({
      subscriptionId: `sub_${Date.now()}`,
      isActive: true,
      events: ["LowBalanceDetected"],
    });
  } catch (e) {
    await writeLog(c.env.DB, { 
      message: e.message, 
      source: "create-subscription", 
      user: c.req.json()?.subAccountAddress || "unknown" 
    });
    return c.json({ error: e.message }, 500);
  }
});

app.get("/api/plugins/set-forget/reactive/status", async (c) => {
  try {
    // TODO: Implement reactive status fetching
    // For now, return a placeholder response
    return c.json({
      subscriptionCount: 0,
      lastTrigger: null,
      pendingCount: 0,
      isConnected: false,
    });
  } catch (e) {
    await writeLog(c.env.DB, { 
      message: e.message, 
      source: "get-reactive-status" 
    });
    return c.json({ error: e.message }, 500);
  }
});

// Helper function for logging
async function writeLog(db, { worker = "vault", level = "error", message, source = "", details = "", url = "", user = "" }) {
  try {
    const ts = Math.floor(Date.now() / 1000);
    await db.prepare(
      "INSERT INTO worker_logs (worker, level, message, source, details, url, user, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(worker, level, (message || "").slice(0, 500), source, (details || "").slice(0, 2000), url || "", user || "", ts).run();
  } catch (e) {
    console.error("Failed to write log:", e.message);
  }
}

export default {
  fetch: app.fetch,
};