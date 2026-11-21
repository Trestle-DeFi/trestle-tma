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
