// The server-wide debt board: who owes the bank, across every session.
//
// Nothing here is stored. The board derives from the same data /paid writes,
// through the same unpaidDebtors the reminders and in-thread /unpaid use — so
// the three surfaces cannot disagree, and the board is current the moment a
// payment is marked. Active sessions contribute nothing (no cash-outs means no
// settlement), and a session closed with /finish is skipped outright.
//
// Pure: sessions and payments in, rows or a Discord message out.

import { unpaidDebtors } from './unpaid.js';

/**
 * @param {Array<object>} sessions full session rows
 * @param {Record<string, Record<string, object>>} paymentsBySession sessionId → {playerName: …}
 * @returns {Array<{playerName: string, total: number, sessionCount: number}>} biggest debtor first
 */
function aggregateDebts(sessions = [], paymentsBySession = {}) {
  const totals = new Map();
  for (const session of sessions) {
    if (session.status !== 'completed') continue;
    if (session.settledAt) continue;
    const paid = new Set(Object.keys(paymentsBySession[session.id] || {}));
    for (const { playerName, owes } of unpaidDebtors(session, paid)) {
      const row = totals.get(playerName) || { playerName, total: 0, sessionCount: 0 };
      row.total += owes;
      row.sessionCount += 1;
      totals.set(playerName, row);
    }
  }
  return [...totals.values()].sort((a, b) => b.total - a.total);
}

/**
 * Render the board as one public Discord message: plain names (the daily
 * reminder already does the pinging), capped so the reply can never cross
 * Discord's 2000-character limit and vanish.
 */
function formatDebtsBoard(rows = [], { cap = 20 } = {}) {
  if (rows.length === 0) {
    return '🎉 **Nobody owes anything** — every session is squared away.';
  }
  const shown = rows.slice(0, cap);
  const lines = shown.map((r) =>
    `• **${r.playerName}** — $${r.total.toFixed(2)} (${r.sessionCount} session${r.sessionCount === 1 ? '' : 's'})`);
  const total = rows.reduce((s, r) => s + r.total, 0);
  const more = rows.length > cap ? `\n_…and ${rows.length - cap} more._` : '';
  return `💰 **Outstanding debts — ${rows.length} player${rows.length === 1 ? '' : 's'}, $${total.toFixed(2)} total**\n`
    + lines.join('\n') + more
    + '\n_Run `/paid` in the session\'s thread once you\'ve sent it._';
}

export { aggregateDebts, formatDebtsBoard };
