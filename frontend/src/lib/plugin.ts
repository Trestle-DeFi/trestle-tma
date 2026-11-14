import { PLUGIN_API_BASE } from "../config/contracts";

/**
 * Client for the Set & Forget plugin API.
 *
 * The plugin routes are mounted on the trestle-vault worker (vault.trestle.website),
 * NOT on the reward API. Reward-hub calls (tasks / verify / bounty) must keep using
 * `lib/api.ts` → `API_BASE` → reward-api.trestle.website.
 */
export async function pluginApi<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(`${PLUGIN_API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error(e.error || r.statusText);
  }
  return r.json();
}
