import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfigurationManager } from "./ConfigurationManager";

const mockPluginApi = vi.fn();
const mockAccountState: { address?: string } = { address: undefined };

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: mockAccountState.address }),
}));

vi.mock("../../lib/plugin", () => ({
  pluginApi: (path: string, opts?: RequestInit) => mockPluginApi(path, opts),
}));

// The panel is exercised by its own test file — here we only need a stub that
// can report a preference change back to the manager.
vi.mock("./ConfigurationPanel", () => ({
  ConfigurationPanel: (props: { onConfigurationChange?: (c: unknown) => void }) => (
    <button
      type="button"
      data-testid="configuration-panel"
      onClick={() => props.onConfigurationChange?.({ autoTopupEnabled: false, riskLevel: "high" })}
    >
      configuration-panel
    </button>
  ),
}));

const WALLET = "0x1234567890abcdef1234567890abcdef12345678";
const OTHER_WALLET = "0x9999999999999999999999999999999999999999";
const MAIN_VAULT = "0xd8FD13A95e54640206167d31bb39eF5FfF5dF231";

const sampleSubAccount = {
  address: WALLET,
  mainVault: MAIN_VAULT,
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

beforeEach(() => {
  mockPluginApi.mockReset();
  mockAccountState.address = undefined;
  localStorage.clear();
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

describe("ConfigurationManager", () => {
  it("shows the disconnected state and loads nothing without a wallet", async () => {
    render(<ConfigurationManager />);
    await flush();

    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.queryByText("Your Sub-Account Configurations")).not.toBeInTheDocument();
    expect(mockPluginApi).not.toHaveBeenCalled();
  });

  it("loads the connected wallet's sub-accounts and filters out other owners", async () => {
    mockAccountState.address = WALLET;
    mockPluginApi.mockResolvedValue([
      sampleSubAccount,
      { ...sampleSubAccount, address: OTHER_WALLET },
    ]);

    render(<ConfigurationManager />);

    await flush();

    await waitFor(() => {
      expect(mockPluginApi).toHaveBeenCalledWith("/api/plugins/set-forget/subaccounts", undefined);
    });

    await waitFor(() => {
      expect(screen.getByText("0x1234...5678")).toBeInTheDocument();
    });
    // The other wallet's account must not be rendered.
    expect(screen.queryByText("0x9999...9999")).not.toBeInTheDocument();
  });

  it("shows the connected address in the header", async () => {
    mockAccountState.address = WALLET;
    mockPluginApi.mockResolvedValue([]);

    render(<ConfigurationManager />);

    await flush();

    expect(screen.getByText(`Connected: ${WALLET.slice(0, 6)}...${WALLET.slice(-4)}`)).toBeInTheDocument();
  });

  it("renders the empty state when the wallet owns no sub-accounts", async () => {
    mockAccountState.address = WALLET;
    mockPluginApi.mockResolvedValue([]);

    render(<ConfigurationManager />);

    await flush();

    await waitFor(() => {
      expect(screen.getByText("No sub-account configurations found.")).toBeInTheDocument();
    });
  });

  it("falls back to default preferences when nothing is stored", async () => {
    mockAccountState.address = WALLET;
    mockPluginApi.mockResolvedValue([]);

    render(<ConfigurationManager />);

    await flush();

    await waitFor(() => {
      expect(screen.getByText("Current User Preferences")).toBeInTheDocument();
    });
    expect(screen.getByText("Auto-Topup")).toBeInTheDocument();
    expect(screen.getByText("Notifications")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getByText("Gas Optimization")).toBeInTheDocument();
  });

  it("restores preferences persisted in localStorage", async () => {
    mockAccountState.address = WALLET;
    mockPluginApi.mockResolvedValue([]);
    localStorage.setItem(
      `user-config-${WALLET}`,
      JSON.stringify({
        autoTopupEnabled: false,
        notificationsEnabled: true,
        riskLevel: "high",
        gasOptimization: false,
        lastUpdated: 1700000000000,
      }),
    );

    render(<ConfigurationManager />);

    await flush();

    await waitFor(() => {
      expect(screen.getByText("High")).toBeInTheDocument();
    });
    // Auto-topup and gas optimisation are both disabled in the stored prefs.
    expect(screen.getAllByText("Disabled")).toHaveLength(2);
  });

  it("persists preference changes reported by the configuration panel", async () => {
    const user = userEvent.setup();
    mockAccountState.address = WALLET;
    mockPluginApi.mockResolvedValue([]);

    render(<ConfigurationManager />);

    await flush();

    await waitFor(() => {
      expect(screen.getByTestId("configuration-panel")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("configuration-panel"));

    const stored = JSON.parse(localStorage.getItem(`user-config-${WALLET}`) ?? "{}");
    expect(stored.autoTopupEnabled).toBe(false);
    expect(stored.riskLevel).toBe("high");
    expect(typeof stored.lastUpdated).toBe("number");
  });

  it("does not persist preference changes when no wallet is connected", async () => {
    const user = userEvent.setup();
    mockPluginApi.mockResolvedValue([]);

    render(<ConfigurationManager />);

    await flush();

    await user.click(screen.getByTestId("configuration-panel"));

    expect(localStorage.getItem("user-config-undefined")).toBeNull();
    expect(Object.keys(localStorage)).toHaveLength(0);
  });

  it("switches between the core, advanced and history tabs", async () => {
    const user = userEvent.setup();
    mockAccountState.address = WALLET;
    mockPluginApi.mockResolvedValue([]);

    render(<ConfigurationManager />);

    await flush();

    expect(screen.getByTestId("configuration-panel")).toBeInTheDocument();

    await user.click(screen.getByText("Advanced Settings"));
    expect(screen.getByRole("heading", { name: "Advanced Configuration Options" })).toBeInTheDocument();
    expect(screen.queryByTestId("configuration-panel")).not.toBeInTheDocument();

    await user.click(screen.getByText("Configuration History"));
    expect(
      screen.getByRole("heading", { name: "Configuration History" }),
    ).toBeInTheDocument();

    await user.click(screen.getByText("Core Settings"));
    expect(screen.getByTestId("configuration-panel")).toBeInTheDocument();
  });

  it("reveals the advanced options when Configure is pressed", async () => {
    const user = userEvent.setup();
    mockAccountState.address = WALLET;
    mockPluginApi.mockResolvedValue([]);

    render(<ConfigurationManager />);

    await flush();

    await user.click(screen.getByText("Advanced Settings"));
    expect(screen.queryByText(/Custom refill strategies/)).not.toBeInTheDocument();

    await user.click(screen.getByText("Configure"));
    expect(screen.getByText(/Custom refill strategies/)).toBeInTheDocument();
    expect(screen.getByText("Hide")).toBeInTheDocument();
  });

  it("removes a sub-account from the list after it is deleted", async () => {
    const user = userEvent.setup();
    mockAccountState.address = WALLET;
    mockPluginApi.mockImplementation((path: string, opts?: RequestInit) => {
      if (opts?.method === "DELETE") return Promise.resolve({ success: true });
      return Promise.resolve([sampleSubAccount]);
    });

    render(<ConfigurationManager />);

    await flush();

    await waitFor(() => {
      expect(screen.getByText("0x1234...5678")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Delete"));

    await waitFor(() => {
      expect(screen.queryByText("0x1234...5678")).not.toBeInTheDocument();
    });
    expect(mockPluginApi).toHaveBeenCalledWith(
      `/api/plugins/set-forget/subaccounts/${WALLET}`,
      { method: "DELETE" },
    );
  });
});
