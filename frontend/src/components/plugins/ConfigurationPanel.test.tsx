import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfigurationPanel } from "./ConfigurationPanel";

const mockPluginApi = vi.fn();
const mockAccountState: { address?: string } = { address: undefined };

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: mockAccountState.address }),
}));

vi.mock("../../lib/plugin", () => ({
  pluginApi: (path: string, opts?: RequestInit) => mockPluginApi(path, opts),
}));

const WALLET = "0x1234567890abcdef1234567890abcdef12345678";
const MAIN_VAULT = "0xd05d1626f7FB992F0B9862EeE29F4Ca688688Be7";

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
});
