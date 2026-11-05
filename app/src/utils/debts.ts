import type { Session } from '../types';
import type { AllPaymentsResponse } from '../api';
import { calculateSettlements, identifyBankPlayer } from './calculations';

interface DebtRow {
  playerName: string;
  total: number;
  sessionCount: number;
}

// Mirrors the bot's aggregateDebts (bot/debts.js), which itself reuses the
// unpaidDebtors rule: a debtor is a non-bank player with bankOwed > 0 who
// hasn't been marked paid. Active sessions have no settlements; a session
// closed with /finish is skipped outright.
export function aggregateDebts(
  sessions: Session[],
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
