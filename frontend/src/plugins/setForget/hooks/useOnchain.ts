import { useCallback } from 'react';
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { parseEther, formatEther, type Address } from 'viem';
import { SET_FORGET_CONTRACTS } from '../../../config/contracts';

// ABIs below expose only the per-user, self-service entry points. Every one of
// them is callable by the user themself; none of them require the protocol
// owner and none of them let one user touch another user's funds.

export const VAULT_ABI = [
  {
    type: 'function',
    name: 'depositFor',
    stateMutability: 'payable',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setMyDailyRequestLimit',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'limit', type: 'uint64' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'balances',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getEffectiveDailyLimit',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'uint64' }],
  },
] as const;

const SUBCONFIG_COMPONENTS = [
  { name: 'mainVault', type: 'address' },
  { name: 'owner', type: 'address' },
  { name: 'threshold', type: 'uint256' },
  { name: 'target', type: 'uint256' },
  { name: 'cooldown', type: 'uint64' },
  { name: 'maxDaily', type: 'uint64' },
  { name: 'sequence', type: 'uint64' },
  { name: 'spendsToday', type: 'uint64' },
  { name: 'totalSpentToday', type: 'uint256' },
  { name: 'lastSpendDay', type: 'uint256' },
  { name: 'isActive', type: 'bool' },
  { name: 'createdAt', type: 'uint256' },
  { name: 'lastTopUpTime', type: 'uint256' },
];

export const REGISTRY_ABI = [
  {
    type: 'function',
    name: 'createSubAccount',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'mainVault', type: 'address' },
      { name: 'threshold', type: 'uint256' },
      { name: 'target', type: 'uint256' },
      { name: 'cooldown', type: 'uint64' },
      { name: 'maxDaily', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getSubAccountInfo',
    stateMutability: 'view',
    inputs: [{ name: 'subAccount', type: 'address' }],
    outputs: [{ type: 'tuple', components: SUBCONFIG_COMPONENTS }],
  },
  {
    type: 'function',
    name: 'virtualBalances',
    stateMutability: 'view',
    inputs: [{ name: 'subAccount', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'isSubAccountActive',
    stateMutability: 'view',
    inputs: [{ name: 'subAccount', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'depositTopUp',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'updateConfig',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'newThreshold', type: 'uint256' },
      { name: 'newTarget', type: 'uint256' },
      { name: 'newCooldown', type: 'uint64' },
      { name: 'newMaxDaily', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'activate',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'deactivate',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
] as const;

// The guard keeps a legacy 2-arg setupSubscription next to the 3-arg one, so
// this ABI deliberately carries only the 3-arg form: the UI always sets the
// user's own cooldown and never falls back to the protocol default.
export const GUARD_ABI = [
  {
    type: 'function',
    name: 'registerSubAccount',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'subAccount', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setupSubscription',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'subAccount', type: 'address' },
      { name: 'maxDailyRefills', type: 'uint64' },
      { name: 'cooldown', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'updateSubscription',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'subAccount', type: 'address' },
      { name: 'isActive', type: 'bool' },
      { name: 'newMaxDailyRefills', type: 'uint64' },
      { name: 'newCooldown', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'pauseSubscription',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'subAccount', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getSubscriptionStatus',
    stateMutability: 'view',
    inputs: [{ name: 'subAccount', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'subAccount', type: 'address' },
          { name: 'maxDailyRefills', type: 'uint64' },
          { name: 'dailyRefillCount', type: 'uint64' },
          { name: 'lastRefillDay', type: 'uint256' },
          { name: 'lastCooldownAt', type: 'uint256' },
          { name: 'cooldown', type: 'uint64' },
          { name: 'lastEventHash', type: 'bytes32' },
          { name: 'isActive', type: 'bool' },
          { name: 'createdAt', type: 'uint256' },
        ],
      },
    ],
  },
] as const;

export interface OnchainState {
  /** The user's reserve in the vault, in wei. */
  reserveBalance: bigint;
  /** The user's operational balance held by the registry, in wei. */
  virtualBalance: bigint;
  /** The user's effective daily top-up request cap. */
  dailyLimit: number;
  /** Whether the user has an on-chain sub-account. */
  hasSubAccount: boolean;
  /** Whether that sub-account is active. */
  subAccountActive: boolean;
  /** The user's on-chain threshold / target, in wei. */
  threshold: bigint;
  target: bigint;
  /** The user's own cooldown and daily refill cap from the guard. */
  cooldown: number;
  maxDaily: number;
  /** Whether the guard subscription is active. */
  subscriptionActive: boolean;
  /** Whether the user has a guard subscription at all (as opposed to none). */
  hasSubscription: boolean;
}

export const EMPTY_ONCHAIN_STATE: OnchainState = {
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
};

/**
 * Self-service contract access for the Set & Forget plugin.
 *
 * Every action here is performed by the connected user's own wallet:
 *  - create their sub-account on the Unichain registry (permissionless),
 *  - fund and withdraw their own reserve on the Base vault,
 *  - set their own daily request cap,
 *  - register and subscribe themselves on the Lasna guard.
 *
 * No protocol owner transaction is involved anywhere in this flow.
 */
export const useOnchain = () => {
  const { address } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  // One client per chain: a single client is bound to the wallet's current
  // chain, so reading the vault while connected to Unichain would query the
  // wrong network.
  const currentClient = usePublicClient();
  const baseClient = usePublicClient({ chainId: SET_FORGET_CONTRACTS.mainVault.chainId });
  const unichainClient = usePublicClient({ chainId: SET_FORGET_CONTRACTS.subAccount.chainId });
  const lasnaClient = usePublicClient({ chainId: SET_FORGET_CONTRACTS.reactiveGuard.chainId });

  const user = address as Address | undefined;

  const requireUser = (): Address => {
    if (!user) throw new Error('Connect your wallet first');
    return user;
  };

  const switchTo = async (chainId: number) => {
    if (!currentClient) throw new Error('No wallet client available');
    if (currentClient.chain?.id !== chainId) {
      await switchChainAsync({ chainId });
    }
  };

  const write = async (params: {
    chainId: number;
    abi: readonly unknown[];
    address: Address;
    functionName: string;
    args?: readonly unknown[];
    value?: bigint;
  }) => {
    await switchTo(params.chainId);
    return writeContractAsync({
      abi: params.abi as never,
      address: params.address,
      functionName: params.functionName,
      args: (params.args ?? []) as never,
      ...(params.value !== undefined ? { value: params.value } : {}),
    });
  };

  /** Create the caller's own sub-account on the Unichain registry. */
  const createSubAccount = useCallback(
    async (params: { threshold: string; target: string; cooldown: number; maxDaily: number }) => {
      requireUser();
      return write({
        chainId: SET_FORGET_CONTRACTS.subAccount.chainId,
        abi: REGISTRY_ABI,
        address: SET_FORGET_CONTRACTS.subAccount.address,
        functionName: 'createSubAccount',
        args: [
          SET_FORGET_CONTRACTS.mainVault.address,
          parseEther(params.threshold),
          parseEther(params.target),
          BigInt(Math.max(1, Math.floor(params.cooldown))),
          BigInt(Math.max(1, Math.floor(params.maxDaily))),
        ],
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, switchChainAsync, writeContractAsync]
  );

  /** Fund the caller's own reserve. This is the only source of top-up money. */
  const depositReserve = useCallback(
    async (amountEth: string) => {
      const me = requireUser();
      return write({
        chainId: SET_FORGET_CONTRACTS.mainVault.chainId,
        abi: VAULT_ABI,
        address: SET_FORGET_CONTRACTS.mainVault.address,
        functionName: 'depositFor',
        args: [me],
        value: parseEther(amountEth),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, switchChainAsync, writeContractAsync]
  );

  /** Withdraw the caller's own unused reserve. Only the owner of the funds can. */
  const withdrawReserve = useCallback(
    async (amountEth: string) => {
      requireUser();
      return write({
        chainId: SET_FORGET_CONTRACTS.mainVault.chainId,
        abi: VAULT_ABI,
        address: SET_FORGET_CONTRACTS.mainVault.address,
        functionName: 'withdraw',
        args: [parseEther(amountEth)],
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, switchChainAsync, writeContractAsync]
  );

  /** Set the caller's own daily top-up request cap. */
  const setDailyRequestLimit = useCallback(
    async (limit: number) => {
      requireUser();
      return write({
        chainId: SET_FORGET_CONTRACTS.mainVault.chainId,
        abi: VAULT_ABI,
        address: SET_FORGET_CONTRACTS.mainVault.address,
        functionName: 'setMyDailyRequestLimit',
        args: [BigInt(Math.max(1, Math.floor(limit)))],
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, switchChainAsync, writeContractAsync]
  );

  /** Fund the caller's own operational wallet on the Unichain registry. */
  const fundOperationalWallet = useCallback(
    async (amountEth: string) => {
      requireUser();
      return write({
        chainId: SET_FORGET_CONTRACTS.subAccount.chainId,
        abi: REGISTRY_ABI,
        address: SET_FORGET_CONTRACTS.subAccount.address,
        functionName: 'depositTopUp',
        args: [],
        value: parseEther(amountEth),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, switchChainAsync, writeContractAsync]
  );

  /** Withdraw the caller's own unspent operational balance. */
  const withdrawOperational = useCallback(
    async (amountEth: string) => {
      requireUser();
      return write({
        chainId: SET_FORGET_CONTRACTS.subAccount.chainId,
        abi: REGISTRY_ABI,
        address: SET_FORGET_CONTRACTS.subAccount.address,
        functionName: 'withdraw',
        args: [parseEther(amountEth)],
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, switchChainAsync, writeContractAsync]
  );

  /**
   * Update the caller's own threshold / target / cooldown / daily cap in the
   * Unichain registry.
   *
   * This is the on-chain counterpart of the configuration panel: the registry
   * is what emits `LowBalanceDetected`, so a threshold that is only stored in
   * the worker's database would never trigger a refill. The call is made by
   * the user's own wallet and the contract only accepts the caller for their
   * own sub-account, so no protocol owner transaction is involved.
   */
  const updateSubAccountConfig = useCallback(
    async (params: { threshold: string; target: string; cooldown: number; maxDaily: number }) => {
      requireUser();
      return write({
        chainId: SET_FORGET_CONTRACTS.subAccount.chainId,
        abi: REGISTRY_ABI,
        address: SET_FORGET_CONTRACTS.subAccount.address,
        functionName: 'updateConfig',
        args: [
          parseEther(params.threshold),
          parseEther(params.target),
          BigInt(Math.max(1, Math.floor(params.cooldown))),
          BigInt(Math.max(1, Math.floor(params.maxDaily))),
        ],
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, switchChainAsync, writeContractAsync]
  );

  /**
   * Activate or deactivate the caller's own sub-account in the registry.
   *
   * A deactivated sub-account stops emitting low-balance events, so this is
   * the user's own off switch for the operational side of the flow. The
   * protocol owner cannot move or configure a user's sub-account here.
   */
  const setSubAccountActive = useCallback(
    async (active: boolean) => {
      requireUser();
      return write({
        chainId: SET_FORGET_CONTRACTS.subAccount.chainId,
        abi: REGISTRY_ABI,
        address: SET_FORGET_CONTRACTS.subAccount.address,
        functionName: active ? 'activate' : 'deactivate',
        args: [],
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, switchChainAsync, writeContractAsync]
  );

  /** Register the caller on the Lasna guard and open their subscription. */
  const subscribeSelf = useCallback(
    async (params: { maxDaily: number; cooldown: number }) => {
      const me = requireUser();
      const maxDaily = BigInt(Math.max(1, Math.floor(params.maxDaily)));
      const cooldown = BigInt(Math.max(1, Math.floor(params.cooldown)));

      await write({
        chainId: SET_FORGET_CONTRACTS.reactiveGuard.chainId,
        abi: GUARD_ABI,
        address: SET_FORGET_CONTRACTS.reactiveGuard.address,
        functionName: 'registerSubAccount',
        args: [me],
      });

      try {
        await write({
          chainId: SET_FORGET_CONTRACTS.reactiveGuard.chainId,
          abi: GUARD_ABI,
          address: SET_FORGET_CONTRACTS.reactiveGuard.address,
          functionName: 'setupSubscription',
          args: [me, maxDaily, cooldown],
        });
      } catch (error) {
        // The subscription already exists - update it instead of failing.
        try {
          await write({
            chainId: SET_FORGET_CONTRACTS.reactiveGuard.chainId,
            abi: GUARD_ABI,
            address: SET_FORGET_CONTRACTS.reactiveGuard.address,
            functionName: 'updateSubscription',
            args: [me, true, maxDaily, cooldown],
          });
        } catch (updateError: any) {
          const reason = String(updateError?.shortMessage ?? updateError?.message ?? updateError);
          // The subscription already has exactly these settings.
          if (!reason.includes('No change needed')) throw updateError;
        }
        return error;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, switchChainAsync, writeContractAsync]
  );

  /** Pause the caller's own subscription (the user's off switch). */
  const pauseSelf = useCallback(async () => {
    const me = requireUser();
    return write({
      chainId: SET_FORGET_CONTRACTS.reactiveGuard.chainId,
      abi: GUARD_ABI,
      address: SET_FORGET_CONTRACTS.reactiveGuard.address,
      functionName: 'pauseSubscription',
      args: [me],
    });
  }, [user, switchChainAsync, writeContractAsync]);

  /**
   * Update the caller's own guard subscription while preserving its active
   * state.
   *
   * The guard rejects a write that changes nothing ("No change needed"), so
   * callers treat that specific revert as a no-op. The contract only accepts
   * the subscription owner — the user themself — so this is self-service.
   */
  const updateSelfSubscription = useCallback(
    async (params: { maxDaily: number; cooldown: number; isActive: boolean }) => {
      const me = requireUser();
      return write({
        chainId: SET_FORGET_CONTRACTS.reactiveGuard.chainId,
        abi: GUARD_ABI,
        address: SET_FORGET_CONTRACTS.reactiveGuard.address,
        functionName: 'updateSubscription',
        args: [
          me,
          params.isActive,
          BigInt(Math.max(1, Math.floor(params.maxDaily))),
          BigInt(Math.max(1, Math.floor(params.cooldown))),
        ],
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, switchChainAsync, writeContractAsync]
  );

  /** Resume / reconfigure the caller's own subscription. */
  const resumeSelf = useCallback(
    async (params: { maxDaily: number; cooldown: number }) => {
      return updateSelfSubscription({ ...params, isActive: true });
    },
    [updateSelfSubscription]
  );

  /** Read the live on-chain state for the connected user. */
  const refresh = useCallback(async (): Promise<OnchainState> => {
    const me = requireUser();
    if (!baseClient || !unichainClient || !lasnaClient) return EMPTY_ONCHAIN_STATE;

    const [reserveBalance, dailyLimit, virtualBalance, subAccount, subscription] = await Promise.all([
      baseClient.readContract({
        address: SET_FORGET_CONTRACTS.mainVault.address,
        abi: VAULT_ABI,
        functionName: 'balances',
        args: [me],
      }) as Promise<bigint>,
      baseClient.readContract({
        address: SET_FORGET_CONTRACTS.mainVault.address,
        abi: VAULT_ABI,
        functionName: 'getEffectiveDailyLimit',
        args: [me],
      }) as Promise<bigint>,
      unichainClient.readContract({
        address: SET_FORGET_CONTRACTS.subAccount.address,
        abi: REGISTRY_ABI,
        functionName: 'virtualBalances',
        args: [me],
      }) as Promise<bigint>,
      unichainClient.readContract({
        address: SET_FORGET_CONTRACTS.subAccount.address,
        abi: REGISTRY_ABI,
        functionName: 'getSubAccountInfo',
        args: [me],
      }) as Promise<{
        mainVault: Address;
        owner: Address;
        threshold: bigint;
        target: bigint;
        cooldown: bigint;
        maxDaily: bigint;
        isActive: boolean;
      }>,
      lasnaClient.readContract({
        address: SET_FORGET_CONTRACTS.reactiveGuard.address,
        abi: GUARD_ABI,
        functionName: 'getSubscriptionStatus',
        args: [me],
      }) as Promise<{
        subAccount: Address;
        maxDailyRefills: bigint;
        cooldown: bigint;
        isActive: boolean;
        createdAt: bigint;
      }>,
    ]);

    return {
      reserveBalance,
      virtualBalance,
      dailyLimit: Number(dailyLimit),
      hasSubAccount: subAccount.owner !== '0x0000000000000000000000000000000000000000',
      subAccountActive: Boolean(subAccount.isActive),
      threshold: subAccount.threshold,
      target: subAccount.target,
      cooldown: Number(subscription.cooldown ?? subAccount.cooldown ?? 0),
      maxDaily: Number(subscription.maxDailyRefills ?? subAccount.maxDaily ?? 0),
      subscriptionActive: Boolean(subscription.isActive),
      // A subscription that was never opened has a zero sub-account address
      // and a zero creation timestamp; a paused one keeps both.
      hasSubscription:
        subscription.subAccount !== '0x0000000000000000000000000000000000000000' ||
        BigInt(subscription.createdAt ?? 0) > 0n,
    };
  }, [user, baseClient, unichainClient, lasnaClient]);

  return {
    createSubAccount,
    updateSubAccountConfig,
    setSubAccountActive,
    depositReserve,
    withdrawReserve,
    fundOperationalWallet,
    withdrawOperational,
    setDailyRequestLimit,
    subscribeSelf,
    updateSelfSubscription,
    pauseSelf,
    resumeSelf,
    refresh,
    formatEth: (wei: bigint) => formatEther(wei),
  };
};
