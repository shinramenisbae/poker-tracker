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
const { rakeFromPlayers } = require('./rake-session');
const { cents } = require('./rake-ledger');
const { runAsync, getAsync, allAsync, withTransaction } = require('./db-async');

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/** Attaches each player's buy-ins, which the rake conversion needs to net off. */
async function withBuyIns(db, players) {
  const withAmounts = [];
  for (const player of players) {
    const buyIns = await allAsync(db, 'SELECT amount FROM buyIns WHERE playerId = ?', [player.id]);
    withAmounts.push({ ...player, buyIns });
  }
  return withAmounts;
}

async function bankPlayerName(db, sessionId, bankPlayerId) {
  if (!bankPlayerId) return null;
  const row = await getAsync(db, 'SELECT name FROM players WHERE id = ?', [bankPlayerId]);
  return row ? row.name : null;
}

function failure(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * @param {import('sqlite3').Database} db
 * @param {string} sessionId
 * @param {{rakeAmount?: number, rakeHolder?: string|null}} rake
 *   rakeHolder empty means "whoever banks", so it follows a banker change
 * @returns {Promise<{bankPlayerId: string|null,
 *   merges: {name: string, keepId: string, entries: number,
 *            totalBuyIn: number, totalCashOut: number}[],
 *   rake: {amount: number, holder: string|null, convertedFromPlayer: boolean,
 *          discardedPlayerAmount: number|null}}>}
 */
async function endSession(db, sessionId, { rakeAmount, rakeHolder } = {}) {
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

    // Rake first: the pile is not a player, and leaving it in would let it
    // merge, win, and bank like one.
    const typedAmount = Number(rakeAmount) || 0;
    const fromPlayer = rakeFromPlayers(await withBuyIns(db, players));
    for (const id of fromPlayer.removeIds) {
      await runAsync(db, 'DELETE FROM buyIns WHERE playerId = ?', [id]);
      await runAsync(db, 'DELETE FROM players WHERE id = ?', [id]);
    }
    // Both filled in means somebody did it twice, not twice the rake.
    const rakeTotal = cents(typedAmount > 0 ? typedAmount : fromPlayer.amount);
    const discardedPlayerAmount = typedAmount > 0 && fromPlayer.amount > 0 ? fromPlayer.amount : null;

    const remaining = players.filter((p) => !fromPlayer.removeIds.includes(p.id));
    const plans = planMerges(remaining);
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
    const holder = (rakeHolder || '').trim() || null;
    await runAsync(db, `UPDATE sessions
                        SET status = 'completed', bankPlayerId = ?, rakeAmount = ?, rakeHolder = ?, updatedAt = ?
                        WHERE id = ?`, [bankPlayerId, rakeTotal, holder, now, sessionId]);

    // The ledger records who actually ended up holding it, so a balance never
    // depends on re-deriving who was banking that night.
    if (rakeTotal > 0) {
      const bankName = await bankPlayerName(db, sessionId, bankPlayerId);
      const creditedTo = holder || bankName;
      if (creditedTo) {
        await runAsync(db, `INSERT INTO rake_entries (id, kind, amount, toName, sessionId, createdAt, createdBy)
                            VALUES (?, 'session', ?, ?, ?, ?, 'tracker')`,
          [generateId(), rakeTotal, creditedTo, sessionId, now]);
      }
    }

    const byId = new Map(merged.map((p) => [p.id, p]));
    return {
      bankPlayerId,
      rake: {
        amount: rakeTotal,
        holder,
        convertedFromPlayer: fromPlayer.removeIds.length > 0,
        discardedPlayerAmount,
      },
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
