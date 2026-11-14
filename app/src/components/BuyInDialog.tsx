import { useState } from 'react';
import type { BuyInMethod, Player } from '../types';
import { formatCurrency } from '../utils/calculations';

export interface BuyInDetails {
  amount: number;
  method: BuyInMethod;
  rebuy: { isRebuy?: boolean; rebuyType?: 'top-up' | 'stacked'; stackedHand?: string };
}

interface BuyInDialogProps {
  player: Player;
  /** Prefilled by a quick +$ button; empty for Custom. */
  initialAmount?: number;
  /** Whatever the player's card was set to. */
  initialMethod: BuyInMethod;
  /** Resolves true once saved; on false the dialog stays open with what was typed. */
  onSubmit: (details: BuyInDetails) => Promise<boolean>;
  onCancel: () => void;
  isLoading?: boolean;
}

const METHODS: { value: BuyInMethod; label: string; active: string }[] = [
  { value: 'cash', label: 'Cash', active: 'bg-accent-amber text-white shadow-sm' },
  { value: 'bank', label: 'Bank', active: 'bg-accent-primary text-white shadow-sm' },
  { value: 'credit', label: 'Credit', active: 'bg-accent-positive text-white shadow-sm' },
];

/**
 * Every buy-in that needs more than one tap: a custom amount, or any rebuy.
 * After the first buy-in it asks whether it was a top-up or after getting
 * stacked, and either way takes an optional note.
 */
export function BuyInDialog({ player, initialAmount, initialMethod, onSubmit, onCancel, isLoading = false }: BuyInDialogProps) {
  const [method, setMethod] = useState<BuyInMethod>(initialMethod);
  const [amountText, setAmountText] = useState(initialAmount ? String(initialAmount) : '');
  const [rebuyType, setRebuyType] = useState<'top-up' | 'stacked'>('top-up');
  const [note, setNote] = useState('');

  const isRebuy = player.buyIns.length > 0;
  const amount = parseFloat(amountText);
  const valid = Number.isFinite(amount) && amount > 0;

  const submit = async () => {
    if (!valid || isLoading) return;
    await onSubmit({
      amount,
      method,
      rebuy: {
        ...(isRebuy ? { isRebuy: true, rebuyType } : {}),
        ...(note.trim() ? { stackedHand: note.trim() } : {}),
      },
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
      <div role="dialog" aria-label={`Buy-in for ${player.name}`} className="bg-surface-primary w-full max-w-md sm:rounded-2xl rounded-t-2xl p-6">
        <h2 className="text-xl font-semibold text-text-primary mb-4">
          {player.name} — {isRebuy ? 'Rebuy' : 'Buy-in'}
        </h2>

        <div className="flex gap-1 bg-bg-tertiary rounded-lg p-0.5 mb-4">
          {METHODS.map((m) => (
            <button
              key={m.value}
              onClick={() => setMethod(m.value)}
              disabled={isLoading}
              aria-pressed={method === m.value}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                method === m.value ? m.active : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="mb-4">
          <label htmlFor="buyin-amount" className="block text-sm font-medium text-text-secondary mb-2">Amount</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary text-lg">$</span>
            <input
              id="buyin-amount"
              type="number"
              inputMode="decimal"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              placeholder="0.00"
              className="w-full h-14 pl-10 pr-4 text-2xl font-semibold bg-bg-tertiary rounded-xl border border-transparent focus:border-accent-primary focus:outline-none tabular-nums"
              autoFocus={!initialAmount}
              disabled={isLoading}
            />
          </div>
        </div>

        {isRebuy && (
          <div className="flex gap-1 bg-bg-tertiary rounded-lg p-0.5 mb-4">
            <button
              onClick={() => setRebuyType('top-up')}
              disabled={isLoading}
              aria-pressed={rebuyType === 'top-up'}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                rebuyType === 'top-up' ? 'bg-accent-primary text-white shadow-sm' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Top-up
            </button>
            <button
              onClick={() => setRebuyType('stacked')}
              disabled={isLoading}
              aria-pressed={rebuyType === 'stacked'}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                rebuyType === 'stacked' ? 'bg-accent-negative text-white shadow-sm' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Got stacked
            </button>
          </div>
        )}

        <div className="mb-6">
          <label htmlFor="buyin-note" className="block text-sm font-medium text-text-secondary mb-2">Note (optional)</label>
          <input
            id="buyin-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="e.g. AA vs KK"
            className="input w-full"
            disabled={isLoading}
          />
        </div>

        <div className="flex gap-3">
          {/* Cancel waits for the save: it can't abort the request, so allowing
              it mid-flight invites a re-tap and a duplicate buy-in. */}
          <button onClick={onCancel} disabled={isLoading} className="flex-1 btn-secondary disabled:opacity-50">
            Cancel
          </button>
          <button onClick={submit} disabled={!valid || isLoading} className="flex-1 btn-primary disabled:opacity-50">
            {isLoading ? 'Adding...' : valid ? `Add ${formatCurrency(amount)} ${method}` : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
