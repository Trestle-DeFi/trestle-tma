import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { formatEther } from "viem";
import { ConfigurationPanel } from "./ConfigurationPanel";
import { SET_FORGET_CONTRACTS } from "../../config/contracts";

const mockPluginApi = vi.fn();
const mockAccountState: { address?: string } = { address: undefined };

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: mockAccountState.address }),
}));

vi.mock("../../lib/plugin", () => ({
  pluginApi: (path: string, opts?: RequestInit) => mockPluginApi(path, opts),
}));

// The panel writes the user's settings straight to the contracts, so the
// on-chain hook is mocked here. Every mock is a spy, which lets the tests
// assert that the configuration is written on-chain — not only in the
// worker's off-chain index.
const mockOnchain = {
  createSubAccount: vi.fn(),
  updateSubAccountConfig: vi.fn(),
  setDailyRequestLimit: vi.fn(),
  updateSelfSubscription: vi.fn(),
  subscribeSelf: vi.fn(),
  refresh: vi.fn(),
  formatEth: vi.fn((wei: bigint) => String(wei)),
};

vi.mock("../../plugins/setForget/hooks/useOnchain", () => ({
  useOnchain: () => mockOnchain,
}));

const WALLET = "0x1234567890abcdef1234567890abcdef12345678";
// The panel must always send the configured vault, so the expectation follows
// the deployed contract instead of a hard-coded address.
const MAIN_VAULT = SET_FORGET_CONTRACTS.mainVault.address;

const savedSubAccount = {
  address: WALLET,
  mainVault: MAIN_VAULT,
  threshold: "0.5",
  target: "0.75",
  cooldown: 900,
  maxDaily: 25,
  isActive: true,
  createdAt: 1000000,
  sequence: 1,
  totalSpentToday: 0,
  updatedAt: 1000000,
};

// The toggle buttons are rendered as a label + sibling button inside a flex row.
const toggleFor = (label: string): HTMLButtonElement => {
  const row = screen.getByText(label).closest("div.flex");
  if (!row) throw new Error(`No toggle row found for "${label}"`);
  const button = row.querySelector("button");
  if (!button) throw new Error(`No toggle button found for "${label}"`);
  return button as HTMLButtonElement;
};

const thresholdInput = () => screen.getByPlaceholderText("0.01") as HTMLInputElement;
const targetInput = () => screen.getByPlaceholderText("0.05") as HTMLInputElement;
const numberInputs = () => screen.getAllByRole("spinbutton") as HTMLInputElement[];

beforeEach(() => {
  mockPluginApi.mockReset();
  mockAccountState.address = undefined;
  localStorage.clear();
  Object.values(mockOnchain).forEach((fn) => {
    if (typeof fn === "function" && "mockReset" in fn) (fn as any).mockReset();
  });
  // Default: the user has no on-chain sub-account and no guard subscription.
  mockOnchain.refresh.mockResolvedValue({
    reserveBalance: 0n,
    virtualBalance: 0n,
    dailyLimit: 0,
    hasSubAccount: false,
    subAccountActive: false,
    threshold: 0n,
    target: 0n,
    cooldown: 0,
    maxDaily: 0,
    subscriptionActive: false,
    hasSubscription: false,
  });
  mockOnchain.createSubAccount.mockResolvedValue("0xcreate");
  mockOnchain.updateSubAccountConfig.mockResolvedValue("0xupdate");
  mockOnchain.setDailyRequestLimit.mockResolvedValue("0xcap");
  mockOnchain.updateSelfSubscription.mockResolvedValue("0xsub");
  mockOnchain.subscribeSelf.mockResolvedValue("0xsubscribe");
  mockOnchain.formatEth.mockImplementation((wei: bigint) => formatEther(wei));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Flush the mount-time async configuration load so all React state updates are
// applied before assertions run (and no act() warnings are emitted).
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe("ConfigurationPanel", () => {
  it("renders the form with the default configuration", async () => {
    mockAccountState.address = WALLET;
    mockPluginApi.mockResolvedValue([]);

    render(<ConfigurationPanel />);

    await flush();

    expect(screen.getByText("Core Configuration")).toBeInTheDocument();
    expect(screen.getByText("Advanced Settings")).toBeInTheDocument();
    expect(thresholdInput()).toHaveValue("0.01");
    expect(targetInput()).toHaveValue("0.05");
    const [cooldown, maxDaily] = numberInputs();
    expect(cooldown).toHaveValue(300);
    expect(maxDaily).toHaveValue(10);
    expect(screen.getByRole("combobox")).toHaveValue("medium");
  });

  it("loads the stored sub-account configuration into the form", async () => {
    mockAccountState.address = WALLET;
    mockPluginApi.mockResolvedValue([savedSubAccount]);

    render(<ConfigurationPanel />);

    await flush();

    await waitFor(() => {
      expect(thresholdInput()).toHaveValue("0.5");
    });
    expect(targetInput()).toHaveValue("0.75");
    const [cooldown, maxDaily] = numberInputs();
    expect(cooldown).toHaveValue(900);
    expect(maxDaily).toHaveValue(25);
  });

  it("loads the stored user preferences into the form", async () => {
    mockAccountState.address = WALLET;
    mockPluginApi.mockResolvedValue([]);
    localStorage.setItem(
      `user-config-${WALLET}`,
      JSON.stringify({
        autoTopupEnabled: false,
        notificationsEnabled: false,
        riskLevel: "high",
        gasOptimization: false,
        lastUpdated: 1700000000000,
      }),
    );

    render(<ConfigurationPanel />);

    await flush();

    await waitFor(() => {
      expect(screen.getByRole("combobox")).toHaveValue("high");
    });
    // The disabled toggles use the gray track, the enabled ones the emerald track.
    expect(toggleFor("Auto-Topup Enabled").className).toContain("bg-gray-200");
    expect(toggleFor("Notifications Enabled").className).toContain("bg-gray-200");
    expect(toggleFor("Gas Optimization").className).toContain("bg-gray-200");
  });

  it("disables saving when no wallet is connected", async () => {
    mockPluginApi.mockResolvedValue([]);

    render(<ConfigurationPanel />);

    await flush();

    expect(screen.getByText("Save Configuration")).toBeDisabled();
    expect(screen.queryByText(/Configured for:/)).not.toBeInTheDocument();
  });


  it("creates the sub-account and persists the preferences on save", async () => {
    const user = userEvent.setup();
    const onConfigurationChange = vi.fn();
    mockAccountState.address = WALLET;
    mockPluginApi.mockImplementation((path: string, opts?: RequestInit) => {
      if (opts?.method === "POST") return Promise.resolve(savedSubAccount);
      return Promise.resolve([]);
    });

    render(<ConfigurationPanel onConfigurationChange={onConfigurationChange} />);

    await flush();

    await user.click(screen.getByText("Save Configuration"));

    await waitFor(() => {
      expect(screen.getByText("Configuration saved successfully")).toBeInTheDocument();
    });

    expect(mockPluginApi).toHaveBeenCalledWith("/api/plugins/set-forget/subaccounts", {
      method: "POST",
      body: JSON.stringify({
        address: WALLET,
        mainVault: MAIN_VAULT,
        threshold: "0.01",
        target: "0.05",
        cooldown: 300,
        maxDaily: 10,
      }),
    });

    const stored = JSON.parse(localStorage.getItem(`user-config-${WALLET}`) ?? "{}");
    expect(stored.autoTopupEnabled).toBe(true);
    expect(stored.notificationsEnabled).toBe(true);
    expect(stored.riskLevel).toBe("medium");
    expect(stored.gasOptimization).toBe(true);
    expect(onConfigurationChange).toHaveBeenCalledWith(stored);
  });

  it("falls back to updating the sub-account when creation fails", async () => {
    const user = userEvent.setup();
    mockAccountState.address = WALLET;
    mockPluginApi.mockImplementation((path: string, opts?: RequestInit) => {
      if (opts?.method === "POST") return Promise.reject(new Error("already exists"));
      if (opts?.method === "PUT") return Promise.resolve(savedSubAccount);
      return Promise.resolve([]);
    });

    render(<ConfigurationPanel />);

    await flush();

    await user.click(screen.getByText("Save Configuration"));

    await waitFor(() => {
      expect(screen.getByText("Configuration saved successfully")).toBeInTheDocument();
    });
    expect(mockPluginApi).toHaveBeenCalledWith(
      `/api/plugins/set-forget/subaccounts/${WALLET}`,
      {
        method: "PUT",
        body: JSON.stringify({
          threshold: "0.01",
          target: "0.05",
          cooldown: 300,
          maxDaily: 10,
        }),
      },
    );
  });

  it("surfaces the error message when saving fails", async () => {
    const user = userEvent.setup();
    mockAccountState.address = WALLET;
    mockPluginApi.mockImplementation((path: string, opts?: RequestInit) => {
      if (opts?.method === "POST") return Promise.reject(new Error("boom"));
      if (opts?.method === "PUT") return Promise.reject(new Error("boom"));
      return Promise.resolve([]);
    });

    render(<ConfigurationPanel />);

    await flush();

    await user.click(screen.getByText("Save Configuration"));

    await waitFor(() => {
      expect(screen.getByText("boom")).toBeInTheDocument();
    });
    expect(screen.queryByText("Configuration saved successfully")).not.toBeInTheDocument();
  });

  it("resets every field back to its default", async () => {
    const user = userEvent.setup();
    mockAccountState.address = WALLET;
    mockPluginApi.mockResolvedValue([]);

    render(<ConfigurationPanel />);

    await flush();

    await user.clear(thresholdInput());
    await user.type(thresholdInput(), "0.42");
    await user.clear(targetInput());
    await user.type(targetInput(), "0.99");
    await user.selectOptions(screen.getByRole("combobox"), "low");
    await user.click(toggleFor("Auto-Topup Enabled"));

    expect(thresholdInput()).toHaveValue("0.42");
    expect(targetInput()).toHaveValue("0.99");
    expect(screen.getByRole("combobox")).toHaveValue("low");

    await user.click(screen.getByText("Reset to Defaults"));

    expect(thresholdInput()).toHaveValue("0.01");
    expect(targetInput()).toHaveValue("0.05");
    const [cooldown, maxDaily] = numberInputs();
    expect(cooldown).toHaveValue(300);
    expect(maxDaily).toHaveValue(10);
    expect(screen.getByRole("combobox")).toHaveValue("medium");
    expect(toggleFor("Auto-Topup Enabled").className).toContain("bg-emerald-500");
  });

  it("saves the edited configuration values", async () => {
    const user = userEvent.setup();
    mockAccountState.address = WALLET;
    mockPluginApi.mockImplementation((path: string, opts?: RequestInit) => {
      if (opts?.method === "POST") return Promise.resolve(savedSubAccount);
      return Promise.resolve([]);
    });

    render(<ConfigurationPanel />);

    await flush();

    await user.clear(thresholdInput());
    await user.type(thresholdInput(), "0.25");
    await user.clear(targetInput());
    await user.type(targetInput(), "0.5");
    await user.selectOptions(screen.getByRole("combobox"), "high");
    await user.click(toggleFor("Notifications Enabled"));

    await user.click(screen.getByText("Save Configuration"));

    await waitFor(() => {
      expect(screen.getByText("Configuration saved successfully")).toBeInTheDocument();
    });

    const body = mockPluginApi.mock.calls.find(
      (call) => call[1]?.method === "POST",
    )?.[1]?.body;
    expect(JSON.parse(String(body)).threshold).toBe("0.25");
    expect(JSON.parse(String(body)).address).toBe(WALLET);

    const stored = JSON.parse(localStorage.getItem(`user-config-${WALLET}`) ?? "{}");
    expect(stored.riskLevel).toBe("high");
    expect(stored.notificationsEnabled).toBe(false);
  });

  it("rejects a target that is not above the threshold", async () => {
    const user = userEvent.setup();
    mockAccountState.address = WALLET;
    mockPluginApi.mockResolvedValue([]);

    render(<ConfigurationPanel />);

    await flush();

    await user.clear(thresholdInput());
    await user.type(thresholdInput(), "0.25");

    await user.click(screen.getByText("Save Configuration"));

    await waitFor(() => {
      expect(screen.getByText("Target must be greater than threshold")).toBeInTheDocument();
    });
    expect(screen.queryByText("Configuration saved successfully")).not.toBeInTheDocument();
  });

  it("writes the settings on-chain for the user's own sub-account", async () => {
    const user = userEvent.setup();
    mockAccountState.address = WALLET;
    mockPluginApi.mockImplementation((path: string, opts?: RequestInit) => {
      if (opts?.method === "POST") return Promise.resolve(savedSubAccount);
      return Promise.resolve([]);
    });
    mockOnchain.refresh.mockResolvedValue({
      reserveBalance: 0n,
      virtualBalance: 0n,
      dailyLimit: 10,
      hasSubAccount: true,
      subAccountActive: true,
      threshold: 10000000000000000n,
      target: 50000000000000000n,
      cooldown: 300,
      maxDaily: 10,
      subscriptionActive: true,
      hasSubscription: true,
    });

    render(<ConfigurationPanel />);

    await flush();

    await user.click(screen.getByText("Save Configuration"));

    await waitFor(() => {
      expect(screen.getByText("Configuration saved successfully")).toBeInTheDocument();
    });

    // The registry holds the threshold/target that actually trigger a refill.
    expect(mockOnchain.updateSubAccountConfig).toHaveBeenCalledWith({
      threshold: "0.01",
      target: "0.05",
      cooldown: 300,
      maxDaily: 10,
    });
    // The vault-side cap and the guard subscription are the user's own too.
    expect(mockOnchain.setDailyRequestLimit).toHaveBeenCalledWith(10);
    expect(mockOnchain.updateSelfSubscription).toHaveBeenCalledWith({
      maxDaily: 10,
      cooldown: 300,
      isActive: true,
    });
    // No on-chain sub-account is created when one already exists.
    expect(mockOnchain.createSubAccount).not.toHaveBeenCalled();
  });

  it("creates the on-chain sub-account and subscription when the user has none", async () => {
    const user = userEvent.setup();
    mockAccountState.address = WALLET;
    mockPluginApi.mockImplementation((path: string, opts?: RequestInit) => {
      if (opts?.method === "POST") return Promise.resolve(savedSubAccount);
      return Promise.resolve([]);
    });
    // The registry rejects an update for a sub-account that does not exist
    // yet, so the panel creates it instead.
    mockOnchain.updateSubAccountConfig.mockRejectedValue(
      new Error("Sub-account not active"),
    );

    render(<ConfigurationPanel />);

    await flush();

    await user.click(screen.getByText("Save Configuration"));

    await waitFor(() => {
      expect(screen.getByText("Configuration saved successfully")).toBeInTheDocument();
    });

    expect(mockOnchain.createSubAccount).toHaveBeenCalledWith({
      threshold: "0.01",
      target: "0.05",
      cooldown: 300,
      maxDaily: 10,
    });
    expect(mockOnchain.subscribeSelf).toHaveBeenCalledWith({ maxDaily: 10, cooldown: 300 });
    expect(mockOnchain.updateSelfSubscription).not.toHaveBeenCalled();
  });

  it("still writes on-chain when the chain read fails", async () => {
    const user = userEvent.setup();
    mockAccountState.address = WALLET;
    mockPluginApi.mockImplementation((path: string, opts?: RequestInit) => {
      if (opts?.method === "POST") return Promise.resolve(savedSubAccount);
      return Promise.resolve([]);
    });
    mockOnchain.refresh.mockRejectedValue(new Error("RPC timeout"));

    render(<ConfigurationPanel />);

    await flush();

    await user.click(screen.getByText("Save Configuration"));

    await waitFor(() => {
      expect(screen.getByText("Configuration saved successfully")).toBeInTheDocument();
    });

    // The write still happened even though the read did not.
    expect(mockOnchain.updateSubAccountConfig).toHaveBeenCalled();
    expect(mockOnchain.setDailyRequestLimit).toHaveBeenCalledWith(10);
  });

  it("keeps a paused subscription paused when the settings are saved", async () => {
    const user = userEvent.setup();
    mockAccountState.address = WALLET;
    mockPluginApi.mockImplementation((path: string, opts?: RequestInit) => {
      if (opts?.method === "POST") return Promise.resolve(savedSubAccount);
      return Promise.resolve([]);
    });
    mockOnchain.refresh.mockResolvedValue({
      reserveBalance: 0n,
      virtualBalance: 0n,
      dailyLimit: 10,
      hasSubAccount: true,
      subAccountActive: true,
      threshold: 10000000000000000n,
      target: 50000000000000000n,
      cooldown: 300,
      maxDaily: 10,
      subscriptionActive: false,
      hasSubscription: true,
    });

    render(<ConfigurationPanel />);

    await flush();

    await user.click(screen.getByText("Save Configuration"));

    await waitFor(() => {
      expect(screen.getByText("Configuration saved successfully")).toBeInTheDocument();
    });

    expect(mockOnchain.updateSelfSubscription).toHaveBeenCalledWith({
      maxDaily: 10,
      cooldown: 300,
      isActive: false,
    });
  });

  it("treats an unchanged guard subscription as a no-op", async () => {
    const user = userEvent.setup();
    mockAccountState.address = WALLET;
    mockPluginApi.mockImplementation((path: string, opts?: RequestInit) => {
      if (opts?.method === "POST") return Promise.resolve(savedSubAccount);
      return Promise.resolve([]);
    });
    mockOnchain.refresh.mockResolvedValue({
      reserveBalance: 0n,
      virtualBalance: 0n,
      dailyLimit: 10,
      hasSubAccount: true,
      subAccountActive: true,
      threshold: 10000000000000000n,
      target: 50000000000000000n,
      cooldown: 300,
      maxDaily: 10,
      subscriptionActive: true,
      hasSubscription: true,
    });
    mockOnchain.updateSelfSubscription.mockRejectedValue(
      new Error("No change needed"),
    );

    render(<ConfigurationPanel />);

    await flush();

    await user.click(screen.getByText("Save Configuration"));

    await waitFor(() => {
      expect(screen.getByText("Configuration saved successfully")).toBeInTheDocument();
    });
  });

  it("validates against the limits the deployed contracts enforce", async () => {
    const user = userEvent.setup();
    mockAccountState.address = WALLET;
    mockPluginApi.mockResolvedValue([]);
    // The guard caps the daily refills at 5 on this deployment. The form must
    // read that from the chain instead of using a hard-coded number.
    mockOnchain.refresh.mockResolvedValue({
      reserveBalance: 0n,
      virtualBalance: 0n,
      dailyLimit: 5,
      hasSubAccount: true,
      subAccountActive: true,
      threshold: 10000000000000000n,
      target: 50000000000000000n,
      cooldown: 300,
      maxDaily: 5,
      subscriptionActive: true,
      hasSubscription: true,
      limits: {
        minThresholdWei: 1000000000000000n,
        minCooldownSeconds: 300,
        registryMaxDaily: 1000,
        guardMaxDaily: 5,
        vaultMaxDaily: 100,
      },
    });

    render(<ConfigurationPanel />);

    await flush();

    await waitFor(() => {
      const [, maxDailyInput] = numberInputs();
      expect(maxDailyInput).toHaveAttribute("max", "5");
    });

    // A value above the guard's cap is rejected before any transaction.
    await user.clear(numberInputs()[1]);
    await user.type(numberInputs()[1], "10");
    await user.click(screen.getByText("Save Configuration"));

    await waitFor(() => {
      expect(
        screen.getByText("Max daily limit must be between 1 and 5"),
      ).toBeInTheDocument();
    });
    expect(mockOnchain.updateSubAccountConfig).not.toHaveBeenCalled();
  });

  it("surfaces an on-chain failure without claiming success", async () => {
    const user = userEvent.setup();
    mockAccountState.address = WALLET;
    mockPluginApi.mockResolvedValue([]);
    mockOnchain.refresh.mockResolvedValue({
      reserveBalance: 0n,
      virtualBalance: 0n,
      dailyLimit: 10,
      hasSubAccount: true,
      subAccountActive: true,
      threshold: 10000000000000000n,
      target: 50000000000000000n,
      cooldown: 300,
      maxDaily: 10,
      subscriptionActive: true,
      hasSubscription: true,
    });
    mockOnchain.updateSubAccountConfig.mockRejectedValue(
      new Error("Threshold too low"),
    );

    render(<ConfigurationPanel />);

    await flush();

    await user.click(screen.getByText("Save Configuration"));

    await waitFor(() => {
      expect(screen.getByText("Threshold too low")).toBeInTheDocument();
    });
    expect(screen.queryByText("Configuration saved successfully")).not.toBeInTheDocument();
  });
});
