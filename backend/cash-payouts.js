// Cash the banker hands out at the end of a night, always in $50s.
//
// Recording it replaces the whole set for the session: a player left out of the
// amounts is someone who is not being paid in cash. A player with nothing coming
// back from the banker cannot be given any.

const { runAsync, getAsync, allAsync, withTransaction } = require('./db-async');

function failure(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** What the banker owes a player before cash: their cash-out less their credit. */
async function owedBack(db, player) {
  const { credit } = await getAsync(db,
    "SELECT COALESCE(SUM(amount), 0) AS credit FROM buyIns WHERE playerId = ? AND method = 'credit'", [player.id]);
  return (Number(player.cashOutAmount) || 0) - credit;
}

/**
 * @param {import('sqlite3').Database} db
 * @param {string} sessionId
 * @param {Record<string, number>} amounts playerId -> cash, in multiples of $50
 */
async function saveCashPayouts(db, sessionId, amounts) {
  const session = await getAsync(db, 'SELECT status FROM sessions WHERE id = ?', [sessionId]);
  if (!session) throw failure('NOT_FOUND', 'Session not found');
  if (session.status !== 'completed') throw failure('ACTIVE', 'End the session before recording cash payouts');
  if (!amounts || typeof amounts !== 'object' || Array.isArray(amounts)) {
    throw failure('BAD_AMOUNT', 'amounts must map player ids to cash amounts');
  }

  return withTransaction(db, async () => {
    const players = await allAsync(db, 'SELECT id, name, cashOutAmount FROM players WHERE sessionId = ?', [sessionId]);
    const byId = new Map(players.map((p) => [p.id, p]));

    await runAsync(db, 'UPDATE players SET cashPaid = NULL WHERE sessionId = ?', [sessionId]);
    for (const [playerId, raw] of Object.entries(amounts)) {
      const player = byId.get(playerId);
      if (!player) throw failure('UNKNOWN_PLAYER', `Player ${playerId} is not in this session`);
      const amount = raw;
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount % 50 !== 0) {
        throw failure('BAD_AMOUNT', `Cash for ${player.name} must be $0 or more, in $50s`);
      }
      if (amount > 0 && (await owedBack(db, player)) <= 0) {
        throw failure('BAD_AMOUNT', `${player.name} has nothing coming back from the banker`);
      }
      await runAsync(db, 'UPDATE players SET cashPaid = ? WHERE id = ?', [amount, playerId]);
    }
    await runAsync(db, 'UPDATE sessions SET updatedAt = ? WHERE id = ?', [new Date().toISOString(), sessionId]);
  });
}

module.exports = { saveCashPayouts };
