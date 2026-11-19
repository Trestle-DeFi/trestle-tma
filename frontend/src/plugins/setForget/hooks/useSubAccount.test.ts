import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSubAccount, SubAccount } from "./useSubAccount";

const mockPluginApi = vi.fn();

vi.mock("../../../lib/plugin", () => ({
  pluginApi: (path: string, opts?: RequestInit) => mockPluginApi(path, opts),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  mockPluginApi.mockReset();
});

const sampleSubAccount: SubAccount = {
  address: "0x1234567890abcdef1234567890abcdef12345678",
  mainVault: "0xabcdef1234567890abcdef1234567890abcdef12",
  threshold: "0.01",
  target: "0.05",
  cooldown: 300,
  maxDaily: 10,
  isActive: true,
  createdAt: 1000000,
  sequence: 1,
  totalSpentToday: 0,
  updatedAt: 1000000,
};

describe("useSubAccount — fetchSubAccounts", () => {
  it("normalises an array response", async () => {
    mockPluginApi.mockResolvedValue([sampleSubAccount]);
    const { result } = renderHook(() => useSubAccount());

    let data: SubAccount[] = [];
    await act(async () => {
      data = await result.current.fetchSubAccounts();
    });

    expect(data).toHaveLength(1);
    expect(data[0].address).toBe(sampleSubAccount.address);
    expect(data[0].threshold).toBe("0.01");
    expect(result.current.subAccounts).toHaveLength(1);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockPluginApi).toHaveBeenCalledWith(
      "/api/plugins/set-forget/subaccounts",
      undefined,
    );
  });

  it("normalises { subaccounts: [...] } wrapper", async () => {
    mockPluginApi.mockResolvedValue({ subaccounts: [sampleSubAccount] });
    const { result } = renderHook(() => useSubAccount());

    await act(async () => {
      await result.current.fetchSubAccounts();
    });

    expect(result.current.subAccounts).toHaveLength(1);
  });

  it("treats non-array payloads as empty", async () => {
    mockPluginApi.mockResolvedValue(null);
    const { result } = renderHook(() => useSubAccount());

    let data: SubAccount[] = [];
    await act(async () => {
      data = await result.current.fetchSubAccounts();
    });

    expect(data).toEqual([]);
    expect(result.current.subAccounts).toEqual([]);
  });

  it("maps snake_case worker rows to camelCase", async () => {
    mockPluginApi.mockResolvedValue([
      {
        address: sampleSubAccount.address,
        main_vault_ref: "0xvault",
        threshold: "0.02",
        target: "0.08",
        cooldown: 600,
        max_daily: 5,
        is_active: true,
        created_at: 123,
        sequence: 2,
        total_spent_today: 1,
        updated_at: 456,
      },
    ]);
    const { result } = renderHook(() => useSubAccount());

    await act(async () => {
      await result.current.fetchSubAccounts();
    });

    const row = result.current.subAccounts[0];
    expect(row.mainVault).toBe("0xvault");
    expect(row.maxDaily).toBe(5);
    expect(row.isActive).toBe(true);
    expect(row.createdAt).toBe(123);
    expect(row.updatedAt).toBe(456);
    expect(row.totalSpentToday).toBe(1);
  });

  it("records the error message and clears the list on failure", async () => {
    mockPluginApi.mockRejectedValue(new Error("Network error"));
    const { result } = renderHook(() => useSubAccount());

    await act(async () => {
      await result.current.fetchSubAccounts().catch(() => {});
    });

    expect(result.current.error).toBe("Network error");
    expect(result.current.subAccounts).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });
});
describe('useSubAccount — createSubAccount', () => {
  it('creates a sub-account and adds it to the list', async () => {
    const newData = {
      ...sampleSubAccount,
      address: '0x9876543210fedcba9876543210fedcba98765432',
    };
    mockPluginApi.mockResolvedValue(newData);

    const { result } = renderHook(() => useSubAccount());

    act(() => {
      result.current.subAccounts.push(sampleSubAccount as any);
    });

    const created = await act(async () => result.current.createSubAccount(newData));

    expect(created.address).toBe(newData.address);
    expect(result.current.subAccounts).toContainEqual(
      expect.objectContaining({ address: newData.address }),
    );
    expect(mockPluginApi).toHaveBeenCalledWith(
      '/api/plugins/set-forget/subaccounts',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(newData),
      }),
    );
  });

  it('throws and sets error on create failure', async () => {
    const errorMsg = 'address and mainVault are required';
    mockPluginApi.mockRejectedValue(new Error(errorMsg));

    const { result } = renderHook(() => useSubAccount());

    await act(async () => {
      await result.current
        .createSubAccount({ address: '', mainVault: '', threshold: '0.01', target: '0.05' })
        .catch(() => {});
    });

    expect(result.current.error).toBe(errorMsg);
    expect(result.current.subAccounts).toHaveLength(0);
  });
});

describe('useSubAccount — createSubAccountWithPerUserConfig', () => {
  it('sends per-user config with environment overrides enabled by default', async () => {
    mockPluginApi.mockResolvedValue({
      ...sampleSubAccount,
      address: '0x1234567890abcdef1234567890abcdef12345678',
    });

    const { result } = renderHook(() => useSubAccount());

    const configData = {
      mainVault: '0xabcdef1234567890abcdef1234567890abcdef12',
      threshold: '0.01',
      target: '0.05',
    };

    const created = await act(async () =>
      result.current.createSubAccountWithPerUserConfig('0x1234567890abcdef1234567890abcdef12345678', configData),
    );

    expect(created.address).toBe('0x1234567890abcdef1234567890abcdef12345678');
    const callBody = JSON.parse(mockPluginApi.mock.calls[0][1]?.body || '{}');
    expect(callBody.useEnvironmentOverrides).toBe(true);
    expect(callBody.walletAddress).toBe('0x1234567890abcdef1234567890abcdef12345678');
    expect(callBody.address).toBe('0x1234567890abcdef1234567890abcdef12345678');
  });

  it('honors explicit useEnvironmentOverrides false and custom walletAddress', async () => {
    mockPluginApi.mockResolvedValue(sampleSubAccount);

    const { result } = renderHook(() => useSubAccount());

    await act(async () =>
      result.current.createSubAccountWithPerUserConfig(
        '0x1234567890abcdef1234567890abcdef12345678',
        { mainVault: '0xabc', threshold: '0.01', target: '0.05' },
        { useEnvironmentOverrides: false, walletAddress: '0xcustom' },
      ),
    );

    const callBody = JSON.parse(mockPluginApi.mock.calls[0][1]?.body || '{}');
    expect(callBody.useEnvironmentOverrides).toBe(false);
    expect(callBody.walletAddress).toBe('0xcustom');
    expect(callBody.address).toBe('0x1234567890abcdef1234567890abcdef12345678');
  });

  it('throws and sets error on per-user config failure', async () => {
    const errorMsg = 'invalid per-user config';
    mockPluginApi.mockRejectedValue(new Error(errorMsg));

    const { result } = renderHook(() => useSubAccount());

    await act(async () => {
      await result.current
        .createSubAccountWithPerUserConfig('0xabc', { mainVault: '', threshold: '', target: '' })
        .catch(() => {});
    });

    expect(result.current.error).toBe(errorMsg);
  });
});

describe('useSubAccount — updateSubAccount', () => {
  it('updates an existing sub-account in the list', async () => {
    mockPluginApi.mockResolvedValue({ ...sampleSubAccount, maxDaily: 20 });

    const { result } = renderHook(() => useSubAccount());

    act(() => {
      result.current.subAccounts.push(sampleSubAccount as any);
    });

    const updated = await act(async () =>
      result.current.updateSubAccount(sampleSubAccount.address, { maxDaily: 20 }),
    );

    expect(updated.maxDaily).toBe(20);
    expect(result.current.subAccounts[0].maxDaily).toBe(20);
    expect(mockPluginApi).toHaveBeenCalledWith(
      `/api/plugins/set-forget/subaccounts/${sampleSubAccount.address}`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ maxDaily: 20 }),
      }),
    );
  });

  it('throws and sets error on update failure', async () => {
    const errorMsg = 'sub-account not found';
    mockPluginApi.mockRejectedValue(new Error(errorMsg));

    const { result } = renderHook(() => useSubAccount());

    await act(async () => {
      await result.current.updateSubAccount('0xmissing', { maxDaily: 5 }).catch(() => {});
    });

    expect(result.current.error).toBe(errorMsg);
  });
});

describe('useSubAccount — deleteSubAccount', () => {
  it('removes the sub-account from the list', async () => {
    mockPluginApi.mockResolvedValue({});

    const { result } = renderHook(() => useSubAccount());

    act(() => {
      result.current.subAccounts.push(sampleSubAccount as any);
    });

    await act(async () => result.current.deleteSubAccount(sampleSubAccount.address));

    expect(result.current.subAccounts).toHaveLength(0);
    expect(mockPluginApi).toHaveBeenCalledWith(
      `/api/plugins/set-forget/subaccounts/${sampleSubAccount.address}`,
      { method: 'DELETE' },
    );
  });

  it('throws and sets error on delete failure', async () => {
    const errorMsg = 'delete failed';
    mockPluginApi.mockRejectedValue(new Error(errorMsg));

    const { result } = renderHook(() => useSubAccount());

    await act(async () => {
      await result.current.deleteSubAccount('0xmissing').catch(() => {});
    });

    expect(result.current.error).toBe(errorMsg);
  });
});

describe('useSubAccount — getSubAccount', () => {
  it('fetches and returns a single sub-account', async () => {
    mockPluginApi.mockResolvedValue(sampleSubAccount);

    const { result } = renderHook(() => useSubAccount());

    const subAccount = await act(async () => result.current.getSubAccount(sampleSubAccount.address));

    expect(subAccount.address).toBe(sampleSubAccount.address);
    expect(subAccount.mainVault).toBe(sampleSubAccount.mainVault);
    expect(mockPluginApi).toHaveBeenCalledWith(
      `/api/plugins/set-forget/subaccounts/${sampleSubAccount.address}`,
      undefined,
    );
  });

  it('throws and sets error on get failure', async () => {
    const errorMsg = 'not found';
    mockPluginApi.mockRejectedValue(new Error(errorMsg));

    const { result } = renderHook(() => useSubAccount());

    await act(async () => {
      await result.current.getSubAccount('0xmissing').catch(() => {});
    });

    expect(result.current.error).toBe(errorMsg);
  });
});
