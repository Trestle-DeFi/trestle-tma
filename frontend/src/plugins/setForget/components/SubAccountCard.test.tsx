import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SubAccountCard from "./SubAccountCard";
import { SubAccount } from "../hooks/useSubAccount";

const mockAccount: SubAccount = {
  address: "0x1234567890abcdef1234567890abcdef12345678",
  mainVault: "0xabcdefghijklmnop1234567890abcdef",
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

const mockOnUpdate = vi.fn();
const mockOnDelete = vi.fn();

describe("SubAccountCard", () => {
  it("renders active account with green status dot and Pause button", () => {
    render(
      <SubAccountCard
        account={mockAccount}
        onUpdate={mockOnUpdate}
        onDelete={mockOnDelete}
      />,
    );

    expect(screen.getByText(/0x1234\.\.\.5678/)).toBeInTheDocument();
    expect(screen.getByText("Pause")).toBeInTheDocument();
    expect(screen.getByText("0.010 ETH")).toBeInTheDocument();
    // Active state shows green dot
    const dot = screen.getByTestId("status-dot");
    expect(dot).toBeInTheDocument();
  });

  it("renders inactive account with red dot and Inactive badge", () => {
    const inactiveAccount: SubAccount = { ...mockAccount, isActive: false };
    render(
      <SubAccountCard
        account={inactiveAccount}
        onUpdate={mockOnUpdate}
        onDelete={mockOnDelete}
      />,
    );

    expect(screen.getByText("0x1234...5678")).toBeInTheDocument();
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.getByText("Resume")).toBeInTheDocument();
  });

  it("shows formatted balance values", () => {
    render(
      <SubAccountCard
        account={{
          ...mockAccount,
          threshold: "0.003",
          target: "0.125",
        }}
        onUpdate={mockOnUpdate}
        onDelete={mockOnDelete}
      />,
    );

    // toFixed(3): "0.003" stays as "0.003"
    expect(screen.getByText("0.003 ETH")).toBeInTheDocument();
    // toFixed(3): "0.125"
    expect(screen.getByText("0.125 ETH")).toBeInTheDocument();
  });

  it("calls onUpdate with paused state when Pause is clicked", async () => {
    const user = userEvent.setup();
    render(
      <SubAccountCard
        account={mockAccount}
        onUpdate={mockOnUpdate}
        onDelete={mockOnDelete}
      />,
    );

    await user.click(screen.getByText("Pause"));
    expect(mockOnUpdate).toHaveBeenCalledWith(
      mockAccount.address,
      { isActive: false },
    );
  });

  it("calls onUpdate with resumed state when Resume is clicked", async () => {
    const user = userEvent.setup();
    const inactiveAccount: SubAccount = { ...mockAccount, isActive: false };

    render(
      <SubAccountCard
        account={inactiveAccount}
        onUpdate={mockOnUpdate}
        onDelete={mockOnDelete}
      />,
    );

    await user.click(screen.getByText("Resume"));
    expect(mockOnUpdate).toHaveBeenCalledWith(
      inactiveAccount.address,
      { isActive: true },
    );
  });

  it("calls onDelete when Delete is clicked", async () => {
    const user = userEvent.setup();
    render(
      <SubAccountCard
        account={mockAccount}
        onUpdate={mockOnUpdate}
        onDelete={mockOnDelete}
      />,
    );

    await user.click(screen.getByText("Delete"));
    expect(mockOnDelete).toHaveBeenCalledWith(mockAccount.address);
  });

  it("displays all config fields", () => {
    render(
      <SubAccountCard
        account={{
          ...mockAccount,
          mainVault: "0x87654321fedcba9876543210fedcba9876543210",
          threshold: "0.05",
          target: "0.10",
        }}
        onUpdate={mockOnUpdate}
        onDelete={mockOnDelete}
      />,
    );

    expect(screen.getByText("Main Vault")).toBeInTheDocument();
    expect(screen.getByText("Threshold")).toBeInTheDocument();
    expect(screen.getByText("Target")).toBeInTheDocument();
    expect(screen.getByText("Cooldown")).toBeInTheDocument();
    expect(screen.getByText("Max Daily")).toBeInTheDocument();
    expect(screen.getByText("Spent Today")).toBeInTheDocument();
  });
});
