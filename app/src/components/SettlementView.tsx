import type { SettlementSummary } from '../types';
import { formatCurrency } from '../utils/calculations';

interface SettlementViewProps {
  summary: SettlementSummary;
}

export function SettlementView({ summary }: SettlementViewProps) {
  const nonBankSettlements = summary.settlements.filter(
    (s) => s.playerId !== summary.bankPlayerId
  );
  const winners = nonBankSettlements.filter((s) => s.profitLoss > 0);
  const losers = nonBankSettlements.filter((s) => s.profitLoss < 0);
  const even = nonBankSettlements.filter((s) => s.profitLoss === 0);
  const bankSettlement = summary.settlements.find(
    (s) => s.playerId === summary.bankPlayerId
  );

  return (
    <div className="space-y-6">
      {/* Bank Player Info */}
      <div className="card bg-accent-primary/10 border border-accent-primary/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🏦</span>
            <div>
              <p className="text-sm text-text-secondary">Bank Player</p>
              <p className="text-lg font-semibold text-text-primary">
                {summary.bankPlayerName}
              </p>
            </div>
          </div>
          {bankSettlement && (
            <p
              className={`text-number-md tabular-nums font-bold ${
                bankSettlement.profitLoss >= 0 ? 'profit' : 'loss'
              }`}
            >
              {bankSettlement.profitLoss > 0 ? '+' : ''}
              {formatCurrency(bankSettlement.profitLoss)}
            </p>
          )}
        </div>
      </div>

      {/* Winners */}
      {winners.length > 0 && (
        <div className="card border-l-4 border-l-accent-positive">
          <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
            Winners
          </h3>
          <div className="space-y-2">
            {winners.map((s) => (
              <div key={s.playerId} className="flex items-center justify-between py-2">
                <span className="font-medium text-text-primary">{s.playerName}</span>
                <span className="text-number-sm profit tabular-nums">
                  +{formatCurrency(s.profitLoss)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Breaking Even */}
      {even.length > 0 && (
        <div className="card border-l-4 border-l-text-tertiary">
          <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
            Breaking Even
          </h3>
          <div className="space-y-2">
            {even.map((s) => (
              <div key={s.playerId} className="flex items-center justify-between py-2">
                <span className="font-medium text-text-primary">{s.playerName}</span>
                <span className="text-number-sm text-text-secondary tabular-nums">
                  {formatCurrency(0)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Losers */}
      {losers.length > 0 && (
        <div className="card border-l-4 border-l-accent-negative">
          <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
            Owes Money
          </h3>
          <div className="space-y-2">
            {losers.map((s) => (
              <div key={s.playerId} className="flex items-center justify-between py-2">
                <span className="font-medium text-text-primary">{s.playerName}</span>
                <span className="text-number-sm loss tabular-nums">
                  {formatCurrency(s.profitLoss)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Settlement Details */}
      <div className="card">
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-4">
          Cash on Table
        </h3>
        <p className="text-number-md text-text-primary tabular-nums mb-1">
          {formatCurrency(summary.cashToCollect)}
        </p>
        <p className="text-xs text-text-tertiary">
          Total cash buy-ins from all players
        </p>

        {summary.bankTransfersIn > 0 && (
          <div className="mt-4 pt-4 border-t border-bg-tertiary">
            <p className="text-sm text-text-secondary mb-1">Bank Transfers to Collect</p>
            <p className="text-number-sm text-accent-primary tabular-nums">
              {formatCurrency(summary.bankTransfersIn)}
            </p>
            <p className="text-xs text-text-tertiary mt-1">
              From losers with bank buy-ins
            </p>
          </div>
        )}
      </div>

      {/* Who Pays Who */}
      <div className="card bg-accent-primary/5">
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-4">
          Who Pays Who
        </h3>
        <div className="space-y-3">
          {nonBankSettlements
            .filter((s) => s.profitLoss !== 0 || s.cashReceived > 0 || s.bankReceived > 0 || s.bankOwed > 0)
            .map((s) => {
              // Cash-only loser: their cash is already on the table, bank keeps it
              const cashLostOnTable = s.profitLoss < 0 && s.cashReceived === 0 && s.bankOwed === 0;

              return (
                <div
                  key={s.playerId}
                  className="py-2 border-b border-bg-tertiary last:border-0"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-text-primary">{s.playerName}</span>
                    <span
                      className={`font-bold tabular-nums ${
                        s.profitLoss >= 0 ? 'profit' : 'loss'
                      }`}
                    >
                      {s.profitLoss > 0 ? '+' : ''}
                      {formatCurrency(s.profitLoss)}
                    </span>
                  </div>
                  <div className="text-sm text-text-secondary space-y-0.5">
                    {s.cashReceived > 0 && (
                      <p>
                        <span className="text-text-tertiary">{summary.bankPlayerName} gives</span>{' '}
                        <span className="font-medium">{formatCurrency(s.cashReceived)}</span>{' '}
                        <span className="px-1.5 py-0.5 rounded-full text-xs bg-accent-amber/20 text-accent-amber">cash</span>
                      </p>
                    )}
                    {s.bankReceived > 0 && (
                      <p>
                        <span className="text-text-tertiary">{summary.bankPlayerName} transfers</span>{' '}
                        <span className="font-medium">{formatCurrency(s.bankReceived)}</span>{' '}
                        <span className="px-1.5 py-0.5 rounded-full text-xs bg-accent-primary/20 text-accent-primary">bank</span>
                      </p>
                    )}
                    {s.bankOwed > 0 && (
                      <p>
                        <span className="text-text-tertiary">{s.playerName} transfers</span>{' '}
                        <span className="font-medium">{formatCurrency(s.bankOwed)}</span>{' '}
                        <span className="px-1.5 py-0.5 rounded-full text-xs bg-accent-primary/20 text-accent-primary">bank</span>
                        <span className="text-text-tertiary"> to {summary.bankPlayerName}</span>
                      </p>
                    )}
                    {cashLostOnTable && (
                      <p>
                        <span className="text-text-tertiary">
                          {summary.bankPlayerName} keeps {formatCurrency(Math.abs(s.profitLoss))} from cash on table
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
