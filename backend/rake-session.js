// Turning a "Rake" player into rake.
//
// For 22 sessions the night's rake was recorded by adding a player called Rake
// and cashing it out for the take. That made the pile look like a winner: it
// appeared in results, in the settlement, and near the top of the player stats.
//
// Rake is now a field on the session, but the habit will outlive the change, so
// ending a session still accepts a Rake row and converts it.

// An explicit list, not a pattern. Every spelling rake has been entered under,
// found by reading the data — and nothing else, so a future player called
// "Drake" is never mistaken for the pile.
const RAKE_NAMES = new Set(['rake', 'rale', 'stephen rake?']);

/** @param {string} name */
function isRakeRow(name) {
  return RAKE_NAMES.has(String(name ?? '').trim().toLowerCase());
}

/**
 * The rake carried by any Rake-style rows, and which rows to delete.
 *
 * Cash-out minus buy-ins, because a couple of old rows were given buy-ins too:
 * on 27 May 2026 Rake had $40 in and $80 out, which is $40 of rake, and taking
 * the difference keeps the session's pot balanced once the row is gone.
 *
 * @param {{id: string, name: string, buyIns: {amount: number}[], cashOutAmount: number|null}[]} players
 * @returns {{amount: number, removeIds: string[]}}
 */
function rakeFromPlayers(players) {
  let amount = 0;
  const removeIds = [];

  for (const player of players || []) {
    if (!isRakeRow(player.name)) continue;
    const buyIn = (player.buyIns || []).reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
    const cashOut = player.cashOutAmount == null ? 0 : Number(player.cashOutAmount) || 0;
    amount += cashOut - buyIn;
    removeIds.push(player.id);
  }

  return { amount: Math.round(amount * 100) / 100, removeIds };
}

module.exports = { isRakeRow, rakeFromPlayers, RAKE_NAMES };
