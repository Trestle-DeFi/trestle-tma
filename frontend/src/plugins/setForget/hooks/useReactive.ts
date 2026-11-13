import { useState, useCallback, useEffect } from 'react';
import { api } from '../../../lib/api';

export interface ReactiveStatus {
  subscriptionCount: number;
  lastTrigger?: string;
  pendingCount: number;
  lastError?: string;
  isConnected: boolean;
}

export const useReactive = () => {
  const [status, setStatus] = useState<ReactiveStatus>({
    subscriptionCount: 0,
    lastTrigger: undefined,
    pendingCount: 0,
    lastError: undefined,
    isConnected: false,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setupSubscription = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await api('/api/plugins/set-forget/reactive/subscription', {
      method: 'POST',
    });
      setStatus(prev => ({
        ...prev,
        subscriptionCount: response.subscriptionCount,
        isConnected: response.isConnected,
      }));
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to setup reactive subscription';
      setError(message);
      setStatus(prev => ({
        ...prev,
        isConnected: false,
        lastError: message,
      }));
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getReactiveStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await api<ReactiveStatus>('/api/plugins/set-forget/reactive/status');
      setStatus(response);
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch reactive status';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const subscribeToEvents = useCallback(async (subAccountAddress: string, callbackUrl: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await api('/api/plugins/set-forget/reactive/subscription', {
      method: 'POST',
      body: JSON.stringify({ subAccountAddress, callbackUrl }),
    });
      setStatus(prev => ({
        ...prev,
        subscriptionCount: prev.subscriptionCount + 1,
        isConnected: true,
      }));
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to subscribe to events';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

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
    setupSubscription,
    getReactiveStatus,
    subscribeToEvents,
    refreshStatus,
  };
};