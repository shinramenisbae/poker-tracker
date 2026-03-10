import { useState } from 'react';
import { formatCurrency } from '../utils/calculations';

interface CashOutModalProps {
  playerName: string;
  currentBuyIn: number;
  onConfirm: (amount: number) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function CashOutModal({
  playerName,
  currentBuyIn,
  onConfirm,
  onCancel,
  isLoading = false,
}: CashOutModalProps) {
  const [amount, setAmount] = useState('');

  const handleConfirm = () => {
    if (isLoading) return;
    const numAmount = parseFloat(amount);
    if (!isNaN(numAmount) && numAmount >= 0) {
      onConfirm(numAmount);
    }
  };

  const quickAmounts = [0, currentBuyIn, currentBuyIn * 2];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
      <div className="bg-surface-primary w-full max-w-md sm:rounded-2xl rounded-t-2xl p-6 animate-in slide-in-from-bottom">
        <h2 className="text-xl font-semibold text-text-primary mb-2">
          Cash Out {playerName}
        </h2>
        <p className="text-text-secondary mb-6">
          Total buy-in: {formatCurrency(currentBuyIn)}
        </p>

        <div className="mb-6">
          <label className="block text-sm font-medium text-text-secondary mb-2">
            Final Amount
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary text-lg">$</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full h-16 pl-10 pr-4 text-2xl font-semibold bg-bg-tertiary rounded-xl border border-transparent focus:border-accent-primary focus:outline-none tabular-nums"
              autoFocus
              disabled={isLoading}
            />
          </div>
        </div>

        <div className="flex gap-2 mb-6">
          {quickAmounts.map((amt) => (
            <button
              key={amt}
              onClick={() => setAmount(amt.toString())}
              disabled={isLoading}
              className="flex-1 py-3 px-2 bg-bg-tertiary rounded-lg text-sm font-medium text-text-secondary hover:bg-bg-secondary transition-colors disabled:opacity-50"
            >
              {formatCurrency(amt)}
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="flex-1 btn-secondary h-14 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!amount || parseFloat(amount) < 0 || isLoading}
            className="flex-1 btn-primary h-14 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isLoading && <span className="animate-spin">🎲</span>}
            {isLoading ? 'Processing...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
