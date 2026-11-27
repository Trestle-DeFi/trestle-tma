import React, { useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import {
  useSubAccount,
  SubAccount,
  SubAccountData,
  CreateSubAccountData,
} from './hooks/useSubAccount';
import { useReactive } from './hooks/useReactive';
import { useOnchain, EMPTY_ONCHAIN_STATE, OnchainState } from './hooks/useOnchain';
import SubAccountCard from './components/SubAccountCard';
import { ConfigurationPanel } from '../../components/plugins/ConfigurationPanel';
import { ConfigurationManager } from '../../components/plugins/ConfigurationManager';
import { SET_FORGET_CONTRACTS, CHAIN_CONFIG, PLUGIN_API, VAULT_API } from '../../config/contracts';


const NETWORK_FLOW = [
  {
    name: 'Unichain Sepolia',
    role: 'Sub-Account (destination)',
    chainId: 1301,
    contract: SET_FORGET_CONTRACTS.subAccount,
  },
  {
    name: 'Lasna Testnet',
    role: 'Reactive Guard (listener)',
    chainId: 5318007,
    contract: SET_FORGET_CONTRACTS.reactiveGuard,
  },
  {
    name: 'Base Sepolia',
    role: 'Main Vault (origin)',
    chainId: 84532,
    contract: SET_FORGET_CONTRACTS.mainVault,
  },
];

const EMPTY_FORM = {
  address: '',
  threshold: '0.01',
  target: '0.05',
  cooldown: '300',
  maxDaily: '10',
};

// The guard lives on Lasna and keys subscriptions by the USER's address — the
// same address that emits LowBalanceDetected from the sub-account registry.
const SetForgetPlugin: React.FC = () => {
  const { address: walletAddress } = useAccount();
  const [subAccounts, setSubAccounts] = useState<SubAccount[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showConfigurationPanel, setShowConfigurationPanel] = useState(false);
  // Configuration is the primary entry point: the user configures their
  // auto-topup there (threshold, target, cooldown, daily cap) and it writes
  // the registry, the vault and the guard in one go.
  const [activeTab, setActiveTab] = useState<'subaccounts' | 'configuration'>('configuration');
  const [message, setMessage] = useState<string | null>(null);

  // Live on-chain state for the connected user (their own funds only).
  const [onchain, setOnchain] = useState<OnchainState>(EMPTY_ONCHAIN_STATE);
  const [isTxPending, setIsTxPending] = useState(false);
  const [reserveAmount, setReserveAmount] = useState('0.01');
  const [dailyCap, setDailyCap] = useState('10');

  // Form state for creating sub-accounts
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    fetchSubAccounts: fetchSubAccountsFn,
    createSubAccount,
    updateSubAccount,
    deleteSubAccount,
  } = useSubAccount();
  const { status: reactiveStatus, setupSubscription, subscribeToEvents } = useReactive();
  const {
    createSubAccount: createSubAccountOnchain,
    depositReserve,
    withdrawReserve,
    fundOperationalWallet,
    withdrawOperational,
    setDailyRequestLimit,
    subscribeSelf,
    pauseSelf,
    resumeSelf,
    refresh: refreshOnchainState,
    formatEth,
  } = useOnchain();

  // Ensure every operational sub-account has a reactive subscription so the
  // guard begins watching its LowBalanceDetected events. Previously this was
  // never called (setupSubscription only fetched status), which left
  // `Subscriptions: 0` in the UI and the demo unable to fire.
  const ensureSubscriptions = useCallback(
    async (accounts: SubAccount[]) => {
      const callbackUrl = `${PLUGIN_API}/api/plugins/set-forget/reactive/callback`;
      for (const account of accounts) {
        try {
          await subscribeToEvents(account.address, callbackUrl);
        } catch (error) {
          console.error(`Failed to subscribe sub-account ${account.address}:`, error);
        }
      }
    },
    [subscribeToEvents]
  );

  // Default the sub-account address to the connected wallet.
  useEffect(() => {
    if (walletAddress) {
      setForm(prev => (prev.address ? prev : { ...prev, address: walletAddress }));
    }
  }, [walletAddress]);

  useEffect(() => {
    (async () => {
      const data = await loadSubAccounts();
      await loadReactiveStatus();
      if (data?.length) {
        await ensureSubscriptions(data);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSubAccounts = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await fetchSubAccountsFn();
      setSubAccounts(data);
      return data;
    } catch (error) {
      console.error('Failed to load sub-accounts:', error);
    } finally {
      setIsLoading(false);
    }
  }, [fetchSubAccountsFn]);

  const loadReactiveStatus = useCallback(async () => {
    try {
      await setupSubscription();
    } catch (error) {
      // Non-fatal: page still renders with idle status
      console.error('Failed to setup reactive subscription:', error);
    }
  }, [setupSubscription]);

  // Read the user's live on-chain state (their own reserve, sub-account and
  // guard subscription) straight from the contracts.
  const refreshOnchain = useCallback(async () => {
    if (!walletAddress) {
      setOnchain(EMPTY_ONCHAIN_STATE);
      return;
    }
    try {
      const state = await refreshOnchainState();
      setOnchain(state);
    } catch (error) {
      console.error('Failed to read on-chain state:', error);
    }
  }, [walletAddress, refreshOnchainState]);

  useEffect(() => {
    refreshOnchain();
  }, [refreshOnchain]);

  const handleCreateSubAccount = useCallback(
    async (subAccountData: CreateSubAccountData) => {
      // The registry is the source of truth for the user's threshold/target
      // and the source of the LowBalanceDetected events, so the on-chain
      // creation happens first. It is permissionless and always keys the new
      // sub-account to the connected wallet.
      try {
        await createSubAccountOnchain({
          threshold: subAccountData.threshold,
          target: subAccountData.target,
          cooldown: subAccountData.cooldown ?? 300,
          maxDaily: subAccountData.maxDaily ?? 10,
        });
      } catch (err: any) {
        const reason = String(err?.shortMessage ?? err?.message ?? err);
        // Already created on-chain — continue so the UI can be re-synced.
        if (!reason.includes('Sub-account exists')) throw err;
      }
      const newSubAccount = await createSubAccount(subAccountData);
      setSubAccounts(prev => [...prev, newSubAccount]);
      // Also subscribe the new sub-account to reactive events.
      await ensureSubscriptions([newSubAccount]);
      await refreshOnchain();
      return newSubAccount;
    },
    [createSubAccountOnchain, createSubAccount, ensureSubscriptions, refreshOnchain]
  );

  const handleUpdateSubAccount = useCallback(
    async (address: string, updates: Partial<SubAccountData>) => {
      await updateSubAccount(address, updates);
      setSubAccounts(prev =>
        prev.map(acc => (acc.address === address ? { ...acc, ...updates } : acc))
      );
    },
    [updateSubAccount]
  );

  const handleDeleteSubAccount = useCallback(
    async (address: string) => {
      await deleteSubAccount(address);
      setSubAccounts(prev => prev.filter(acc => acc.address !== address));
    },
    [deleteSubAccount]
  );

  const handleActivate = useCallback(
    async (account: SubAccount) => {
      try {
        setIsTxPending(true);
        const maxDailyRefills = account.maxDaily || 10;
        const cooldown = account.cooldown || 300;
        // Self-service on Lasna: the user's own wallet registers on the guard
        // and opens the subscription with their own cooldown and daily cap.
        await subscribeSelf({ maxDaily: maxDailyRefills, cooldown });
        // The vault-side cap is also the user's own daily request limit.
        await setDailyRequestLimit(maxDailyRefills);
        // Mirror the subscription in the worker's D1 index.
        await subscribeToEvents(
          account.address,
          `${PLUGIN_API}/api/plugins/set-forget/reactive/callback`
        );
        setMessage(`Auto-topup activated for ${account.address}`);
        await refreshOnchain();
      } catch (err: any) {
        setMessage(err?.shortMessage || err?.message || 'Failed to activate auto-topup');
      } finally {
        setIsTxPending(false);
      }
    },
    [subscribeSelf, setDailyRequestLimit, subscribeToEvents, refreshOnchain]
  );

  /** Pause the user's own subscription on the guard (their off switch). */
  const handlePause = useCallback(
    async (account: SubAccount) => {
      try {
        setIsTxPending(true);
        await pauseSelf();
        await handleUpdateSubAccount(account.address, { isActive: false });
        setMessage(`Auto-topup paused for ${account.address}`);
        await refreshOnchain();
      } catch (err: any) {
        setMessage(err?.shortMessage || err?.message || 'Failed to pause auto-topup');
      } finally {
        setIsTxPending(false);
      }
    },
    [pauseSelf, handleUpdateSubAccount, refreshOnchain]
  );

  /** Resume the user's own subscription with their own settings. */
  const handleResume = useCallback(
    async (account: SubAccount) => {
      try {
        setIsTxPending(true);
        await resumeSelf({
          maxDaily: account.maxDaily || 10,
          cooldown: account.cooldown || 300,
        });
        await handleUpdateSubAccount(account.address, { isActive: true });
        setMessage(`Auto-topup resumed for ${account.address}`);
        await refreshOnchain();
      } catch (err: any) {
        setMessage(err?.shortMessage || err?.message || 'Failed to resume auto-topup');
      } finally {
        setIsTxPending(false);
      }
    },
    [resumeSelf, handleUpdateSubAccount, refreshOnchain]
  );

  /**
   * Open the on-chain settings editor for one of the user's own sub-accounts.
   * The editor writes the registry (threshold/target/cooldown/daily cap), the
   * vault (daily request cap) and the guard subscription directly from the
   * user's wallet — no protocol owner transaction is involved.
   */
  const handleEditSettings = useCallback((account: SubAccount) => {
    setForm(prev => ({
      ...prev,
      address: account.address,
      threshold: account.threshold,
      target: account.target,
      cooldown: String(account.cooldown),
      maxDaily: String(account.maxDaily),
    }));
    setActiveTab('configuration');
  }, []);

  /** Fund the user's own reserve — the only source of top-up money. */
  const handleDeposit = useCallback(async () => {
    try {
      setIsTxPending(true);
      await depositReserve(reserveAmount);
      setMessage(`Reserve topped up with ${reserveAmount} ETH`);
      await refreshOnchain();
    } catch (err: any) {
      setMessage(err?.shortMessage || err?.message || 'Failed to deposit');
    } finally {
      setIsTxPending(false);
    }
  }, [depositReserve, reserveAmount, refreshOnchain]);

  /** Withdraw the user's own unused reserve. */
  const handleWithdraw = useCallback(async () => {
    try {
      setIsTxPending(true);
      await withdrawReserve(reserveAmount);
      setMessage(`Withdrew ${reserveAmount} ETH from your reserve`);
      await refreshOnchain();
    } catch (err: any) {
      setMessage(err?.shortMessage || err?.message || 'Failed to withdraw');
    } finally {
      setIsTxPending(false);
    }
  }, [withdrawReserve, reserveAmount, refreshOnchain]);

  /** Fund the user's own operational wallet on the Unichain registry. */
  const handleFundOperational = useCallback(async () => {
    try {
      setIsTxPending(true);
      await fundOperationalWallet(reserveAmount);
      setMessage(`Operational wallet funded with ${reserveAmount} ETH`);
      await refreshOnchain();
    } catch (err: any) {
      setMessage(err?.shortMessage || err?.message || 'Failed to fund the operational wallet');
    } finally {
      setIsTxPending(false);
    }
  }, [fundOperationalWallet, reserveAmount, refreshOnchain]);

  /** Withdraw the user's own unspent operational balance. */
  const handleWithdrawOperational = useCallback(async () => {
    try {
      setIsTxPending(true);
      await withdrawOperational(reserveAmount);
      setMessage(`Withdrew ${reserveAmount} ETH from your operational wallet`);
      await refreshOnchain();
    } catch (err: any) {
      setMessage(err?.shortMessage || err?.message || 'Failed to withdraw');
    } finally {
      setIsTxPending(false);
    }
  }, [withdrawOperational, reserveAmount, refreshOnchain]);

  /** Set the user's own daily top-up request cap. */
  const handleSetDailyCap = useCallback(async () => {
    try {
      setIsTxPending(true);
      const limit = parseInt(dailyCap, 10) || 10;
      await setDailyRequestLimit(limit);
      setMessage(`Daily top-up cap set to ${limit}`);
      await refreshOnchain();
    } catch (err: any) {
      setMessage(err?.shortMessage || err?.message || 'Failed to set daily cap');
    } finally {
      setIsTxPending(false);
    }
  }, [setDailyRequestLimit, dailyCap, refreshOnchain]);

  const handleConfigurationChange = (config: any) => {
    // Refresh both the worker index and the live chain state so the UI
    // reflects any threshold/target/cooldown changes the user just saved.
    loadSubAccounts().catch((e) => console.error('Failed to refresh sub-accounts:', e));
    refreshOnchain().catch((e) => console.error('Failed to refresh on-chain state:', e));
  };

  const explorerFor = (chainId: number) =>
    Object.values(CHAIN_CONFIG).find(c => c.id === chainId)?.explorer ?? '';

  const openForm = () => {
    setFormError(null);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setFormError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletAddress) {
      setFormError('Please connect your wallet first.');
      return;
    }
    try {
      setIsSubmitting(true);
      setFormError(null);
      await handleCreateSubAccount({
        // Self-service: the sub-account always belongs to the connected
        // wallet, both on-chain and in the worker's index.
        address: walletAddress,
        mainVault: SET_FORGET_CONTRACTS.mainVault.address,
        threshold: form.threshold,
        target: form.target,
        cooldown: parseInt(form.cooldown, 10) || 300,
        maxDaily: parseInt(form.maxDaily, 10) || 10,
      });
      closeForm();
    } catch (err: any) {
      setFormError(err?.shortMessage || err?.message || 'Failed to create sub-account');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Tab Navigation — Configuration first: it is where the user sets up
          their auto-topup (threshold, target, cooldown, daily cap). */}
      <div className="flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('configuration')}
          className={`px-4 py-2 text-sm font-medium transition ${activeTab === 'configuration'
            ? 'text-emerald-600 border-b-2 border-emerald-500 bg-emerald-50'
            : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
          }`}
        >
          Configuration Management
        </button>
        <button
          onClick={() => setActiveTab('subaccounts')}
          className={`px-4 py-2 text-sm font-medium transition ${activeTab === 'subaccounts'
            ? 'text-emerald-600 border-b-2 border-emerald-500 bg-emerald-50'
            : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
          }`}
        >
          Sub-Accounts & Funds
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'subaccounts' && (
        <div className="space-y-4">
          {/* Cross-chain flow overview */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Cross-Chain Flow</h3>
            <div className="space-y-2">
              {NETWORK_FLOW.map((chain, i) => {
                const explorer = explorerFor(chain.chainId);
                return (
                  <div key={chain.chainId} className="flex items-center gap-2 text-xs">
                    <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold shrink-0">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800">{chain.name}</p>
                      <p className="text-gray-500">{chain.role}</p>
                    </div>
                    <a
                      href={`${explorer}/address/${chain.contract.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[10px] text-gray-400 hover:text-emerald-600 transition shrink-0"
                      title={chain.contract.address}
                    >
                      {chain.contract.name} {chain.contract.address.slice(0, 6)}...{chain.contract.address.slice(-4)}
                    </a>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Reactive status */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-700">Reactive Network Status</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full ${reactiveStatus.isConnected ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                {reactiveStatus.isConnected ? 'Connected' : 'Idle'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-lg font-bold text-emerald-600">{reactiveStatus.subscriptionCount}</p>
                <p className="text-[10px] text-gray-500">Subscriptions</p>
              </div>
              <div>
                <p className="text-lg font-bold text-emerald-600">{reactiveStatus.pendingCount}</p>
                <p className="text-[10px] text-gray-500">Pending</p>
              </div>
              <div>
                <p className="text-sm font-bold text-gray-600 truncate">{reactiveStatus.lastTrigger || 'Never'}</p>
                <p className="text-[10px] text-gray-500">Last Trigger</p>
              </div>
            </div>
            {reactiveStatus.guardAddress && (
              <p className="text-[10px] text-gray-400 mt-2 font-mono truncate">
                Guard: {reactiveStatus.guardAddress}
              </p>
            )}
            {reactiveStatus.lastError && (
              <p className="text-xs text-red-600 mt-2">{reactiveStatus.lastError}</p>
            )}
          </div>

          {/* Your funds — self-service reserve on the Base vault */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-700">Your Reserve</h3>
              <button
                onClick={refreshOnchain}
                className="text-[11px] px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
              >
                Refresh
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center mb-3">
              <div className="rounded-lg bg-emerald-50 p-2">
                <p className="text-lg font-bold text-emerald-600">
                  {formatEth(onchain.reserveBalance)}
                </p>
                <p className="text-[10px] text-gray-500">Reserve (ETH)</p>
              </div>
              <div className="rounded-lg bg-blue-50 p-2">
                <p className="text-lg font-bold text-blue-600">
                  {formatEth(onchain.virtualBalance)}
                </p>
                <p className="text-[10px] text-gray-500">Operational (ETH)</p>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] mb-3">
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">Sub-account</dt>
                <dd className="text-gray-700 font-medium">
                  {onchain.hasSubAccount
                    ? onchain.subAccountActive
                      ? 'Active'
                      : 'Inactive'
                    : 'Not created'}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">Subscription</dt>
                <dd className="text-gray-700 font-medium">
                  {onchain.subscriptionActive ? 'Active' : 'Paused'}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">Daily cap</dt>
                <dd className="text-gray-700 font-medium">{onchain.dailyLimit || '—'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">Cooldown</dt>
                <dd className="text-gray-700 font-medium">{onchain.cooldown ? `${onchain.cooldown}s` : '—'}</dd>
              </div>
            </dl>

            <div className="flex gap-2 mb-2">
              <div className="flex-1">
                <label className="block text-[11px] text-gray-600 mb-1" htmlFor="sf-amount">
                  Amount (ETH)
                </label>
                <input
                  id="sf-amount"
                  type="text"
                  inputMode="decimal"
                  value={reserveAmount}
                  onChange={e => setReserveAmount(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>
              <div className="flex items-end gap-1 flex-wrap">
                <button
                  onClick={handleDeposit}
                  disabled={isTxPending || !walletAddress}
                  className="text-xs px-3 py-1.5 bg-emerald-500 text-white rounded-lg font-medium hover:bg-emerald-600 transition disabled:opacity-50"
                >
                  Deposit reserve
                </button>
                <button
                  onClick={handleWithdraw}
                  disabled={isTxPending || !walletAddress}
                  className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg font-medium hover:bg-gray-200 transition disabled:opacity-50"
                >
                  Withdraw reserve
                </button>
                <button
                  onClick={handleFundOperational}
                  disabled={isTxPending || !walletAddress}
                  className="text-xs px-3 py-1.5 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition disabled:opacity-50"
                >
                  Fund operational
                </button>
                <button
                  onClick={handleWithdrawOperational}
                  disabled={isTxPending || !walletAddress}
                  className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg font-medium hover:bg-gray-200 transition disabled:opacity-50"
                >
                  Withdraw operational
                </button>
              </div>
            </div>

            <p className="text-[10px] text-gray-500 mb-3">
              <span className="font-medium text-gray-600">Deposit reserve</span> funds your
              Base-side reserve — the only source of auto-topup money.{' '}
              <span className="font-medium text-gray-600">Fund operational</span> is a manual
              top-up of the Unichain-side operational balance; from then on the auto-topup
              refills it from your reserve.
            </p>

            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="block text-[11px] text-gray-600 mb-1" htmlFor="sf-dailycap">
                  Daily top-up cap
                </label>
                <input
                  id="sf-dailycap"
                  type="number"
                  min={1}
                  value={dailyCap}
                  onChange={e => setDailyCap(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>
              <button
                onClick={handleSetDailyCap}
                disabled={isTxPending || !walletAddress}
                className="text-xs px-3 py-1.5 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition disabled:opacity-50"
              >
                Set cap
              </button>
            </div>
            <p className="text-[10px] text-gray-500 mt-2">
              Every top-up is paid from your own reserve. The protocol holds no capital,
              and only you can move your funds.
            </p>
            {message && <p className="text-xs text-emerald-700 mt-2">{message}</p>}
          </div>

          {/* Sub-accounts */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">Operational Sub-Accounts</h3>
              <button
                onClick={openForm}
                className="text-xs px-3 py-1.5 bg-emerald-500 text-white rounded-lg font-medium hover:bg-emerald-600 transition disabled:opacity-50"
                disabled={isLoading}
              >
                + Add Sub-Account
              </button>
            </div>
            {showForm && (
              <form onSubmit={handleSubmit} className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 space-y-2">
                <div>
                  <label className="block text-[11px] text-gray-600 mb-1" htmlFor="sf-address">
                    Your Wallet (sub-account owner)
                  </label>
                  <input
                    id="sf-address"
                    type="text"
                    readOnly
                    value={walletAddress || 'Connect your wallet'}
                    className="w-full rounded-lg border border-gray-300 bg-gray-100 px-2 py-1.5 text-xs font-mono text-gray-600 focus:outline-none"
                  />
                  <p className="text-[10px] text-gray-500 mt-1">
                    The sub-account is always created for your own wallet — no one
                    else can create or claim one for you.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-gray-600 mb-1" htmlFor="sf-threshold">
                      Threshold (ETH)
                    </label>
                    <input
                      id="sf-threshold"
                      type="text"
                      inputMode="decimal"
                      value={form.threshold}
                      onChange={e => setForm({ ...form, threshold: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-600 mb-1" htmlFor="sf-target">
                      Target (ETH)
                    </label>
                    <input
                      id="sf-target"
                      type="text"
                      inputMode="decimal"
                      value={form.target}
                      onChange={e => setForm({ ...form, target: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-600 mb-1" htmlFor="sf-cooldown">
                      Cooldown (s)
                    </label>
                    <input
                      id="sf-cooldown"
                      type="number"
                      min={300}
                      value={form.cooldown}
                      onChange={e => setForm({ ...form, cooldown: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-600 mb-1" htmlFor="sf-maxdaily">
                      Max Daily
                    </label>
                    <input
                      id="sf-maxdaily"
                      type="number"
                      min={1}
                      max={10}
                      value={form.maxDaily}
                      onChange={e => setForm({ ...form, maxDaily: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-gray-500">
                  Main Vault:{' '}
                  <span className="font-mono">
                    {SET_FORGET_CONTRACTS.mainVault.address.slice(0, 10)}...
                    {SET_FORGET_CONTRACTS.mainVault.address.slice(-6)}
                  </span>{' '}
                  (Base Sepolia)
                </p>
                {formError && <p className="text-xs text-red-600">{formError}</p>}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="text-xs px-3 py-1.5 bg-emerald-500 text-white rounded-lg font-medium hover:bg-emerald-600 transition disabled:opacity-50"
                  >
                    {isSubmitting ? 'Creating…' : 'Create'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg font-medium hover:bg-gray-200 transition"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {isLoading ? (
              <p className="text-center text-gray-400 text-sm py-4">Loading sub-accounts...</p>
            ) : subAccounts.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-sm text-gray-400">No sub-accounts configured yet.</p>
                <button
                  onClick={openForm}
                  className="mt-2 text-xs text-emerald-600 hover:underline"
                >
                  Create first sub-account
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {subAccounts.map(account => {
                  // The worker's index can lag behind the chain, so the user's
                  // own card shows the values that are actually on-chain —
                  // those are the ones that drive the auto-topup.
                  const isOwn =
                    !!walletAddress &&
                    account.address.toLowerCase() === walletAddress.toLowerCase();
                  const displayAccount: SubAccount =
                    isOwn && onchain.hasSubAccount
                      ? {
                          ...account,
                          threshold:
                            onchain.threshold > 0n ? formatEth(onchain.threshold) : account.threshold,
                          target: onchain.target > 0n ? formatEth(onchain.target) : account.target,
                          cooldown: onchain.cooldown > 0 ? onchain.cooldown : account.cooldown,
                          maxDaily: onchain.maxDaily > 0 ? onchain.maxDaily : account.maxDaily,
                          isActive: onchain.subAccountActive,
                        }
                      : account;
                  return (
                    <SubAccountCard
                      key={account.address}
                      account={displayAccount}
                      onUpdate={handleUpdateSubAccount}
                      onDelete={handleDeleteSubAccount}
                      onActivate={handleActivate}
                      onPause={handlePause}
                      onResume={handleResume}
                      onEditSettings={handleEditSettings}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'configuration' && (
        <div className="space-y-4">
          <ConfigurationManager />
        </div>
      )}
    </div>
  );
};

export default SetForgetPlugin;
