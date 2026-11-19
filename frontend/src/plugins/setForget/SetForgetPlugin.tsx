import React, { useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import {
  useSubAccount,
  SubAccount,
  SubAccountData,
  CreateSubAccountData,
} from './hooks/useSubAccount';
import { useReactive } from './hooks/useReactive';
import SubAccountCard from './components/SubAccountCard';
import { ConfigurationPanel } from '../../components/plugins/ConfigurationPanel';
import { ConfigurationManager } from '../../components/plugins/ConfigurationManager';
import { SET_FORGET_CONTRACTS, CHAIN_CONFIG } from '../../config/contracts';

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

const SetForgetPlugin: React.FC = () => {
  const { address: walletAddress } = useAccount();
  const [subAccounts, setSubAccounts] = useState<SubAccount[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showConfigurationPanel, setShowConfigurationPanel] = useState(false);
  const [activeTab, setActiveTab] = useState<'subaccounts' | 'configuration'>('subaccounts');

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
  const { status: reactiveStatus, setupSubscription } = useReactive();

  // Default the sub-account address to the connected wallet.
  useEffect(() => {
    if (walletAddress) {
      setForm(prev => (prev.address ? prev : { ...prev, address: walletAddress }));
    }
  }, [walletAddress]);

  useEffect(() => {
    loadSubAccounts();
    loadReactiveStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSubAccounts = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await fetchSubAccountsFn();
      setSubAccounts(data);
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

  const handleCreateSubAccount = useCallback(
    async (subAccountData: CreateSubAccountData) => {
      const newSubAccount = await createSubAccount(subAccountData);
      setSubAccounts(prev => [...prev, newSubAccount]);
      return newSubAccount;
    },
    [createSubAccount]
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

  const handleConfigurationChange = (config: any) => {
    console.log('Configuration changed:', config);
    // Handle configuration changes here
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
        address: form.address || walletAddress,
        mainVault: SET_FORGET_CONTRACTS.mainVault.address,
        threshold: form.threshold,
        target: form.target,
        cooldown: parseInt(form.cooldown, 10) || 300,
        maxDaily: parseInt(form.maxDaily, 10) || 10,
      });
      closeForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create sub-account');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('subaccounts')}
          className={`px-4 py-2 text-sm font-medium transition ${activeTab === 'subaccounts'
            ? 'text-emerald-600 border-b-2 border-emerald-500 bg-emerald-50'
            : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
          }`}
        >
          Sub-Accounts
        </button>
        <button
          onClick={() => setActiveTab('configuration')}
          className={`px-4 py-2 text-sm font-medium transition ${activeTab === 'configuration'
            ? 'text-emerald-600 border-b-2 border-emerald-500 bg-emerald-50'
            : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
          }`}
        >
          Configuration Management
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
                    Sub-Account Address
                  </label>
                  <input
                    id="sf-address"
                    type="text"
                    value={form.address}
                    onChange={e => setForm({ ...form, address: e.target.value })}
                    placeholder="0x…"
                    className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  />
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
                {subAccounts.map(account => (
                  <SubAccountCard
                    key={account.address}
                    account={account}
                    onUpdate={handleUpdateSubAccount}
                    onDelete={handleDeleteSubAccount}
                  />
                ))}
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
