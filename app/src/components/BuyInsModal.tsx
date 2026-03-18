import { useState } from 'react';
import type { Player, BuyIn } from '../types';
import { formatCurrency, getTotalBuyIn } from '../utils/calculations';

interface BuyInsModalProps {
  player: Player;
  onUpdateBuyIn: (buyInId: string, amount: number, method: 'cash' | 'bank') => void;
  onDeleteBuyIn: (buyInId: string) => void;
  onClose: () => void;
  isLoading?: boolean;
}

export function BuyInsModal({
  player,
  onUpdateBuyIn,
  onDeleteBuyIn,
  onClose,
  isLoading = false,
}: BuyInsModalProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editMethod, setEditMethod] = useState<'cash' | 'bank'>('cash');

  const startEdit = (buyIn: BuyIn) => {
    setEditingId(buyIn.id);
    setEditAmount(buyIn.amount.toString());
    setEditMethod(buyIn.method || 'cash');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditAmount('');
  };

  const saveEdit = (buyInId: string) => {
    const amount = parseFloat(editAmount);
    if (isNaN(amount) || amount <= 0) return;
    onUpdateBuyIn(buyInId, amount, editMethod);
    setEditingId(null);
    setEditAmount('');
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
      <div className="bg-surface-primary w-full max-w-md sm:rounded-2xl rounded-t-2xl p-6 max-h-[80vh] flex flex-col">
        <h2 className="text-xl font-semibold text-text-primary mb-1">
          {player.name}'s Buy-ins
        </h2>
        <p className="text-text-secondary mb-4">
          Total: {formatCurrency(getTotalBuyIn(player))}
        </p>

        <div className="flex-1 overflow-y-auto space-y-2 mb-4">
          {player.buyIns.length === 0 ? (
            <p className="text-text-tertiary text-center py-4">No buy-ins yet</p>
          ) : (
            player.buyIns.map((buyIn, index) => (
              <div
                key={buyIn.id}
                className="bg-bg-tertiary rounded-lg p-3"
              >
                {editingId === buyIn.id ? (
                  <div className="space-y-2">
                    <div className="flex gap-1 bg-bg-secondary rounded-lg p-0.5">
                      <button
                        onClick={() => setEditMethod('cash')}
                        className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                          editMethod === 'cash'
                            ? 'bg-accent-amber text-white shadow-sm'
                            : 'text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        Cash
                      </button>
                      <button
                        onClick={() => setEditMethod('bank')}
                        className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                          editMethod === 'bank'
                            ? 'bg-accent-primary text-white shadow-sm'
                            : 'text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        Bank
                      </button>
                    </div>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary">$</span>
                      <input
                        type="number"
                        value={editAmount}
                        onChange={(e) => setEditAmount(e.target.value)}
                        className="w-full h-10 pl-8 pr-3 text-lg font-semibold bg-bg-secondary rounded-lg border border-transparent focus:border-accent-primary focus:outline-none tabular-nums"
                        autoFocus
                        disabled={isLoading}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={cancelEdit}
                        disabled={isLoading}
                        className="flex-1 btn-secondary h-9 text-sm disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => saveEdit(buyIn.id)}
                        disabled={!editAmount || parseFloat(editAmount) <= 0 || isLoading}
                        className="flex-1 btn-primary h-9 text-sm disabled:opacity-50"
                      >
                        {isLoading ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-text-primary tabular-nums">
                        {formatCurrency(buyIn.amount)}
                      </span>
                      <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${
                        (buyIn.method || 'cash') === 'cash'
                          ? 'bg-accent-amber/20 text-accent-amber'
                          : 'bg-accent-primary/20 text-accent-primary'
                      }`}>
                        {(buyIn.method || 'cash')}
                      </span>
                      <span className="text-xs text-text-tertiary ml-2">
                        #{index + 1}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => startEdit(buyIn)}
                        disabled={isLoading}
                        className="px-3 py-1.5 text-sm text-accent-primary hover:bg-accent-primary/10 rounded-lg transition-colors disabled:opacity-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => onDeleteBuyIn(buyIn.id)}
                        disabled={isLoading}
                        className="px-3 py-1.5 text-sm text-accent-negative hover:bg-accent-negative/10 rounded-lg transition-colors disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <button
          onClick={onClose}
          className="w-full btn-secondary h-12"
        >
          Close
        </button>
      </div>
    </div>
  );
}
