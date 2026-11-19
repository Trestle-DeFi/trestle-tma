import { useState, useCallback } from 'react';
import { pluginApi } from '../../../lib/plugin';

export interface SubAccount {
  address: string;
  mainVault: string;
  threshold: string;
  target: string;
  cooldown: number;
  maxDaily: number;
  isActive: boolean;
  createdAt: number;
  sequence: number;
  totalSpentToday: number;
  updatedAt: number;
}

export interface SubAccountData {
  mainVault: string;
  threshold: string;
  target: string;
  cooldown?: number;
  maxDaily?: number;
  // Per-user configuration can be added by extending this interface
  userSpecificSettings?: Record<string, any>;
}

// The worker stores `address` as the primary key — it is the sub-account owner
// address, supplied by the caller when creating a sub-account.
export interface CreateSubAccountData extends SubAccountData {
  address: string;
  // User's wallet address can be used to resolve per-user settings from worker config
  walletAddress?: string;
  // Indicates whether to apply environment-variable overrides for this user
  useEnvironmentOverrides?: boolean;
}

// Normalise a worker row (snake_case or camelCase) into the camelCase shape
// the UI consumes. The worker may return either depending on the route.
function normalise(row: any): SubAccount {
  return {
    address: row.address ?? row.user_address,
    mainVault: row.mainVault ?? row.main_vault_ref,
    threshold: String(row.threshold ?? "0"),
    target: String(row.target ?? "0"),
    cooldown: Number(row.cooldown ?? 0),
    maxDaily: Number(row.maxDaily ?? row.max_daily ?? 0),
    isActive: Boolean(row.isActive ?? row.is_active),
    createdAt: Number(row.createdAt ?? row.created_at ?? 0),
    sequence: Number(row.sequence ?? 0),
    totalSpentToday: Number(row.totalSpentToday ?? row.total_spent_today ?? 0),
    updatedAt: Number(row.updatedAt ?? row.updated_at ?? 0),
  };
}

export const useSubAccount = () => {
  const [subAccounts, setSubAccounts] = useState<SubAccount[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSubAccounts = useCallback(async (): Promise<SubAccount[]> => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await pluginApi<any>('/api/plugins/set-forget/subaccounts');
      // Worker returns { subaccounts: [...] } — normalise
      const raw: any[] = Array.isArray(response)
        ? response
        : Array.isArray(response?.subaccounts)
          ? response.subaccounts
          : [];
      const data = raw.map(normalise);
      setSubAccounts(data);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch sub-accounts';
      setError(message);
      setSubAccounts([]);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createSubAccount = useCallback(async (data: CreateSubAccountData) => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await pluginApi<any>('/api/plugins/set-forget/subaccounts', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      const created = normalise(response);
      setSubAccounts(prev => [...prev, created]);
      return created;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create sub-account';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // New function: Create sub-account with per-user configuration
  const createSubAccountWithPerUserConfig = useCallback(async (
    userAddress: string,
    configData: SubAccountData,
    options?: {
      useEnvironmentOverrides?: boolean;
      walletAddress?: string;
    }
  ) => {
    try {
      setIsLoading(true);
      setError(null);
      const requestBody = {
        ...configData,
        address: userAddress,
        walletAddress: options?.walletAddress || userAddress,
        useEnvironmentOverrides: options?.useEnvironmentOverrides ?? true,
      };
      const response = await pluginApi<any>('/api/plugins/set-forget/subaccounts', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      });
      const created = normalise(response);
      setSubAccounts(prev => [...prev, created]);
      return created;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create sub-account with per-user config';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateSubAccount = useCallback(async (address: string, updates: Partial<SubAccountData>) => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await pluginApi<any>(`/api/plugins/set-forget/subaccounts/${address}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      const updated = normalise(response);
      setSubAccounts(prev =>
        prev.map(account => account.address === address ? { ...account, ...updated } : account)
      );
      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update sub-account';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const deleteSubAccount = useCallback(async (address: string) => {
    try {
      setIsLoading(true);
      setError(null);
      await pluginApi(`/api/plugins/set-forget/subaccounts/${address}`, {
        method: 'DELETE',
      });
      setSubAccounts(prev => prev.filter(account => account.address !== address));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete sub-account';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getSubAccount = useCallback(async (address: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await pluginApi<any>(`/api/plugins/set-forget/subaccounts/${address}`);
      return normalise(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch sub-account';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    subAccounts,
    isLoading,
    error,
    fetchSubAccounts,
    createSubAccount,
    createSubAccountWithPerUserConfig,
    updateSubAccount,
    deleteSubAccount,
    getSubAccount,
  };
};