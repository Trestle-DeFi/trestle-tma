import React, { useState, useEffect, useCallback } from 'react';
import { useSubAccount, SubAccount, SubAccountData } from './hooks/useSubAccount';
import { useReactive } from './hooks/useReactive';
import SubAccountCard from './components/SubAccountCard';

const SetForgetPlugin: React.FC = () => {
  const [subAccounts, setSubAccounts] = useState<SubAccount[]>([]);
  const [isPluginEnabled, setPluginEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  const { fetchSubAccounts: fetchSubAccountsFn, createSubAccount, updateSubAccount, deleteSubAccount } = useSubAccount();
  const { status: reactiveStatus, setupSubscription } = useReactive();
  
  useEffect(() => {
    if (isPluginEnabled && !subAccounts.length) {
      loadSubAccounts();
      loadReactiveStatus();
    }
  }, [isPluginEnabled]);
  
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
      console.error('Failed to setup reactive subscription:', error);
    }
  }, [setupSubscription]);
  
  const handleCreateSubAccount = useCallback(async (subAccountData: SubAccountData) => {
    try {
      setIsLoading(true);
      const newSubAccount = await createSubAccount(subAccountData);
      setSubAccounts(prev => [...prev, newSubAccount]);
      return newSubAccount;
    } catch (error) {
      console.error('Failed to create sub-account:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [createSubAccount]);
  
  const handleUpdateSubAccount = useCallback(async (address: string, updates: Partial<SubAccountData>) => {
    try {
      setIsLoading(true);
      await updateSubAccount(address, updates);
      setSubAccounts(prev => prev.map(acc => acc.address === address ? { ...acc, ...updates } : acc));
    } catch (error) {
      console.error('Failed to update sub-account:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [updateSubAccount]);
  
  const handleDeleteSubAccount = useCallback(async (address: string) => {
    try {
      setIsLoading(true);
      await deleteSubAccount(address);
      setSubAccounts(prev => prev.filter(acc => acc.address !== address));
    } catch (error) {
      console.error('Failed to delete sub-account:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [deleteSubAccount]);
  
  return (
    <div className="set-forget-plugin">
      <div className="plugin-header">
        <h2>Set & Forget Auto-Topup</h2>
        <div className="plugin-controls">
          <button
            onClick={() => setPluginEnabled(!isPluginEnabled)}
            className={`toggle-button ${isPluginEnabled ? 'enabled' : 'disabled'}`}
            disabled={isLoading}
          >
            {isPluginEnabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>
      </div>
      
      {isLoading && (
        <div className="loading-overlay">
          <div className="spinner"></div>
        </div>
      )}
      
      {isPluginEnabled && (
        <div className="plugin-content">
          <div className="status-panel">
            <h3>Reactive Network Status</h3>
            <div className="status-metrics">
              <div className="metric">
                <span className="label">Active Subscriptions:</span>
                <span className="value">{reactiveStatus.subscriptionCount}</span>
              </div>
              <div className="metric">
                <span className="label">Last Trigger:</span>
                <span className="value">{reactiveStatus.lastTrigger || 'Never'}</span>
              </div>
              <div className="metric">
                <span className="label">Pending Actions:</span>
                <span className="value">{reactiveStatus.pendingCount}</span>
              </div>
            </div>
          </div>
          
          <div className="subaccounts-section">
            <div className="section-header">
              <h3>Operational Sub-Accounts</h3>
              <button
                onClick={() => {}}
                className="create-button"
                disabled={isLoading}
              >
                + Add Sub-Account
              </button>
            </div>
            
            {subAccounts.length === 0 ? (
              <div className="empty-state">
                <p>No sub-accounts configured. Create one to get started.</p>
                <button
                  onClick={() => {}}
                  className="primary-button"
                >
                  Create First Sub-Account
                </button>
              </div>
            ) : (
              <div className="subaccounts-grid">
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
    </div>
  );
};

export default SetForgetPlugin;
