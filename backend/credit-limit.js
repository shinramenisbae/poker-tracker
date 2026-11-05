// The credit limit: how much of a night's buy-ins a player may owe the banker.
//
// Three ways to buy in. 'credit' is owed and paid to the banker after the game.
// 'cash' goes to the banker, or sits on the table until there is one. 'bank' is
// transferred straight away to whoever the session names as the collector (Nick
// or Stephen), who passes it to the banker at settlement. The part of a credit
// buy-in over the limit is recorded as 'bank'.
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

const BUY_IN_METHODS = ['cash', 'bank', 'credit'];

function failure(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Splits one credit buy-in at the limit.
 * @returns {{amount: number, method: 'credit'|'bank'}[]}
 */
function splitBuyIn({ amount, owedSoFar, limit }) {
  const room = Math.max(0, cents(limit - owedSoFar));
  const owed = Math.min(cents(amount), room);
  const overLimit = cents(amount - owed);
  const parts = [];
  if (owed > 0) parts.push({ amount: owed, method: 'credit' });
  if (overLimit > 0) parts.push({ amount: overLimit, method: 'bank' });
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
 * Records a buy-in, splitting a credit buy-in that goes over the player's limit.
 * @returns {Promise<{creditSplit: null | {credit: number, bank: number,
 *   collector: string|null, limit: number, newPlayer: boolean}}>}
 *   creditSplit is set only when some of it had to be paid up front.
 */
async function addBuyIn(db, { sessionId, playerId, amount, method, isRebuy, rebuyType, stackedHand }) {
  const rebuyTypeClean = rebuyType === 'top-up' || rebuyType === 'stacked' ? rebuyType : null;
  const stackedHandClean = (typeof stackedHand === 'string' && stackedHand.trim()) || null;

  if (method !== undefined && method !== null && !BUY_IN_METHODS.includes(method)) {
    throw failure('BAD_METHOD', `method must be one of ${BUY_IN_METHODS.join(', ')}`);
  }

  return withTransaction(db, async () => {
    const player = await getAsync(db, 'SELECT id, name FROM players WHERE id = ? AND sessionId = ?', [playerId, sessionId]);
    if (!player) throw failure('NOT_FOUND', 'Player not found');
    const session = await getAsync(db, 'SELECT status, gameType, creditLimit, creditCollector FROM sessions WHERE id = ?', [sessionId]);

    let parts = [{ amount, method: method || 'cash' }];
    let creditSplit = null;
    const enforced = method === 'credit' && session.gameType !== 'online' && session.status !== 'completed';
    if (enforced) {
      const newPlayer = await isNewPlayer(db, sessionId, player.name);
      const limit = newPlayer ? 0 : Number(session.creditLimit ?? DEFAULT_CREDIT_LIMIT);
      const { owedSoFar } = await getAsync(db,
        "SELECT COALESCE(SUM(amount), 0) AS owedSoFar FROM buyIns WHERE playerId = ? AND method = 'credit'", [playerId]);
      parts = splitBuyIn({ amount: Number(amount), owedSoFar, limit });
      const overLimit = parts.find((p) => p.method === 'bank');
      if (overLimit) {
        const owed = parts.find((p) => p.method === 'credit');
        creditSplit = { credit: owed ? owed.amount : 0, bank: overLimit.amount,
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

module.exports = { DEFAULT_CREDIT_LIMIT, BUY_IN_METHODS, splitBuyIn, isNewPlayer, addBuyIn };
