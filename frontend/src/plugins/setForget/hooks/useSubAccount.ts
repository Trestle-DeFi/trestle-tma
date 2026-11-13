import { useState, useCallback } from 'react';
import { api } from '../../../lib/api';

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
}

export interface SubAccountData {
  mainVault: string;
  threshold: string;
  target: string;
  cooldown?: number;
  maxDaily?: number;
}

export const useSubAccount = () => {
  const [subAccounts, setSubAccounts] = useState<SubAccount[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSubAccounts = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await api<SubAccount[]>('/api/plugins/set-forget/subaccounts');
      setSubAccounts(data);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch sub-accounts';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createSubAccount = useCallback(async (data: SubAccountData) => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await api<SubAccount>('/api/plugins/set-forget/subaccounts', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      setSubAccounts(prev => [...prev, response]);
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create sub-account';
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
      const response = await api<SubAccount>(`/api/plugins/set-forget/subaccounts/${address}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      setSubAccounts(prev => 
        prev.map(account => account.address === address ? response : account)
      );
      return response;
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
      await api(`/api/plugins/set-forget/subaccounts/${address}`, {
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
      const response = await api<SubAccount>(`/api/plugins/set-forget/subaccounts/${address}`);
      return response;
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
    updateSubAccount,
    deleteSubAccount,
    getSubAccount,
  };
};