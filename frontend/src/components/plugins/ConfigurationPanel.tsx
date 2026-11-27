import React, { useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { useSubAccount, SubAccount } from '../../plugins/setForget/hooks/useSubAccount';
import { useReactive } from '../../plugins/setForget/hooks/useReactive';
import { useConfiguration } from '../../plugins/setForget/hooks/useConfiguration';
import {
  DEFAULT_PREFERENCES,
  DEFAULT_SETTINGS,
  RiskLevel,
  SET_FORGET_BOUNDS,
  boundsFromChain,
  validateSettings,
} from '../../plugins/setForget/config';
import SubAccountCard from '../../plugins/setForget/components/SubAccountCard';
import { SET_FORGET_CONTRACTS, CHAIN_CONFIG } from '../../config/contracts';
import { useOnchain } from '../../plugins/setForget/hooks/useOnchain';

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

export interface ConfigurationPanelProps {
  onConfigurationChange?: (config: any) => void;
  userAddress?: string;
}

export const ConfigurationPanel: React.FC<ConfigurationPanelProps> = ({
  onConfigurationChange,
  userAddress,
}) => {
  const { address: walletAddress } = useAccount();
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [onchainNote, setOnchainNote] = useState<string | null>(null);

  const [threshold, setThreshold] = useState(DEFAULT_SETTINGS.threshold);
  const [target, setTarget] = useState(DEFAULT_SETTINGS.target);
  const [cooldown, setCooldown] = useState(String(DEFAULT_SETTINGS.cooldown));
  const [maxDaily, setMaxDaily] = useState(String(DEFAULT_SETTINGS.maxDaily));
  // The bounds the deployed contracts enforce, read from the chain. They are
  // not hard-coded: the registry, the guard and the vault each cap the user's
  // own configuration and the form must respect the strictest one.
  const [bounds, setBounds] = useState(SET_FORGET_BOUNDS);
  const [autoTopupEnabled, setAutoTopupEnabled] = useState(DEFAULT_PREFERENCES.autoTopupEnabled);
  const [notificationsEnabled, setNotificationsEnabled] = useState(DEFAULT_PREFERENCES.notificationsEnabled);
  const [riskLevel, setRiskLevel] = useState(DEFAULT_PREFERENCES.riskLevel);
  const [gasOptimization, setGasOptimization] = useState(DEFAULT_PREFERENCES.gasOptimization);

  const { fetchSubAccounts, createSubAccount, updateSubAccount } = useSubAccount();
  const { status: reactiveStatus } = useReactive();
  const { loadPreferences, savePreferences } = useConfiguration();
  // On-chain self-service actions. The contracts are what actually drive the
  // auto-topup, so the user's own wallet writes them; no protocol owner
  // transaction is involved in any step below.
  const {
    createSubAccount: createSubAccountOnchain,
    updateSubAccountConfig,
    setDailyRequestLimit,
    updateSelfSubscription,
    subscribeSelf,
    refresh: refreshOnchainState,
    formatEth,
  } = useOnchain();

  useEffect(() => {
    if (userAddress) {
      loadUserConfiguration(userAddress);
    } else if (walletAddress) {
      loadUserConfiguration(walletAddress);
    }
  }, [userAddress, walletAddress]);

  const loadUserConfiguration = async (address: string) => {
    try {
      setIsLoading(true);
      setError(null);

      // Load sub-account configuration
      const subAccounts = await fetchSubAccounts();
      const userSubAccount = subAccounts.find((acc: SubAccount) => acc.address.toLowerCase() === address.toLowerCase());

      if (userSubAccount) {
        setThreshold(userSubAccount.threshold);
        setTarget(userSubAccount.target);
        setCooldown(userSubAccount.cooldown.toString());
        setMaxDaily(userSubAccount.maxDaily.toString());
      }

      // The on-chain registry is the source of truth for what drives the
      // auto-topup, so its values win over the off-chain mirror. This is a
      // plain read of the user's own sub-account.
      try {
        const chainState = await refreshOnchainState();
        // The chain is the source of truth for both the user's settings and
        // the limits the contracts enforce.
        setBounds(boundsFromChain(chainState.limits));
        if (chainState.hasSubAccount) {
          setThreshold(formatEth(chainState.threshold));
          setTarget(formatEth(chainState.target));
          if (chainState.cooldown > 0) setCooldown(String(chainState.cooldown));
          if (chainState.maxDaily > 0) setMaxDaily(String(chainState.maxDaily));
        }
      } catch (err) {
        console.error('Failed to read on-chain configuration:', err);
      }

      // Per-user preferences live on the worker; the browser copy is only a
      // fallback for when the plugin API is unreachable.
      const stored = await loadPreferences(address);
      if (stored) {
        setAutoTopupEnabled(stored.autoTopupEnabled);
        setNotificationsEnabled(stored.notificationsEnabled);
        setRiskLevel(stored.riskLevel);
        setGasOptimization(stored.gasOptimization);
        return;
      }
      // No persisted preferences; keep defaults.

    } catch (err) {
      console.error('Failed to load user configuration:', err);
      setError('Failed to load configuration');
    } finally {
      setIsLoading(false);
    }
  };

  const saveUserConfiguration = useCallback(async () => {
    if (!walletAddress) {
      setError('Please connect your wallet first');
      return;
    }

    const validationError = validateSettings({
      threshold,
      target,
      cooldown: Number(cooldown),
      maxDaily: Number(maxDaily),
    }, bounds);
    if (validationError) {
      setError(validationError);
      setSuccess(null);
      return;
    }

    try {
      setIsSaving(true);
      setError(null);
      setSuccess(null);

      // ── 1. On-chain first ────────────────────────────────────────────────
      // The contracts are what actually drive the auto-topup, so the user's
      // own wallet writes them. Every call below is self-service: the
      // registry only accepts the caller for their own sub-account, the vault
      // only accepts the caller for their own cap, and the guard only accepts
      // the subscription owner. No protocol owner transaction is involved.
      const chainState = await refreshOnchainState().catch((err) => {
        // A lagging or unreachable RPC must not block the write: the update
        // itself is the source of truth, so fall back to trying the update.
        console.error('Failed to read on-chain state, attempting the write anyway:', err);
        return null;
      });
      // Re-read the enforced limits so the save is validated against the
      // deployment as it is right now.
      setBounds(boundsFromChain(chainState?.limits));
      const dailyCap = Number(maxDaily);

      // Update the registry first. If the user has no sub-account yet the
      // contract rejects the update, and the account is created instead.
      try {
        await updateSubAccountConfig({
          threshold,
          target,
          cooldown: Number(cooldown),
          maxDaily: dailyCap,
        });
      } catch (err: any) {
        const reason = String(err?.shortMessage ?? err?.message ?? err);
        if (!reason.includes('Sub-account not active')) throw err;
        await createSubAccountOnchain({
          threshold,
          target,
          cooldown: Number(cooldown),
          maxDaily: dailyCap,
        });
      }

      // The vault-side cap on top-up requests is the user's own.
      await setDailyRequestLimit(dailyCap);

      // The guard subscription carries the user's cooldown and daily refill
      // cap. Its active state is preserved, so saving settings never silently
      // resumes a subscription the user paused.
      if (chainState?.hasSubscription) {
        try {
          await updateSelfSubscription({
            maxDaily: dailyCap,
            cooldown: Number(cooldown),
            isActive: chainState.subscriptionActive,
          });
        } catch (err: any) {
          const reason = String(err?.shortMessage ?? err?.message ?? err);
          // The guard reverts when nothing changes; that is a no-op, not a
          // failure.
          if (!reason.includes('No change needed')) throw err;
        }
      } else {
        // No subscription yet (or the chain could not be read): register and
        // open one for the user.
        await subscribeSelf({ maxDaily: dailyCap, cooldown: Number(cooldown) });
      }

      // ── 2. Mirror into the worker's off-chain index ─────────────────────
      // Create the sub-account; if it already exists the worker rejects the
      // POST and the same values are written through the update route.
      const subAccountData = {
        address: walletAddress,
        mainVault: SET_FORGET_CONTRACTS.mainVault.address,
        threshold,
        target,
        cooldown: Number(cooldown),
        maxDaily: Number(maxDaily),
      };

      let subAccount;
      try {
        subAccount = await createSubAccount(subAccountData);
      } catch {
        subAccount = await updateSubAccount(walletAddress, {
          threshold,
          target,
          cooldown: Number(cooldown),
          maxDaily: Number(maxDaily),
        });
      }

      // Save user preferences on the worker (per user, survives the browser)
      const userPrefs = {
        autoTopupEnabled,
        notificationsEnabled,
        riskLevel,
        gasOptimization,
        lastUpdated: Date.now(),
      };
      const savedPrefs = await savePreferences(walletAddress, userPrefs);

      setSuccess('Configuration saved successfully');
      setOnchainNote('Saved on-chain (Unichain registry, Base vault, Lasna guard) and mirrored to the worker index.');
      onConfigurationChange?.(savedPrefs);

    } catch (err) {
      console.error('Failed to save configuration:', err);
      setError(err instanceof Error ? err.message : 'Failed to save configuration');
    } finally {
      setIsSaving(false);
    }
  }, [
    walletAddress,
    threshold,
    target,
    cooldown,
    maxDaily,
    autoTopupEnabled,
    notificationsEnabled,
    riskLevel,
    gasOptimization,
    createSubAccount,
    updateSubAccount,
    savePreferences,
    onConfigurationChange,
    createSubAccountOnchain,
    updateSubAccountConfig,
    setDailyRequestLimit,
    updateSelfSubscription,
    subscribeSelf,
    refreshOnchainState,
    bounds,
  ]);

  const resetToDefaults = () => {
    setThreshold(DEFAULT_SETTINGS.threshold);
    setTarget(DEFAULT_SETTINGS.target);
    setCooldown(String(DEFAULT_SETTINGS.cooldown));
    setMaxDaily(String(DEFAULT_SETTINGS.maxDaily));
    setAutoTopupEnabled(DEFAULT_PREFERENCES.autoTopupEnabled);
    setNotificationsEnabled(DEFAULT_PREFERENCES.notificationsEnabled);
    setRiskLevel(DEFAULT_PREFERENCES.riskLevel);
    setGasOptimization(DEFAULT_PREFERENCES.gasOptimization);
  };

  const formatBalance = (value: string) => {
    const num = parseFloat(value);
    if (!Number.isFinite(num)) return '0';
    if (num < 0.001) return '<0.001';
    if (num < 1) return num.toFixed(3);
    return num.toFixed(2);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold mb-4">Per-User Configuration Management</h2>
        
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}
        
        {success && (
          <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
            <p className="text-sm text-emerald-600">{success}</p>
            {onchainNote && (
              <p className="text-xs text-emerald-700 mt-1">{onchainNote}</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Core Configuration */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-700">Core Configuration</h3>
            
            <div>
              <label className="block text-xs text-gray-600 mb-1">Threshold (ETH)</label>
              <input
                type="text"
                inputMode="decimal"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                placeholder={DEFAULT_SETTINGS.threshold}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
              <p className="text-xs text-gray-500 mt-1">
                Auto-topup triggers when balance falls below this amount
                (minimum {formatEth(bounds.minThresholdWei)} ETH)
              </p>
            </div>

            <div>
              <label className="block text-xs text-gray-600 mb-1">Target (ETH)</label>
              <input
                type="text"
                inputMode="decimal"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder={DEFAULT_SETTINGS.target}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
              <p className="text-xs text-gray-500 mt-1">Refill amount to restore balance to this level</p>
            </div>

            <div>
              <label className="block text-xs text-gray-600 mb-1">Cooldown (seconds)</label>
              <input
                type="number"
                min={bounds.minCooldownSeconds}
                value={cooldown}
                onChange={(e) => setCooldown(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
              <p className="text-xs text-gray-500 mt-1">
                Minimum time between top-ups ({bounds.minCooldownSeconds}s ={' '}
                {Math.round(bounds.minCooldownSeconds / 60)} minutes)
              </p>
            </div>

            <div>
              <label className="block text-xs text-gray-600 mb-1">Max Daily Refills</label>
              <input
                type="number"
                min={1}
                max={bounds.maxDaily}
                value={maxDaily}
                onChange={(e) => setMaxDaily(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
              <p className="text-xs text-gray-500 mt-1">
                Maximum top-ups per day (up to {bounds.maxDaily} — the strictest limit
                the registry, guard and vault enforce)
              </p>
            </div>
          </div>

          {/* Advanced Settings */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-700">Advanced Settings</h3>
            
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs text-gray-600">Auto-Topup Enabled</label>
                <p className="text-xs text-gray-500">Automatically refill when balance is low</p>
              </div>
              <button
                onClick={() => setAutoTopupEnabled(!autoTopupEnabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${autoTopupEnabled ? 'bg-emerald-500' : 'bg-gray-200'}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoTopupEnabled ? 'translate-x-6' : 'translate-x-1'}`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs text-gray-600">Notifications Enabled</label>
                <p className="text-xs text-gray-500">Receive top-up notifications</p>
              </div>
              <button
                onClick={() => setNotificationsEnabled(!notificationsEnabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${notificationsEnabled ? 'bg-emerald-500' : 'bg-gray-200'}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${notificationsEnabled ? 'translate-x-6' : 'translate-x-1'}`}
                />
              </button>
            </div>

            <div>
              <label className="block text-xs text-gray-600 mb-1">Risk Level</label>
              <select
                value={riskLevel}
                onChange={(e) => setRiskLevel(e.target.value as RiskLevel)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
              >
                <option value="low">Low - Conservative refilling</option>
                <option value="medium">Medium - Balanced approach</option>
                <option value="high">High - Aggressive refilling</option>
              </select>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs text-gray-600">Gas Optimization</label>
                <p className="text-xs text-gray-500">Optimize for gas efficiency</p>
              </div>
              <button
                onClick={() => setGasOptimization(!gasOptimization)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${gasOptimization ? 'bg-emerald-500' : 'bg-gray-200'}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${gasOptimization ? 'translate-x-6' : 'translate-x-1'}`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={saveUserConfiguration}
            disabled={isSaving || !walletAddress}
            className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? 'Saving...' : 'Save Configuration'}
          </button>
          <button
            onClick={resetToDefaults}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition"
          >
            Reset to Defaults
          </button>
          <button
            onClick={() => setSuccess(`Preview: threshold=${threshold}, target=${target}, cooldown=${cooldown}s, maxDaily=${maxDaily}, autoTopup=${autoTopupEnabled}, notifications=${notificationsEnabled}, risk=${riskLevel}, gasOpt=${gasOptimization}`)}
            className="px-4 py-2 bg-blue-50 text-blue-600 rounded-lg text-sm font-medium hover:bg-blue-100 transition"
          >
            Preview Configuration
          </button>
        </div>

        {walletAddress && (
          <div className="mt-4 p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500">
              Configured for: <span className="font-mono">{walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
