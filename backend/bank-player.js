// Who holds the money after a session: the biggest winner.
//
// Mirrors identifyBankPlayer() in app/src/utils/calculations.ts and
// bot/settlement.js. It lives on the server too because ending a session picks
// the banker AFTER merging duplicate entries, and only the server knows the
// merged result.
//
// A session can be re-pointed at someone else by hand afterwards; that is a
// separate feature (Part B of the spec), and it overrides this.

// SQLite stores money as REAL, so a balanced session can leave fractions of a
// cent behind. Anything under half a cent is not a win.
const CENT = 0.005;

/**
 * @param {{id: string, totalBuyIn: number, cashOutAmount: number|null}[]} players
 * @returns {string|null} id of the biggest winner, or null when nobody is up
 */
function pickBankPlayer(players) {
  let bestId = null;
  let bestProfit = 0;
  for (const player of players || []) {
    if (player.cashOutAmount == null) continue; // still owes a cash-out
    const profit = player.cashOutAmount - player.totalBuyIn;
    if (profit > CENT && profit > bestProfit) {
      bestProfit = profit;
      bestId = player.id;
    }
  }
  return bestId;
}

module.exports = { pickBankPlayer };
