import React, { useState } from 'react';
import { SubAccount } from '../hooks/useSubAccount';

interface SubAccountCardProps {
  account: SubAccount;
  onUpdate: (address: string, updates: Partial<SubAccount>) => void;
  onDelete: (address: string) => void;
}

const SubAccountCard: React.FC<SubAccountCardProps> = ({ account, onUpdate, onDelete }) => {
  const [isEditing, setIsEditing] = useState(false);

  const formatBalance = (balance: string) => {
    const num = parseFloat(balance);
    if (num === 0) return '0';
    if (num < 0.001) return '<0.001';
    if (num < 1) return num.toFixed(3);
    return num.toFixed(2);
  };

  return (
    <div className="sub-account-card">
      <div className="card-header">
        <div className="account-info">
          <div className="account-address">
            {account.address.slice(0, 6)}...{account.address.slice(-4)}
          </div>
          <div className="status-indicator" style={{ backgroundColor: account.isActive ? '#10b981' : '#ef4444' }} />
        </div>
        <div className="card-actions">
          <button
            onClick={() => setIsEditing(!isEditing)}
            className="action-button edit"
          >
            Edit
          </button>
          <button
            onClick={() => onDelete(account.address)}
            className="action-button delete"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="card-content">
        <div className="detail-row">
          <span className="label">Main Vault:</span>
          <span className="value">{account.mainVault.slice(0, 6)}...{account.mainVault.slice(-4)}</span>
        </div>
        <div className="detail-row">
          <span className="label">Threshold:</span>
          <span className="value">{formatBalance(account.threshold)} ETH</span>
        </div>
        <div className="detail-row">
          <span className="label">Target:</span>
          <span className="value">{account.target} ETH</span>
        </div>
        <div className="detail-row">
          <span className="label">Cooldown:</span>
          <span className="value">{account.cooldown}s</span>
        </div>
        <div className="detail-row">
          <span className="label">Max Daily:</span>
          <span className="value">{account.maxDaily}</span>
        </div>
      </div>
      <style>{`
        .sub-account-card {
          background: white;
          border-radius: 8px;
          padding: 16px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          transition: transform 0.2s;
        }
        .sub-account-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
        }
        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 16px;
        }
        .account-info {
          flex: 1;
        }
        .account-address {
          font-family: 'Monaco', monospace;
          font-size: 14px;
          color: #333;
          margin-bottom: 8px;
        }
        .status-indicator {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          display: inline-block;
        }
        .card-actions {
          display: flex;
          gap: 8px;
        }
        .action-button {
          padding: 4px 8px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          transition: background-color 0.2s;
        }
        .action-button.edit {
          background: #e0f2fe;
          color: #0369a1;
        }
        .action-button.edit:hover {
          background: #bae6fd;
        }
        .action-button.delete {
          background: #fee2e2;
          color: #991b1b;
        }
        .action-button.delete:hover {
          background: #fca5a5;
        }
        .card-content {
          margin-top: 16px;
        }
        .detail-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }
        .detail-row .label {
          font-size: 12px;
          color: #666;
        }
        .detail-row .value {
          font-size: 12px;
          font-weight: 600;
          color: #333;
        }
      `}</style>
    </div>
  );
};

export default SubAccountCard;
