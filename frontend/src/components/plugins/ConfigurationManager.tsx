import React, { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { ConfigurationPanel } from './ConfigurationPanel';
import SubAccountCard from '../../plugins/setForget/components/SubAccountCard';
import { useSubAccount, SubAccount } from '../../plugins/setForget/hooks/useSubAccount';
import { useReactive } from '../../plugins/setForget/hooks/useReactive';
import { useConfiguration } from '../../plugins/setForget/hooks/useConfiguration';
import { DEFAULT_PREFERENCES, UserPreferenceValues } from '../../plugins/setForget/config';
import { SET_FORGET_CONTRACTS, CHAIN_CONFIG } from '../../config/contracts';

export interface UserConfiguration extends SubAccount {
  // SubAccount already carries address/threshold/target/cooldown/maxDaily and timestamps.
}

export interface UserPreferences extends UserPreferenceValues {
  lastUpdated: number;
}

export const ConfigurationManager: React.FC = () => {
  const { address: walletAddress } = useAccount();
  const [userConfigurations, setUserConfigurations] = useState<UserConfiguration[]>([]);
  const [userPreferences, setUserPreferences] = useState<UserPreferences | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'core' | 'advanced' | 'history'>('core');
  const [showConfigurationPanel, setShowConfigurationPanel] = useState(false);

  const { fetchSubAccounts, updateSubAccount, deleteSubAccount } = useSubAccount();
  const { status: reactiveStatus } = useReactive();
  const { preferences: storedPreferences, history, loadPreferences, savePreferences, loadHistory } = useConfiguration();

  useEffect(() => {
    if (walletAddress) {
      loadUserData();
    }
  }, [walletAddress]);

  const loadUserData = async () => {
    if (!walletAddress) return;
    
    try {
      setIsLoading(true);
      
      // Load user's sub-account configurations
      const subAccounts = await fetchSubAccounts();
      const userConfigs = subAccounts.filter((acc: UserConfiguration) =>
        acc.address.toLowerCase() === walletAddress.toLowerCase()
      );
      setUserConfigurations(userConfigs);

      // Per-user preferences are stored on the worker; the browser copy is a
      // fallback for when the plugin API is unreachable.
      const stored = await loadPreferences(walletAddress);
      if (stored) {
        setUserPreferences(stored);
        return;
      }

      const savedPrefs = localStorage.getItem(`user-config-${walletAddress}`);
      if (savedPrefs) {
        setUserPreferences(JSON.parse(savedPrefs));
      } else {
        setUserPreferences({
          ...DEFAULT_PREFERENCES,
          lastUpdated: Date.now(),
        });
      }
      
    } catch (error) {
      console.error('Failed to load user data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'history' && walletAddress) {
      loadHistory(walletAddress);
    }
  }, [activeTab, walletAddress]);

  const handleConfigurationChange = (newPrefs: Partial<UserPreferences>) => {
    if (!walletAddress) return;
    
    const updatedPrefs = {
      ...DEFAULT_PREFERENCES,
      ...userPreferences,
      ...newPrefs,
      lastUpdated: Date.now(),
    } as UserPreferences;
    
    setUserPreferences(updatedPrefs);
    localStorage.setItem(`user-config-${walletAddress}`, JSON.stringify(updatedPrefs));
    savePreferences(walletAddress, updatedPrefs).catch((error) => {
      console.error('Failed to persist preferences:', error);
    });
  };

  const handleSubAccountUpdate = async (address: string, updates: Partial<UserConfiguration>) => {
    try {
      await updateSubAccount(address, updates);
      setUserConfigurations(prev =>
        prev.map(acc => (acc.address === address ? { ...acc, ...updates } : acc))
      );
    } catch (error) {
      console.error('Failed to update sub-account:', error);
      throw error;
    }
  };

  const handleSubAccountDelete = async (address: string) => {
    try {
      await deleteSubAccount(address);
      setUserConfigurations(prev => prev.filter(acc => acc.address !== address));
    } catch (error) {
      console.error('Failed to delete sub-account:', error);
      throw error;
    }
  };

  const formatBalance = (balance: string) => {
    const num = parseFloat(balance);
    if (!Number.isFinite(num)) return '0';
    if (num === 0) return '0';
    if (num < 0.001) return '<0.001';
    if (num < 1) return num.toFixed(3);
    return num.toFixed(2);
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'low': return 'bg-green-100 text-green-600';
      case 'medium': return 'bg-yellow-100 text-yellow-600';
      case 'high': return 'bg-red-100 text-red-600';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold">Per-User Configuration Management</h1>
          <span className="text-sm text-gray-500">
            {walletAddress ? `Connected: ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : 'Not connected'}
          </span>
        </div>
        
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('core')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'core' 
              ? 'bg-emerald-500 text-white' 
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Core Settings
          </button>
          <button
            onClick={() => setActiveTab('advanced')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'advanced' 
              ? 'bg-emerald-500 text-white' 
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Advanced Settings
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'history' 
              ? 'bg-emerald-500 text-white' 
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Configuration History
          </button>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'core' && (
        <div className="space-y-4">
          <ConfigurationPanel
            onConfigurationChange={handleConfigurationChange}
            userAddress={walletAddress}
          />
        </div>
      )}

      {activeTab === 'advanced' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold mb-4">Advanced Configuration Options</h2>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div>
                  <h3 className="font-medium">Auto-Topup Settings</h3>
                  <p className="text-sm text-gray-500">Configure automatic top-up behavior</p>
                </div>
                <button
                  onClick={() => setShowConfigurationPanel(!showConfigurationPanel)}
                  className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-600 transition"
                >
                  {showConfigurationPanel ? 'Hide' : 'Configure'}
                </button>
              </div>
              
              {showConfigurationPanel && (
                <div className="p-4 bg-blue-50 rounded-lg">
                  <p className="text-sm text-blue-600">
                    Advanced configuration options will be displayed here. This includes:
                  </p>
                  <ul className="text-sm text-blue-600 mt-2 space-y-1">
                    <li>• Custom refill strategies</li>
                    <li>• Emergency override settings</li>
                    <li>• Cross-chain priority settings</li>
                    <li>• Integration with external services</li>
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold mb-4">Configuration History</h2>

            {!walletAddress ? (
              <p className="text-gray-500">Connect your wallet to view your configuration history.</p>
            ) : history.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500">No configuration changes recorded yet.</p>
                <p className="text-sm text-gray-400 mt-2">
                  Changes to your threshold, target, cooldown and daily limit are stored per user.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {history.map((entry) => (
                  <li key={entry.id} className="py-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-700">{entry.settingKey}</p>
                      <p className="text-xs text-gray-500">
                        {entry.oldValue ?? '—'} → {entry.newValue ?? '—'}
                      </p>
                    </div>
                    <span className="text-xs text-gray-400">
                      {new Date(entry.timestamp * 1000).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* User Configurations List */}
      {walletAddress && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">Your Sub-Account Configurations</h2>
          
          {isLoading ? (
            <p className="text-center text-gray-500 py-4">Loading configurations...</p>
          ) : userConfigurations.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">No sub-account configurations found.</p>
              <p className="text-sm text-gray-400 mt-2">
                Create a sub-account to get started with per-user configuration management.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {userConfigurations.map((config) => (
                <SubAccountCard
                  key={config.address}
                  account={config}
                  onUpdate={handleSubAccountUpdate}
                  onDelete={handleSubAccountDelete}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* User Preferences Display */}
      {userPreferences && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">Current User Preferences</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <span className="text-sm text-gray-600">Auto-Topup</span>
              <span className={`text-sm font-medium ${userPreferences.autoTopupEnabled ? 'text-emerald-600' : 'text-gray-400'}`}>
                {userPreferences.autoTopupEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <span className="text-sm text-gray-600">Notifications</span>
              <span className={`text-sm font-medium ${userPreferences.notificationsEnabled ? 'text-emerald-600' : 'text-gray-400'}`}>
                {userPreferences.notificationsEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <span className="text-sm text-gray-600">Risk Level</span>
              <span className={`text-sm px-2 py-1 rounded-full ${getRiskColor(userPreferences.riskLevel)}`}>
                {userPreferences.riskLevel.charAt(0).toUpperCase() + userPreferences.riskLevel.slice(1)}
              </span>
            </div>
            
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <span className="text-sm text-gray-600">Gas Optimization</span>
              <span className={`text-sm font-medium ${userPreferences.gasOptimization ? 'text-emerald-600' : 'text-gray-400'}`}>
                {userPreferences.gasOptimization ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          </div>
          
          <p className="text-xs text-gray-500 mt-4">
            Last updated: {new Date(userPreferences.lastUpdated).toLocaleString()}
          </p>
               </div>
      )}
    </div>
  );
};
