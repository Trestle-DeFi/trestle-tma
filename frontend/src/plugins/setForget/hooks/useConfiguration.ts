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

export const useConfiguration = () => {
  const [preferences, setPreferences] = useState<StoredPreferences | null>(null);
  const [history, setHistory] = useState<ConfigurationHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPreferences = useCallback(async (address: string) => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await pluginApi<any>(
        `/api/plugins/set-forget/configuration/preferences?address=${address}`
      );
      const stored = response?.preferences ?? null;

      if (!stored) {
        setPreferences(null);
        return null;
      }

      const merged = { ...DEFAULT_PREFERENCES, ...stored } as StoredPreferences;
      setPreferences(merged);
      return merged;
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
      };

      const response = await pluginApi<any>(
        '/api/plugins/set-forget/configuration/preferences',
        {
          method: 'PUT',
          body: JSON.stringify(payload),
        }
      );

      const saved = {
        ...payload,
        ...(response?.preferences ?? {}),
        lastUpdated: response?.preferences?.lastUpdated ?? Date.now(),
      } as StoredPreferences;

      setPreferences(saved);
      return saved;
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
