// The rake pile: who holds how much, worked out from the movements.
//
// Rake used to be a fake player called "Rake" whose cash-out was that night's
// take, and the running total lived in a Discord channel maintained by hand.
// Now every movement is a row — a session's rake, money spent, rake handed to
// someone else, an admin correction — and balances are the sum of those rows.
//
// Nothing stores a balance. That is the point: a wrong entry can be found and
// reversed, where a running total that was overwritten cannot.

// Money is REAL in SQLite, so 0.1 + 0.2 is not 0.3. Every sum lands on cents.
const cents = (n) => Math.round(n * 100) / 100;

const KINDS = new Set(['session', 'spend', 'give', 'adjust']);

/**
 * @param {{kind: string, amount: number, fromName?: string|null, toName?: string|null}[]} entries
 * @returns {{total: number, holders: {name: string, balance: number}[]}}
 *   holders sorted by balance, biggest first; anyone at exactly zero is left out
 */
function balancesFrom(entries) {
  const byName = new Map();
  const credit = (name, amount) => {
    if (!name) return;
    byName.set(name, (byName.get(name) || 0) + amount);
  };

  for (const entry of entries || []) {
    const amount = Number(entry.amount) || 0;
    credit(entry.toName, amount);
    credit(entry.fromName, -amount);
  }

  const holders = [...byName.entries()]
    .map(([name, balance]) => ({ name, balance: cents(balance) }))
    .filter((h) => h.balance !== 0)
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));

  return {
    total: cents(holders.reduce((sum, h) => sum + h.balance, 0)),
    holders,
  };
}

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

/**
 * Whether a movement can be recorded.
 *
 * Spending and handing over are checked against what that person actually
 * holds: a typo should surface at once, not as a balance that drifts. An admin
 * adjustment is exempt, because correcting a ledger that disagrees with the
 * real world is exactly what it is for.
 *
 * @param {{kind: string, amount: number, fromName?: string|null, toName?: string|null}} entry
 * @param {{holders: {name: string, balance: number}[]}} balances from balancesFrom()
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
function checkEntry(entry, balances) {
  const kind = entry && entry.kind;
  if (!KINDS.has(kind)) {
    return { ok: false, reason: `Unknown kind of rake entry: ${kind}` };
  }

  const amount = Number(entry.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: 'Amount must be more than $0.' };
  }

  const needsFrom = kind === 'spend' || kind === 'give';
  const needsTo = kind === 'session' || kind === 'give';
  if (needsFrom && !entry.fromName) return { ok: false, reason: 'Whose rake is this coming out of?' };
  if (needsTo && !entry.toName) return { ok: false, reason: 'Who is holding it?' };
  if (kind === 'adjust' && !entry.fromName && !entry.toName) {
    return { ok: false, reason: 'An adjustment needs a player.' };
  }

  if (kind === 'give' && entry.fromName === entry.toName) {
    return { ok: false, reason: 'You cannot hand rake to yourself.' };
  }

  if (needsFrom) {
    const held = (balances.holders || []).find((h) => h.name === entry.fromName);
    const balance = held ? held.balance : 0;
    if (amount > balance + 0.005) {
      return {
        ok: false,
        reason: `${entry.fromName} holds ${money(balance)}, so ${money(amount)} is more rake than there is to ${kind === 'spend' ? 'spend' : 'hand over'}.`,
      };
    }
  }

  return { ok: true };
}

module.exports = { balancesFrom, checkEntry, cents };
