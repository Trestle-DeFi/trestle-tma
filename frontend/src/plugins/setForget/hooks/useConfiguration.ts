import { useState, useCallback } from 'react';
import { pluginApi } from '../../../lib/plugin';
import {
  DEFAULT_PREFERENCES,
  RiskLevel,
  UserPreferenceValues,
} from '../config';

export interface StoredPreferences extends UserPreferenceValues {
  userAddress: string;
  lastUpdated: number;
}

export interface ConfigurationHistoryEntry {
  id: number;
  userAddress: string;
  settingKey: string;
  oldValue: string | null;
  newValue: string | null;
  timestamp: number;
  changedBy: string | null;
}

// The browser keeps a per-user copy of the preferences under this key. The
// worker holds the same values in D1; the browser copy is what keeps the form
// usable when the plugin API is unreachable.
const storageKey = (address: string) => `user-config-${address}`;

function readLocalPreferences(address: string): StoredPreferences | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey(address));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const merged = { ...DEFAULT_PREFERENCES, ...parsed } as StoredPreferences;
    merged.userAddress = address;
    if (typeof merged.lastUpdated !== 'number') merged.lastUpdated = Date.now();
    return merged;
  } catch {
    return null;
  }
}

function writeLocalPreferences(address: string, preferences: StoredPreferences) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey(address), JSON.stringify(preferences));
  } catch {
    // A disabled or full localStorage must never break the save flow.
  }
}

function validatePreferences(candidate: Partial<StoredPreferences>): StoredPreferences {
  const merged = { ...DEFAULT_PREFERENCES, ...candidate } as StoredPreferences;
  const validRisk = (['low', 'medium', 'high'] as const).includes(merged.riskLevel as any)
    ? merged.riskLevel
    : DEFAULT_PREFERENCES.riskLevel;
  return { ...merged, riskLevel: validRisk } as StoredPreferences;
}

export const useConfiguration = () => {
  const [preferences, setPreferences] = useState<StoredPreferences | null>(null);
  const [history, setHistory] = useState<ConfigurationHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPreferences = useCallback(async (address: string) => {
    try {
      setIsLoading(true);
      setError(null);

      // The worker copy wins; the browser copy is the fallback when the
      // plugin API is unreachable.
      let stored: Partial<StoredPreferences> | null = null;
      try {
        const response = await pluginApi<any>(
          `/api/plugins/set-forget/configuration/preferences?address=${address}`
        );
        stored = response?.preferences ?? null;
      } catch (err) {
        console.warn('Falling back to the locally stored preferences:', err);
        stored = null;
      }

      const merged = stored ?? readLocalPreferences(address);
      if (!merged) {
        setPreferences(null);
        return null;
      }

      const validated = validatePreferences({ ...merged, userAddress: address });
      writeLocalPreferences(address, validated);
      setPreferences(validated);
      return validated;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load preferences');
      setPreferences(null);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const savePreferences = useCallback(
    async (address: string, values: Partial<UserPreferenceValues>) => {
      const payload = {
        ...DEFAULT_PREFERENCES,
        ...values,
        riskLevel: (values.riskLevel ?? DEFAULT_PREFERENCES.riskLevel) as RiskLevel,
        userAddress: address,
        lastUpdated: Date.now(),
      } as StoredPreferences;

      // The browser copy is written first so a failing worker mirror never
      // loses the user's settings.
      writeLocalPreferences(address, payload);

      try {
        const response = await pluginApi<any>(
          '/api/plugins/set-forget/configuration/preferences',
          {
            method: 'PUT',
            body: JSON.stringify(payload),
          }
        );

        const saved = validatePreferences({
          ...payload,
          ...(response?.preferences ?? {}),
          userAddress: address,
        });

        writeLocalPreferences(address, saved);
        setPreferences(saved);
        return saved;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save preferences');
        throw err;
      }
    },
    []
  );

  const loadHistory = useCallback(async (address: string, limit = 50) => {
    try {
      const response = await pluginApi<any>(
        `/api/plugins/set-forget/configuration/history?address=${address}&limit=${limit}`
      );
      const entries: ConfigurationHistoryEntry[] = Array.isArray(response?.history)
        ? response.history
        : [];
      setHistory(entries);
      return entries;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load configuration history');
      setHistory([]);
      return [];
    }
  }, []);

  return {
    preferences,
    history,
    isLoading,
    error,
    loadPreferences,
    savePreferences,
    loadHistory,
  };
};
