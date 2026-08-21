import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessions } from '../hooks/useStorage';
import { calculateSettlements, identifyBankPlayer, formatCurrency } from '../utils/calculations';
import { fetchAllPayments, type AllPaymentsResponse } from '../api';

interface DebtRow {
  playerName: string;
  total: number;
  sessionCount: number;
}

// Mirrors the bot's aggregateDebts (bot/debts.js), which itself reuses the
// unpaidDebtors rule: a debtor is a non-bank player with bankOwed > 0 who
// hasn't been marked paid. Active sessions have no settlements; a session
// closed with /finish is skipped outright.
function aggregateDebts(
  sessions: ReturnType<typeof useSessions>['sessions'],
  paymentsBySession: AllPaymentsResponse['paymentsBySession'],
): DebtRow[] {
  const totals = new Map<string, DebtRow>();
  for (const session of sessions) {
    if (session.status !== 'completed' || session.settledAt) continue;
    const bankId = session.bankPlayerId || identifyBankPlayer(session);
    const paid = new Set(Object.keys(paymentsBySession[session.id] || {}));
    for (const s of calculateSettlements(session)) {
      if (s.playerId === bankId || s.bankOwed <= 0.005 || paid.has(s.playerName)) continue;
      const row = totals.get(s.playerName) || { playerName: s.playerName, total: 0, sessionCount: 0 };
      row.total += s.bankOwed;
      row.sessionCount += 1;
      totals.set(s.playerName, row);
    }
  }
  return [...totals.values()].sort((a, b) => b.total - a.total);
}

export function Debts() {
  const navigate = useNavigate();
  const { sessions, isLoading } = useSessions();
  const [payments, setPayments] = useState<AllPaymentsResponse['paymentsBySession'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAllPayments()
      .then((r) => setPayments(r.paymentsBySession))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const rows = useMemo(
    () => (payments ? aggregateDebts(sessions, payments) : []),
    [sessions, payments],
  );
  const grandTotal = rows.reduce((s, r) => s + r.total, 0);
  const loading = isLoading || payments === null;

  return (
    <div className="min-h-full bg-bg-primary">
      <header className="sticky top-0 bg-bg-primary/95 backdrop-blur-sm border-b border-bg-tertiary z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/')}
              className="p-2 rounded-full hover:bg-bg-tertiary"
              title="Back"
            >
              ←
            </button>
            <div>
              <h1 className="text-xl font-bold text-text-primary">Outstanding Debts</h1>
              <p className="text-sm text-text-secondary">
                Who still owes the bank, across every unsettled session. Updates the moment a payment is marked.
              </p>
            </div>
          </div>
          {rows.length > 0 && (
            <div className="text-right text-sm">
              <div className="text-text-primary font-semibold tabular-nums">{formatCurrency(grandTotal)}</div>
              <div className="text-text-secondary">outstanding</div>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        {error && (
          <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded px-3 py-2 text-sm mb-4">
            {error}
          </div>
        )}

        {loading && !error && (
          <p className="text-text-secondary text-center py-8">Loading…</p>
        )}

        {!loading && !error && rows.length === 0 && (
          <div className="text-center py-12">
            <p className="text-4xl mb-3">🎉</p>
            <p className="text-text-primary font-semibold">Nobody owes anything</p>
            <p className="text-sm text-text-secondary mt-1">Every session is squared away.</p>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-bg-tertiary text-left text-text-secondary">
                  <th className="px-4 py-3 font-medium">Player</th>
                  <th className="px-4 py-3 font-medium text-right">Total Debt</th>
                  <th className="px-4 py-3 font-medium text-right">Owing Sessions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.playerName} className="border-b border-bg-tertiary last:border-0">
                    <td className="px-4 py-3 font-medium text-text-primary">{r.playerName}</td>
                    <td className="px-4 py-3 text-right tabular-nums loss">{formatCurrency(r.total)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-secondary">{r.sessionCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
