import { useState } from 'react';
import type { Player } from '../types';
import { getTotalBuyIn, getProfitLoss, formatCurrency } from '../utils/calculations';

interface PlayerRowProps {
  player: Player;
  onAddBuyIn: (amount: number, method: 'cash' | 'bank') => void;
  onCashOut: () => void;
  onEditBuyIns?: () => void;
  showCustomBuyIn?: (method: 'cash' | 'bank') => void;
  disabled?: boolean;
}

export function PlayerRow({
  player,
  onAddBuyIn,
  onCashOut,
  onEditBuyIns,
  showCustomBuyIn,
  disabled = false,
}: PlayerRowProps) {
  const [buyInMethod, setBuyInMethod] = useState<'cash' | 'bank'>('cash');
  const totalBuyIn = getTotalBuyIn(player);
  const profitLoss = getProfitLoss(player);
  const isCashedOut = player.cashOut !== null;
  const buyInCount = player.buyIns.length;

  const cashTotal = player.buyIns
    .filter((b) => (b.method || 'cash') === 'cash')
    .reduce((sum, b) => sum + b.amount, 0);
  const bankTotal = player.buyIns
    .filter((b) => b.method === 'bank')
    .reduce((sum, b) => sum + b.amount, 0);

  return (
    <div
      className={`bg-surface-secondary rounded-xl p-4 transition-opacity ${
        isCashedOut ? 'opacity-70' : ''
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-bg-tertiary flex items-center justify-center text-lg">
            👤
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-semibold text-text-primary">{player.name}</h4>
              {isCashedOut && (
                <span className="text-green-600 text-lg">✓</span>
              )}
            </div>
            <div className="text-sm text-text-secondary">
              <span className="tabular-nums">
                {buyInCount} buy-in{buyInCount !== 1 ? 's' : ''}: {formatCurrency(totalBuyIn)}
              </span>
              {buyInCount > 0 && (
                <span className="text-xs text-text-tertiary ml-1">
                  ({cashTotal > 0 ? `${formatCurrency(cashTotal)} cash` : ''}
                  {cashTotal > 0 && bankTotal > 0 ? ' + ' : ''}
                  {bankTotal > 0 ? `${formatCurrency(bankTotal)} bank` : ''})
                </span>
              )}
            </div>
          </div>
        </div>

        {profitLoss !== null && (
          <div className="text-right">
            <p
              className={`text-number-md tabular-nums ${
                profitLoss >= 0 ? 'profit' : 'loss'
              }`}
            >
              {profitLoss > 0 ? '+' : ''}
              {formatCurrency(profitLoss)}
            </p>
            <p className="text-sm text-text-tertiary">
              Out: {formatCurrency(player.cashOut?.amount || 0)}
            </p>
          </div>
        )}
      </div>

      {!isCashedOut ? (
        <div className="space-y-2 mt-3">
          {/* Cash/Bank toggle */}
          <div className="flex gap-1 bg-bg-tertiary rounded-lg p-0.5">
            <button
              onClick={() => setBuyInMethod('cash')}
              disabled={disabled}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                buyInMethod === 'cash'
                  ? 'bg-accent-amber text-white shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Cash
            </button>
            <button
              onClick={() => setBuyInMethod('bank')}
              disabled={disabled}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                buyInMethod === 'bank'
                  ? 'bg-accent-primary text-white shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Bank
            </button>
          </div>
          {/* Buy-in buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => onAddBuyIn(50, buyInMethod)}
              disabled={disabled}
              className="flex-1 btn-secondary h-11 text-sm disabled:opacity-50"
            >
              +$50
            </button>
            <button
              onClick={() => onAddBuyIn(100, buyInMethod)}
              disabled={disabled}
              className="flex-1 btn-secondary h-11 text-sm disabled:opacity-50"
            >
              +$100
            </button>
            <button
              onClick={() => showCustomBuyIn?.(buyInMethod)}
              disabled={disabled}
              className="flex-1 btn-secondary h-11 text-sm disabled:opacity-50"
            >
              Custom
            </button>
            <button
              onClick={onCashOut}
              disabled={disabled}
              className="flex-1 btn-primary h-11 text-sm disabled:opacity-50"
            >
              Cash Out
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2 mt-3">
          <button
            onClick={onCashOut}
            disabled={disabled}
            className="flex-1 btn-secondary h-11 text-sm disabled:opacity-50"
          >
            Edit Cash Out
          </button>
          <button
            onClick={onEditBuyIns}
            disabled={disabled}
            className="flex-1 btn-ghost h-11 text-sm disabled:opacity-50"
          >
            View Buy-ins
          </button>
        </div>
      )}
    </div>
  );
}
