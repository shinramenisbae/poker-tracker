// Deciding whether a session's books can be closed.
//
// Money moves in two legs: losers pay the bank player, then the bank player
// pays the winners. Only the first is tracked — /paid records it and it drives
// the reminders. Nothing records the second, so once the last debtor is marked
// paid a session simply goes quiet whether or not the winners were ever paid.
//
// /finish records that second leg. It is deliberately strict about when: a
// session is either settled or it isn't, and "settled" has to mean one thing to
// be worth recording at all.
//
// Pure and separate from index.js so every refusal path is testable without
// Discord or a database.

import { identifyBankPlayer } from './settlement.js';
import { unpaidDebtors } from './unpaid.js';

/**
 * Who the bank player is, by name. Explicit bankPlayerId wins; otherwise the
 * biggest winner, mirroring how the results post picks them.
 *
 * @returns {string|null} null when nobody won, so there is no bank
 */
function bankPlayerName(session) {
  const id = session?.bankPlayerId || identifyBankPlayer(session);
  if (!id) return null;
  const player = (session.players || []).find((p) => p.id === id);
  return player ? player.name : null;
}

/**
 * @param {object} args
 * @param {object} args.session full session row
 * @param {string|null} args.callerPlayerName the caller's linked player, if any
 * @param {boolean} args.isAdmin caller holds Manage Server
 * @param {Set<string>} args.paidNames players already marked paid
 * @param {boolean} args.alreadySettled session already has settledAt
 * @param {boolean} args.reopen the caller passed reopen:true
 * @returns {{ok: true, bank: string|null} | {ok: false, reason: string}}
 */
function canFinish({
  session,
  callerPlayerName = null,
  isAdmin = false,
  paidNames = new Set(),
  alreadySettled = false,
  reopen = false,
} = {}) {
  const bank = bankPlayerName(session);

  // Permission first — it governs undoing just as much as doing.
  if (!isAdmin) {
    if (!callerPlayerName) {
      return {
        ok: false,
        reason: 'I don\'t know who you are yet. Run `/link player:<your name>` first, '
          + 'or ask someone with **Manage Server** to run this.',
      };
    }
    if (!bank || callerPlayerName !== bank) {
      return {
        ok: false,
        reason: `Only the bank player${bank ? ` (**${bank}**)` : ''} or someone with `
          + '**Manage Server** can close the books on a session.',
      };
    }
  }

  // Undo is the inverse of the checks below, not a repeat of them: a session
  // being reopened has already passed them once.
  if (reopen) {
    return alreadySettled
      ? { ok: true, bank }
      : { ok: false, reason: 'This session was not settled, so there is nothing to reopen.' };
  }

  if (alreadySettled) {
    return { ok: false, reason: 'This session is already settled. Use `/finish reopen:true` to undo that.' };
  }

  if (session?.status !== 'completed') {
    return { ok: false, reason: 'This session is still in progress — nothing to settle until everyone has cashed out.' };
  }

  const outstanding = unpaidDebtors(session, paidNames);
  if (outstanding.length > 0) {
    const who = outstanding.map((u) => `**${u.playerName}** ($${u.owes.toFixed(2)})`).join(', ');
    return {
      ok: false,
      reason: `Not everyone has paid the bank yet: ${who}. Mark them with \`/paid\` first.`,
    };
  }

  return { ok: true, bank };
}

export { canFinish, bankPlayerName };
