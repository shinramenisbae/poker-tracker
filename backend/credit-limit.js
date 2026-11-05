// The credit limit: how much of a night's buy-ins a player may owe the banker.
//
// A 'bank' buy-in is owed and paid to the banker after the game; a 'cash' one
// is paid on the spot. Above the limit a player has to pay straight away, to
// whoever the session names as the collector (Nick or Stephen), so the part of
// a bank buy-in over the limit is recorded as 'prepaid'. The collector then
// owes that money to the banker at settlement.
//
// New players — nobody of that name has played a session before — get no
// credit at all.
//
// Only live in-person sessions are split. Online sessions are imported after
// the game, when there is nothing left to enforce.

const { runAsync, getAsync, withTransaction } = require('./db-async');
const { cents } = require('./rake-ledger');

const DEFAULT_CREDIT_LIMIT = 500;

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function failure(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Splits one bank buy-in at the limit.
 * @returns {{amount: number, method: 'bank'|'prepaid'}[]}
 */
function splitBuyIn({ amount, owedSoFar, limit }) {
  const room = Math.max(0, cents(limit - owedSoFar));
  const owed = Math.min(cents(amount), room);
  const prepaid = cents(amount - owed);
  const parts = [];
  if (owed > 0) parts.push({ amount: owed, method: 'bank' });
  if (prepaid > 0) parts.push({ amount: prepaid, method: 'prepaid' });
  return parts;
}

/** Has anyone of this name played a session other than this one? */
async function isNewPlayer(db, sessionId, name) {
  const row = await getAsync(db,
    'SELECT 1 FROM players WHERE sessionId != ? AND LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1',
    [sessionId, name]);
  return !row;
}

/**
 * Records a buy-in, splitting a bank buy-in that goes over the player's limit.
 * @returns {Promise<{creditSplit: null | {owed: number, prepaid: number,
 *   collector: string|null, limit: number, newPlayer: boolean}}>}
 *   creditSplit is set only when some of it had to be paid up front.
 */
async function addBuyIn(db, { sessionId, playerId, amount, method, isRebuy, rebuyType, stackedHand }) {
  const rebuyTypeClean = rebuyType === 'top-up' || rebuyType === 'stacked' ? rebuyType : null;
  const stackedHandClean = (typeof stackedHand === 'string' && stackedHand.trim()) || null;

  return withTransaction(db, async () => {
    const player = await getAsync(db, 'SELECT id, name FROM players WHERE id = ? AND sessionId = ?', [playerId, sessionId]);
    if (!player) throw failure('NOT_FOUND', 'Player not found');
    const session = await getAsync(db, 'SELECT status, gameType, creditLimit, creditCollector FROM sessions WHERE id = ?', [sessionId]);

    let parts = [{ amount, method: method || 'cash' }];
    let creditSplit = null;
    const enforced = method === 'bank' && session.gameType !== 'online' && session.status !== 'completed';
    if (enforced) {
      const newPlayer = await isNewPlayer(db, sessionId, player.name);
      const limit = newPlayer ? 0 : Number(session.creditLimit ?? DEFAULT_CREDIT_LIMIT);
      const { owedSoFar } = await getAsync(db,
        "SELECT COALESCE(SUM(amount), 0) AS owedSoFar FROM buyIns WHERE playerId = ? AND method = 'bank'", [playerId]);
      parts = splitBuyIn({ amount: Number(amount), owedSoFar, limit });
      const prepaid = parts.find((p) => p.method === 'prepaid');
      if (prepaid) {
        const owed = parts.find((p) => p.method === 'bank');
        creditSplit = { owed: owed ? owed.amount : 0, prepaid: prepaid.amount,
          collector: session.creditCollector || null, limit, newPlayer };
      }
    }

    // Same timestamp for both halves: they are one buy-in at the table.
    const now = new Date().toISOString();
    for (const part of parts) {
      await runAsync(db, `INSERT INTO buyIns (id, playerId, amount, timestamp, isRebuy, method, rebuyType, stackedHand)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [generateId(), playerId, part.amount, now, isRebuy ? 1 : 0, part.method, rebuyTypeClean, stackedHandClean]);
    }
    return { creditSplit };
  });
}

module.exports = { DEFAULT_CREDIT_LIMIT, splitBuyIn, isNewPlayer, addBuyIn };
