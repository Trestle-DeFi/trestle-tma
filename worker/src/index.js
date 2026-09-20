import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  initVaultSigner, getVaultSignerAddress,
  getVirtualBalance, getStakingTiers,
  toggleStaking, applyYield, generateSettlementVoucher, processAllYields,
} from "./vault.js";
import { writeLog } from "./log.js";

const app = new Hono();

app.use("/*", cors());

let initialized = false;
function ensureInitialized(env) {
  if (initialized) return;
  if (env.SIGNER_PRIVATE_KEY) initVaultSigner(env.SIGNER_PRIVATE_KEY);
  initialized = true;
}

app.get("/api/vault/balance/:address", async (c) => {
  try {
    ensureInitialized(c.env);
    const bal = await getVirtualBalance(c.env.DB, c.req.param("address"));
    return c.json(bal);
  } catch (e) {
    await writeLog(c.env.DB, { message: e.message, source: "get-balance", user: c.req.param("address") });
    return c.json({ error: e.message }, 500);
  }
});

app.get("/api/vault/tiers", async (c) => {
  return c.json(getStakingTiers());
});

app.post("/api/vault/stake", async (c) => {
  let address = ""; // declared outside try so the catch block can always log it
  try {
    ensureInitialized(c.env);
    const body = await c.req.json();
    address = body.address || "";
    const { active, tierId } = body;
    if (!address) return c.json({ error: "address required" }, 400);
    const result = await toggleStaking(c.env.DB, address, active, tierId || 0);
    return c.json(result);
  } catch (e) {
    await writeLog(c.env.DB, { message: e.message, source: "stake", user: address });
    return c.json({ error: e.message }, 500);
  }
});

app.post("/api/vault/yield/apply", async (c) => {
  let address = ""; // declared outside try so the catch block can always log it
  try {
    const body = await c.req.json();
    address = body.address || "";
    if (!address) return c.json({ error: "address required" }, 400);
    const bal = await applyYield(c.env.DB, address);
    return c.json(bal);
  } catch (e) {
    await writeLog(c.env.DB, { message: e.message, source: "yield-apply", user: address });
    return c.json({ error: e.message }, 500);
  }
});

app.post("/api/vault/settle/request", async (c) => {
  let address = ""; // declared outside try so the catch block can always log it
  try {
    ensureInitialized(c.env);
    const body = await c.req.json();
    address = body.address || "";
    if (!address) return c.json({ error: "address required" }, 400);
    const result = await generateSettlementVoucher(c.env, address);
    return c.json(result);
  } catch (e) {
    await writeLog(c.env.DB, { message: e.message, source: "settle-request", user: address });
    return c.json({ error: e.message }, 500);
  }
});

app.post("/api/vault/yield/cron", async (c) => {
  try {
    const auth = c.req.header("X-Cron-Secret");
    if (auth !== c.env.CRON_SECRET) return c.json({ error: "Unauthorized" }, 401);
    const count = await processAllYields(c.env.DB);
    return c.json({ processed: count });
  } catch (e) {
    await writeLog(c.env.DB, { message: e.message, source: "yield-cron" });
    return c.json({ error: e.message }, 500);
  }
});

export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    try {
      const count = await processAllYields(env.DB);
      console.log(`[Cron] Processed yields for ${count} active stakers`);
    } catch (e) {
      await writeLog(env.DB, { message: "Cron yield processing failed", details: e.message, source: "cron" });
    }
  },
};
