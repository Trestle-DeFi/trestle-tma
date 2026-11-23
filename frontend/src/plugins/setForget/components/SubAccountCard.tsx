import React from 'react';
import { SubAccount } from '../hooks/useSubAccount';

interface SubAccountCardProps {
  account: SubAccount;
  onUpdate: (address: string, updates: Partial<SubAccount>) => void;
  onDelete: (address: string) => void;
  onActivate?: (account: SubAccount) => void;
}

const short = (addr: string) =>
  addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '—';

const SubAccountCard: React.FC<SubAccountCardProps> = ({ account, onUpdate, onDelete, onActivate }) => {
  const formatBalance = (balance: string) => {
    const num = parseFloat(balance);
    if (!Number.isFinite(num)) return '0';
    if (num === 0) return '0';
    if (num < 0.001) return '<0.001';
    if (num < 1) return num.toFixed(3);
    return num.toFixed(2);
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            data-testid="status-dot"
            className={`w-2 h-2 rounded-full shrink-0 ${account.isActive ? 'bg-emerald-500' : 'bg-red-400'}`}
          />
          <span className="font-mono text-xs text-gray-700 truncate">
            {short(account.address)}
          </span>
          {!account.isActive && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-500">
              Inactive
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() =>
              onUpdate(account.address, { isActive: !account.isActive })
            }
            className="text-[11px] px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 transition"
          >
            {account.isActive ? 'Pause' : 'Resume'}
          </button>
          <button
            onClick={() => onDelete(account.address)}
            className="text-[11px] px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100 transition"
          >
            Delete
          </button>
          {onActivate && (
            <button
              onClick={() => onActivate(account)}
              className="text-[11px] px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition"
            >
              Activate Auto-Topup
            </button>
          )}
        </div>
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500">Main Vault</dt>
          <dd className="font-mono text-gray-700 truncate">{short(account.mainVault)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500">Threshold</dt>
          <dd className="text-gray-700 font-medium">{formatBalance(account.threshold)} ETH</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500">Target</dt>
          <dd className="text-gray-700 font-medium">{formatBalance(account.target)} ETH</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500">Cooldown</dt>
          <dd className="text-gray-700 font-medium">{account.cooldown}s</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500">Max Daily</dt>
          <dd className="text-gray-700 font-medium">{account.maxDaily}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500">Spent Today</dt>
          <dd className="text-gray-700 font-medium">{account.totalSpentToday}</dd>
        </div>
      </dl>
    </div>
  );
};

export default SubAccountCard;
