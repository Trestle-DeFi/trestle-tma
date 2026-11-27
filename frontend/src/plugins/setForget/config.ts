import { parseEther } from 'viem';

export interface TopUpSettings {
  threshold: string;
  target: string;
  cooldown: number;
  maxDaily: number;
}

export interface SetForgetBounds {
  minThresholdWei: bigint;
  minCooldownSeconds: number;
  maxDaily: number;
}

/**
 * The limits the deployed contracts actually enforce. They are read from the
 * chain (registry / guard / vault) instead of being hard-coded in the UI, so
 * the form always reflects the live deployment.
 */
export interface SetForgetChainLimits {
  /** Registry: the smallest threshold the user may set, in wei. */
  minThresholdWei: bigint;
  /** Registry: the smallest cooldown the user may set, in seconds. */
  minCooldownSeconds: number;
  /** Registry: the largest daily refill count a sub-account may set. */
  registryMaxDaily: number;
  /** Guard: the largest daily refill count a subscription may set. */
  guardMaxDaily: number;
  /** Vault: the largest daily top-up request count a user may set. */
  vaultMaxDaily: number;
}

export type RiskLevel = 'low' | 'medium' | 'high';

export interface UserPreferenceValues {
  autoTopupEnabled: boolean;
  notificationsEnabled: boolean;
  riskLevel: RiskLevel;
  gasOptimization: boolean;
}

// Defaults are only a starting point: every user can override them, and the
// bounds are deployment settings rather than fixed protocol constants.
export const DEFAULT_SETTINGS: TopUpSettings = {
  threshold: import.meta.env.VITE_SET_FORGET_DEFAULT_THRESHOLD || '0.01',
  target: import.meta.env.VITE_SET_FORGET_DEFAULT_TARGET || '0.05',
  cooldown: Number(import.meta.env.VITE_SET_FORGET_DEFAULT_COOLDOWN || 300),
  maxDaily: Number(import.meta.env.VITE_SET_FORGET_DEFAULT_MAX_DAILY || 10),
};

export const SET_FORGET_BOUNDS: SetForgetBounds = {
  minThresholdWei: BigInt(
    import.meta.env.VITE_SET_FORGET_MIN_THRESHOLD_WEI || '1000000000000000'
  ),
  minCooldownSeconds: Number(
    import.meta.env.VITE_SET_FORGET_MIN_COOLDOWN_SECONDS || 300
  ),
  maxDaily: Number(import.meta.env.VITE_SET_FORGET_MAX_DAILY || 1000),
};

export const DEFAULT_PREFERENCES: UserPreferenceValues = {
  autoTopupEnabled: true,
  notificationsEnabled: true,
  riskLevel: 'medium',
  gasOptimization: true,
};

/**
 * Last-resort limits, used only when the chain cannot be read (e.g. an RPC
 * outage). They mirror the current deployment: the guard's daily refill cap
 * of 10 is the binding limit, the registry allows 1000 and the vault 100.
 */
export const SET_FORGET_CHAIN_FALLBACK_LIMITS: SetForgetChainLimits = {
  minThresholdWei: SET_FORGET_BOUNDS.minThresholdWei,
  minCooldownSeconds: SET_FORGET_BOUNDS.minCooldownSeconds,
  registryMaxDaily: Number(import.meta.env.VITE_SET_FORGET_MAX_DAILY || 1000),
  guardMaxDaily: Number(import.meta.env.VITE_SET_FORGET_GUARD_MAX_DAILY || 10),
  vaultMaxDaily: Number(import.meta.env.VITE_SET_FORGET_VAULT_MAX_DAILY || 100),
};

/**
 * Derives the bounds the form must respect from the live deployment. Every
 * contract in the path enforces its own limit, so the effective bound is the
 * strictest one: the largest cooldown floor and the smallest daily cap.
 */
export function boundsFromChain(limits?: Partial<SetForgetChainLimits> | null): SetForgetBounds {
  const l = { ...SET_FORGET_CHAIN_FALLBACK_LIMITS, ...(limits ?? {}) };
  const minCooldownSeconds = Math.max(
    SET_FORGET_BOUNDS.minCooldownSeconds,
    l.minCooldownSeconds || 0,
  );
  const maxDaily = Math.max(
    1,
    Math.min(
      l.registryMaxDaily || SET_FORGET_CHAIN_FALLBACK_LIMITS.registryMaxDaily,
      l.guardMaxDaily || SET_FORGET_CHAIN_FALLBACK_LIMITS.guardMaxDaily,
      l.vaultMaxDaily || SET_FORGET_CHAIN_FALLBACK_LIMITS.vaultMaxDaily,
    ),
  );
  return {
    minThresholdWei:
      l.minThresholdWei > 0n ? l.minThresholdWei : SET_FORGET_BOUNDS.minThresholdWei,
    minCooldownSeconds,
    maxDaily,
  };
}

export function validateSettings(
  settings: TopUpSettings,
  bounds: SetForgetBounds = SET_FORGET_BOUNDS
): string | null {
  let thresholdWei: bigint;
  let targetWei: bigint;

  try {
    thresholdWei = parseEther(String(settings.threshold ?? '0'));
  } catch {
    return 'Threshold must be a valid ETH amount';
  }

  try {
    targetWei = parseEther(String(settings.target ?? '0'));
  } catch {
    return 'Target must be a valid ETH amount';
  }

  const cooldown = Number(settings.cooldown);
  const maxDaily = Number(settings.maxDaily);

  if (thresholdWei < bounds.minThresholdWei) {
    return `Threshold must be at least ${bounds.minThresholdWei} wei`;
  }
  if (targetWei <= thresholdWei) {
    return 'Target must be greater than threshold';
  }
  if (!Number.isFinite(cooldown) || cooldown < bounds.minCooldownSeconds) {
    return `Cooldown must be at least ${bounds.minCooldownSeconds} seconds`;
  }
  if (!Number.isInteger(maxDaily) || maxDaily < 1 || maxDaily > bounds.maxDaily) {
    return `Max daily limit must be between 1 and ${bounds.maxDaily}`;
  }

  return null;
}
