import { useState } from 'react';
import type { Settlement, SettlementSummary } from '../types';
import { formatCurrency, suggestCash, transferAfterCash } from '../utils/calculations';

interface CashPayoutsProps {
  summary: SettlementSummary;
  onSave: (amounts: Record<string, number>) => Promise<{ discord?: { ok: boolean; error?: string } }>;
}

/**
 * The banker decides who takes cash, in $50s, because only someone in the room
 * knows who is still there. The difference is settled by transfer either way.
 */
export function CashPayouts({ summary, onSave }: CashPayoutsProps) {
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  const rows = summary.settlements.filter((s) => s.playerId !== summary.bankPlayerId && s.netWithBank > 0);
  if (rows.length === 0) return null;

  const recorded = (s: Settlement) => (summary.cashMode === 'saved' ? s.cashReceived : suggestCash(s));
  const cashFor = (s: Settlement) => draft[s.playerId] ?? recorded(s);
  const unsaved = summary.cashMode !== 'saved' || rows.some((s) => cashFor(s) !== s.cashReceived);

  const handedOut = rows.reduce((sum, s) => sum + cashFor(s), 0);
  const left = Math.round((summary.cashToCollect - handedOut) * 100) / 100;

  const step = (s: Settlement, by: number) => {
    setMessage(null);
    setDraft({ ...draft, [s.playerId]: Math.max(cashFor(s) + by, 0) });
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const { discord } = await onSave(Object.fromEntries(rows.map((s) => [s.playerId, cashFor(s)])));
      setDraft({});
      setMessage(discord && !discord.ok
        ? { error: true, text: `Saved, but the Discord post could not be updated: ${discord.error ?? 'unknown error'}` }
        : { error: false, text: 'Saved.' });
    } catch (err) {
      setMessage({ error: true, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card mb-4" data-testid="cash-payouts">
      <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-1">Paid out in Cash</h3>
      <p className="text-xs text-text-tertiary mb-3">
        {summary.cashMode === 'saved' ? 'Recorded.' : 'Suggested, not saved yet.'} Cash goes in $50s; the rest is settled by transfer.
      </p>

      <div className="space-y-3">
        {rows.map((s) => {
          const cash = cashFor(s);
          const { bankReceived, changeOwed } = transferAfterCash(s.netWithBank, cash);
          return (
            <div key={s.playerId} className="flex items-center justify-between gap-3" data-testid={`cash-${s.playerName}`}>
              <div className="min-w-0">
                <p className="font-medium text-text-primary">{s.playerName}</p>
                <p className="text-xs text-text-tertiary">
                  Owed {formatCurrency(s.netWithBank)}
                  {changeOwed > 0 && ` · transfers ${formatCurrency(changeOwed)} back`}
                  {bankReceived > 0 && ` · gets ${formatCurrency(bankReceived)} by transfer`}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => step(s, -50)}
                  disabled={saving || cash <= 0}
                  aria-label={`$50 less cash for ${s.playerName}`}
                  className="btn-secondary w-10 h-10 disabled:opacity-50"
                >
                  −
                </button>
                <span className="w-16 text-center font-semibold tabular-nums">${cash}</span>
                <button
                  onClick={() => step(s, 50)}
                  disabled={saving}
                  aria-label={`$50 more cash for ${s.playerName}`}
                  className="btn-secondary w-10 h-10 disabled:opacity-50"
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 pt-3 border-t border-bg-tertiary text-sm text-text-secondary" data-testid="cash-totals">
        <p>
          {formatCurrency(summary.cashToCollect)} cash collected, {formatCurrency(handedOut)} handed out,{' '}
          {left >= 0 ? `${formatCurrency(left)} left with ${summary.bankPlayerName}` : 'none left'}.
        </p>
        {left < 0 && (
          <p className="text-accent-negative font-medium mt-1" data-testid="cash-over">
            That is {formatCurrency(-left)} more cash than was collected.
          </p>
        )}
      </div>

      {message && (
        <p className={`text-xs mt-2 ${message.error ? 'text-accent-negative' : 'text-accent-positive'}`}>{message.text}</p>
      )}
      {unsaved && (
        <button onClick={save} disabled={saving} className="btn-primary w-full mt-3 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save cash payouts'}
        </button>
      )}
    </div>
  );
}
