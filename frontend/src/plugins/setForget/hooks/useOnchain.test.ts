import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { ChainMismatchError, parseEther } from "viem";
import { useOnchain } from "./useOnchain";
import { SET_FORGET_CONTRACTS } from "../../../config/contracts";

const mockWriteContractAsync = vi.fn();
const mockSwitchChainAsync = vi.fn();
const mockAddress: { current?: string } = { current: undefined };

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: mockAddress.current }),
  usePublicClient: () => ({ readContract: vi.fn(), chain: { id: 1 } }),
  useSwitchChain: () => ({ switchChainAsync: mockSwitchChainAsync }),
  useWriteContract: () => ({ writeContractAsync: mockWriteContractAsync }),
}));

const USER = "0x1234567890abcdef1234567890abcdef12345678";

beforeEach(() => {
  mockWriteContractAsync.mockReset();
  mockSwitchChainAsync.mockReset();
  mockWriteContractAsync.mockResolvedValue("0xhash");
  mockAddress.current = USER;
});

describe("useOnchain — self-service on-chain configuration", () => {
  it("updates the caller's own threshold/target/cooldown/daily cap in the registry", async () => {
    const { result } = renderHook(() => useOnchain());

    await act(async () => {
      await result.current.updateSubAccountConfig({
        threshold: "0.01",
        target: "0.05",
        cooldown: 300,
        maxDaily: 10,
      });
    });

    expect(mockWriteContractAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        address: SET_FORGET_CONTRACTS.subAccount.address,
        functionName: "updateConfig",
        args: [parseEther("0.01"), parseEther("0.05"), 300n, 10n],
        // The write is pinned to the registry's chain: a rejected chain switch
        // must not send the transaction to the chain the wallet is on.
        chainId: SET_FORGET_CONTRACTS.subAccount.chainId,
      }),
    );
    // The registry lives on Unichain Sepolia.
    expect(mockSwitchChainAsync).toHaveBeenCalledWith({
      chainId: SET_FORGET_CONTRACTS.subAccount.chainId,
    });
  });

  it("activates and deactivates the caller's own sub-account", async () => {
    const { result } = renderHook(() => useOnchain());

    await act(async () => {
      await result.current.setSubAccountActive(false);
    });
    expect(mockWriteContractAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        address: SET_FORGET_CONTRACTS.subAccount.address,
        functionName: "deactivate",
        args: [],
      }),
    );

    await act(async () => {
      await result.current.setSubAccountActive(true);
    });
    expect(mockWriteContractAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        address: SET_FORGET_CONTRACTS.subAccount.address,
        functionName: "activate",
        args: [],
      }),
    );
  });

  it("updates the caller's own guard subscription while preserving its state", async () => {
    const { result } = renderHook(() => useOnchain());

    await act(async () => {
      await result.current.updateSelfSubscription({
        maxDaily: 5,
        cooldown: 600,
        isActive: false,
      });
    });

    expect(mockWriteContractAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        address: SET_FORGET_CONTRACTS.reactiveGuard.address,
        functionName: "updateSubscription",
        args: [USER, false, 5n, 600n],
        // Guard writes are pinned to Lasna so a rejected chain switch cannot
        // execute them on Unichain or Base.
        chainId: SET_FORGET_CONTRACTS.reactiveGuard.chainId,
      }),
    );
    expect(mockSwitchChainAsync).toHaveBeenCalledWith({
      chainId: SET_FORGET_CONTRACTS.reactiveGuard.chainId,
    });
  });

  it("resumes the caller's own subscription as active", async () => {
    const { result } = renderHook(() => useOnchain());

    await act(async () => {
      await result.current.resumeSelf({ maxDaily: 10, cooldown: 300 });
    });

    expect(mockWriteContractAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        address: SET_FORGET_CONTRACTS.reactiveGuard.address,
        functionName: "updateSubscription",
        args: [USER, true, 10n, 300n],
      }),
    );
  });

  it("sets the caller's own daily request cap in the vault", async () => {
    const { result } = renderHook(() => useOnchain());

    await act(async () => {
      await result.current.setDailyRequestLimit(7);
    });

    expect(mockWriteContractAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        address: SET_FORGET_CONTRACTS.mainVault.address,
        functionName: "setMyDailyRequestLimit",
        args: [7n],
      }),
    );
  });

  it("re-prompts and retries when the wallet does not actually switch chains", async () => {
    // The wallet stayed on Base, so the guard write was refused. The hook
    // asks for the switch again and retries instead of failing the save.
    mockWriteContractAsync
      .mockRejectedValueOnce(
        new ChainMismatchError({
          currentChainId: 84532,
          chain: { id: 5318007, name: "Lasna Testnet" } as never,
        }),
      )
      .mockResolvedValueOnce("0xhash");

    const { result } = renderHook(() => useOnchain());

    await act(async () => {
      await result.current.updateSelfSubscription({
        maxDaily: 10,
        cooldown: 300,
        isActive: true,
      });
    });

    expect(mockSwitchChainAsync).toHaveBeenCalledTimes(2);
    expect(mockWriteContractAsync).toHaveBeenCalledTimes(2);
    expect(mockWriteContractAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        functionName: "updateSubscription",
        chainId: SET_FORGET_CONTRACTS.reactiveGuard.chainId,
      }),
    );
  });

  it("explains which chain the wallet has to be on when the switch fails twice", async () => {
    mockWriteContractAsync.mockRejectedValue(
      new ChainMismatchError({
        currentChainId: 84532,
        chain: { id: 5318007, name: "Lasna Testnet" } as never,
      }),
    );

    const { result } = renderHook(() => useOnchain());

    await act(async () => {
      await expect(
        result.current.updateSelfSubscription({
          maxDaily: 10,
          cooldown: 300,
          isActive: true,
        }),
      ).rejects.toThrow(/Lasna Testnet/);
    });
  });

  it("refuses to act without a connected wallet", async () => {
    mockAddress.current = undefined;
    const { result } = renderHook(() => useOnchain());

    await act(async () => {
      await expect(
        result.current.updateSubAccountConfig({
          threshold: "0.01",
          target: "0.05",
          cooldown: 300,
          maxDaily: 10,
        }),
      ).rejects.toThrow("Connect your wallet first");
    });

    expect(mockWriteContractAsync).not.toHaveBeenCalled();
  });
});