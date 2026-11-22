import { useState, useCallback, useEffect } from 'react';
import { pluginApi } from '../../../lib/plugin';

export interface ReactiveSubscription {
  id: number;
  subAccountAddress: string;
  lasnaTopic: string;
  callbackUrl: string;
  isActive: boolean;
  createdAt: number;
}

export interface ReactiveStatus {
  subscriptionCount: number;
  lastTrigger?: string;
  pendingCount: number;
  lastError?: string;
  isConnected: boolean;
  // Live on-chain guard state (Lasna / Reactive Network)
  guardAddress?: string;
  onChainSubscriptionCount?: number;
  subscriptions?: ReactiveSubscription[];
}

const EMPTY_STATUS: ReactiveStatus = {
  subscriptionCount: 0,
  lastTrigger: undefined,
  pendingCount: 0,
  lastError: undefined,
  isConnected: false,
};

export const useReactive = () => {
  const [status, setStatus] = useState<ReactiveStatus>(EMPTY_STATUS);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyStatus = useCallback((response: any) => {
    const merged: ReactiveStatus = {
      subscriptionCount: Number(response?.subscriptionCount ?? 0),
      lastTrigger: response?.lastTrigger ?? undefined,
      pendingCount: Number(response?.pendingCount ?? 0),
      isConnected: Boolean(response?.isConnected ?? false),
      lastError: response?.lastError ?? undefined,
      guardAddress: response?.guardAddress,
      onChainSubscriptionCount: response?.onChainSubscriptionCount,
      subscriptions: Array.isArray(response?.subscriptions) ? response.subscriptions : [],
    };
    setStatus(merged);
    return merged;
  }, []);

  const getReactiveStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await pluginApi<any>('/api/plugins/set-forget/reactive/status');
      return applyStatus(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch reactive status';
      setError(message);
      setStatus(prev => ({ ...prev, isConnected: false, lastError: message }));
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [applyStatus]);

  // Kept for API compatibility with the plugin UI — pulls current status from
  // the vault worker rather than creating anything.
  const fetchReactiveStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await pluginApi<any>('/api/plugins/set-forget/reactive/status');
      return applyStatus(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to setup reactive subscription';
      setError(message);
      setStatus(prev => ({ ...prev, isConnected: false, lastError: message }));
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [applyStatus]);

  const subscribeToEvents = useCallback(async (subAccountAddress: string, callbackUrl: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await pluginApi<any>('/api/plugins/set-forget/reactive/subscription', {
        method: 'POST',
        body: JSON.stringify({ subAccountAddress, callbackUrl }),
      });
      // Re-read authoritative status so the counter reflects the worker's real state.
      await getReactiveStatus();
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to subscribe to events';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [getReactiveStatus]);

  const refreshStatus = useCallback(async () => {
    try {
      await getReactiveStatus();
    } catch (err) {
      // Silent error handling for refresh
      console.error('Failed to refresh reactive status:', err);
    }
  }, [getReactiveStatus]);

  // Auto-refresh status every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      refreshStatus();
    }, 30000);

    return () => clearInterval(interval);
  }, [refreshStatus]);

  return {
    status,
    isLoading,
    error,
    fetchReactiveStatus,
    setupSubscription: fetchReactiveStatus,
    getReactiveStatus,
    subscribeToEvents,
    refreshStatus,
  };
};