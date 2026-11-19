import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useReactive, ReactiveStatus } from "./useReactive";

const mockPluginApi = vi.fn();

vi.mock("../../../lib/plugin", () => ({
  pluginApi: (path: string, opts?: RequestInit) => mockPluginApi(path, opts),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  mockPluginApi.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const sampleStatus: ReactiveStatus = {
  subscriptionCount: 2,
  pendingCount: 0,
  lastTrigger: "2024-01-01T00:00:00Z",
  isConnected: true,
  guardAddress: "0xguard",
  onChainSubscriptionCount: 2,
  subscriptions: [
    { id: 1, subAccountAddress: "0xabc", lasnaTopic: "topic1", callbackUrl: "http://cb", isActive: true, createdAt: 1000 },
  ],
};

describe("useReactive — getReactiveStatus / setupSubscription", () => {
  it("fetches and applies status from the worker", async () => {
    mockPluginApi.mockResolvedValue(sampleStatus);
    const { result } = renderHook(() => useReactive());

    await act(async () => {
      await result.current.getReactiveStatus();
    });

    expect(result.current.status.subscriptionCount).toBe(2);
    expect(result.current.status.isConnected).toBe(true);
    expect(result.current.status.guardAddress).toBe("0xguard");
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(mockPluginApi).toHaveBeenCalledWith("/api/plugins/set-forget/reactive/status", undefined);
  });

  it("setupSubscription is an alias for getReactiveStatus", async () => {
    mockPluginApi.mockResolvedValue(sampleStatus);
    const { result } = renderHook(() => useReactive());

    await act(async () => {
      await result.current.setupSubscription();
    });

    expect(result.current.status.subscriptionCount).toBe(2);
    expect(result.current.isLoading).toBe(false);
  });

  it("handles missing / optional fields gracefully", async () => {
    mockPluginApi.mockResolvedValue({ subscriptionCount: 5 });
    const { result } = renderHook(() => useReactive());

    await act(async () => {
      await result.current.getReactiveStatus();
    });

    expect(result.current.status.subscriptionCount).toBe(5);
    expect(result.current.status.pendingCount).toBe(0);
    expect(result.current.status.isConnected).toBe(false);
    expect(result.current.status.subscriptions).toEqual([]);
  });

  it("records error and sets isConnected false on failure", async () => {
    mockPluginApi.mockRejectedValue(new Error("Worker offline"));
    const { result } = renderHook(() => useReactive());

    await act(async () => {
      await result.current.getReactiveStatus().catch(() => {});
    });

    expect(result.current.error).toBe("Worker offline");
    expect(result.current.status.isConnected).toBe(false);
    expect(result.current.status.lastError).toBe("Worker offline");
    expect(result.current.isLoading).toBe(false);
  });
});
describe('useReactive — subscribeToEvents', () => {
  it('POSTs subscription and re-fetches status', async () => {
    mockPluginApi
      .mockResolvedValueOnce({ subscriptionId: 42 })
      .mockResolvedValueOnce({ ...sampleStatus, subscriptionCount: 3 });

    const { result } = renderHook(() => useReactive());

    await act(async () => {
      await result.current.subscribeToEvents('0xsub', 'https://callback');
    });

    expect(mockPluginApi).toHaveBeenCalledTimes(2);
    expect(mockPluginApi).toHaveBeenNthCalledWith(
      1,
      '/api/plugins/set-forget/reactive/subscription',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ subAccountAddress: '0xsub', callbackUrl: 'https://callback' }),
      }),
    );
    expect(mockPluginApi).toHaveBeenNthCalledWith(2, '/api/plugins/set-forget/reactive/status', undefined);
    expect(result.current.status.subscriptionCount).toBe(3);
  });

  it('throws and sets error on subscription failure', async () => {
    mockPluginApi.mockRejectedValue(new Error('subscription failed'));

    const { result } = renderHook(() => useReactive());

    await act(async () => {
      await result.current.subscribeToEvents('0xsub', 'https://callback').catch(() => {});
    });

    expect(result.current.error).toBe('subscription failed');
    expect(result.current.isLoading).toBe(false);
  });
});

describe('useReactive — refreshStatus', () => {
  it('silently refreshes status without throwing', async () => {
    mockPluginApi.mockResolvedValue(sampleStatus);

    const { result } = renderHook(() => useReactive());

    await act(async () => {
      await result.current.refreshStatus();
    });

    expect(result.current.status.subscriptionCount).toBe(2);
    expect(result.current.error).toBeNull();
  });

  it('swallows errors silently (console.error only)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockPluginApi.mockRejectedValue(new Error('refresh failed'));

    const { result } = renderHook(() => useReactive());

    await act(async () => {
      await result.current.refreshStatus();
    });

    expect(result.current.error).toBe("refresh failed");
    expect(spy).toHaveBeenCalledWith('Failed to refresh reactive status:', expect.any(Error));
    spy.mockRestore();
  });
});

describe('useReactive — auto-refresh interval', () => {
  it('calls refreshStatus every 30 seconds', async () => {
    mockPluginApi.mockResolvedValue(sampleStatus);

    const { result } = renderHook(() => useReactive());

    await act(async () => {
      await result.current.getReactiveStatus();
    });

    expect(mockPluginApi).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(30000);
    });

    expect(mockPluginApi).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(30000);
    });

    expect(mockPluginApi).toHaveBeenCalledTimes(3);
  });

  it('cleans up interval on unmount', async () => {
    mockPluginApi.mockResolvedValue(sampleStatus);

    const { result, unmount } = renderHook(() => useReactive());

    await act(async () => {
      await result.current.getReactiveStatus();
    });

    unmount();

    await act(async () => {
      vi.advanceTimersByTime(60000);
      await vi.runAllTimersAsync();
    });

    expect(mockPluginApi).toHaveBeenCalledTimes(1);
  });
});

describe('useReactive — applyStatus merges', () => {
  it('coerces string numbers and defaults missing fields', async () => {
    mockPluginApi.mockResolvedValue({ subscriptionCount: '7' });

    const { result } = renderHook(() => useReactive());

    await act(async () => {
      await result.current.getReactiveStatus();
    });

    expect(result.current.status.subscriptionCount).toBe(7);
    expect(result.current.status.pendingCount).toBe(0);
    expect(result.current.status.isConnected).toBe(false);
  });
});
