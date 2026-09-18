// Ending a session: everything that has to be true the moment a game is over.
//
// The browser used to mark the session completed and name the banker itself.
// Both now happen here, in one transaction and in a fixed order, because the
// second depends on the first: Leo's two rows have to become one player before
// anyone asks who won the most.
//
// Part C of the spec adds rake to this same call.

const { planMerges } = require('./merge-players');
const { pickBankPlayer } = require('./bank-player');
const { runAsync, getAsync, allAsync, withTransaction } = require('./db-async');

function failure(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * @param {import('sqlite3').Database} db
 * @param {string} sessionId
 * @returns {Promise<{bankPlayerId: string|null,
 *   merges: {name: string, keepId: string, entries: number,
 *            totalBuyIn: number, totalCashOut: number}[]}>}
 */
async function endSession(db, sessionId) {
  const session = await getAsync(db, 'SELECT id, status FROM sessions WHERE id = ?', [sessionId]);
  if (!session) throw failure('NOT_FOUND', 'Session not found');
  if (session.status === 'completed') {
    throw failure('ALREADY_COMPLETED', 'This session has already been ended');
  }

  return withTransaction(db, async () => {
    const players = await allAsync(db, `
      SELECT p.id, p.name, p.cashOutAmount, p.cashOutDate,
             (SELECT MIN(timestamp) FROM buyIns WHERE playerId = p.id) AS firstBuyInAt
      FROM players p WHERE p.sessionId = ? ORDER BY p.rowid`, [sessionId]);

    const plans = planMerges(players);
    for (const plan of plans) {
      const holes = plan.mergeIds.map(() => '?').join(', ');
      await runAsync(db, `UPDATE buyIns SET playerId = ? WHERE playerId IN (${holes})`,
        [plan.keepId, ...plan.mergeIds]);
      await runAsync(db, 'UPDATE players SET cashOutAmount = ?, cashOutDate = ? WHERE id = ?',
        [plan.cashOutAmount, plan.cashOutDate, plan.keepId]);
      await runAsync(db, `DELETE FROM players WHERE id IN (${holes})`, plan.mergeIds);
    }

    // Re-read: totals per player only mean anything once the merges are in.
    const merged = await allAsync(db, `
      SELECT p.id, p.cashOutAmount,
             COALESCE((SELECT SUM(amount) FROM buyIns WHERE playerId = p.id), 0) AS totalBuyIn
      FROM players p WHERE p.sessionId = ? ORDER BY p.rowid`, [sessionId]);

    const bankPlayerId = pickBankPlayer(merged);
    const now = new Date().toISOString();
    await runAsync(db, `UPDATE sessions SET status = 'completed', bankPlayerId = ?, updatedAt = ?
                        WHERE id = ?`, [bankPlayerId, now, sessionId]);

    const byId = new Map(merged.map((p) => [p.id, p]));
    return {
      bankPlayerId,
      merges: plans.map((plan) => ({
        name: plan.name,
        keepId: plan.keepId,
        entries: plan.mergeIds.length + 1,
        totalBuyIn: byId.get(plan.keepId)?.totalBuyIn ?? 0,
        totalCashOut: plan.cashOutAmount ?? 0,
      })),
    };
  });
}

module.exports = { endSession };
