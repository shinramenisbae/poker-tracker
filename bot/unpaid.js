// Compute who still owes money for a session, given the settlement and the set
// of players already marked paid. Pure + testable.
//
// A "debtor" is a non-bank player who owes a bank transfer (bankOwed > 0).
// Pure cash-on-table losers (cashBuyIn covers their loss, bankOwed == 0) are NOT
// debtors — their chips are already with the bank player, so there's nothing to
// chase. This matches the settlement model in settlement.js.

import { calculateSettlements, identifyBankPlayer } from './settlement.js';

/**
 * @param {object} session  full session (players, buyIns, cashOut, bankPlayerId)
 * @param {Set<string>} paidNames canonical names already marked paid
 * @returns {Array<{playerName: string, owes: number}>} unpaid debtors, desc by amount
 */
function unpaidDebtors(session, paidNames = new Set()) {
  const bankId = session.bankPlayerId || identifyBankPlayer(session);
  const settlements = calculateSettlements(session);
  return settlements
    .filter((s) => s.playerId !== bankId && (s.bankOwed || 0) > 0.005)
    .filter((s) => !paidNames.has(s.playerName))
    .map((s) => ({ playerName: s.playerName, owes: s.bankOwed }))
    .sort((a, b) => b.owes - a.owes);
}

/** True if the session has at least one outstanding (unpaid) debtor. */
function hasOutstanding(session, paidNames = new Set()) {
  return unpaidDebtors(session, paidNames).length > 0;
}

export { unpaidDebtors, hasOutstanding };
