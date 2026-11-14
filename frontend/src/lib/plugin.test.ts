import { describe, it, expect, vi, beforeEach } from "vitest";
import { pluginApi } from "./plugin";
import { PLUGIN_API_BASE, REWARD_API } from "../config/contracts";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("plugin API", () => {
  it("targets the vault worker, not the reward API", () => {
    // The plugin routes live on the trestle-vault worker. Reward-hub calls
    // (tasks/verify/bounty) must keep going to the reward API.
    expect(PLUGIN_API_BASE).not.toBe(REWARD_API);
  });

  it("calls the vault worker with the given path", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    } as Response);

    const result = await pluginApi("/api/plugins/set-forget/subaccounts");
    expect(result).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith(
      `${PLUGIN_API_BASE}/api/plugins/set-forget/subaccounts`,
      expect.objectContaining({ headers: { "Content-Type": "application/json" } }),
    );
  });

  it("forwards method and body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ subscriptionId: 1 }),
    } as Response);

    await pluginApi("/api/plugins/set-forget/reactive/subscription", {
      method: "POST",
      body: JSON.stringify({ subAccountAddress: "0xabc" }),
    });

    expect(fetch).toHaveBeenCalledWith(
      `${PLUGIN_API_BASE}/api/plugins/set-forget/reactive/subscription`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ subAccountAddress: "0xabc" }),
      }),
    );
  });

  it("throws the server error message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: () => Promise.resolve({ error: "address and mainVault are required" }),
    } as Response);

    await expect(pluginApi("/api/plugins/set-forget/subaccounts")).rejects.toThrow(
      "address and mainVault are required",
    );
  });
});
