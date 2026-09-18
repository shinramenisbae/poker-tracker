const { test, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.POKER_DB = ':memory:';
process.env.SEED_ALIASES = '0';
const db = require('./database');
const { allAsync, getAsync, runAsync } = require('./db-async');
const { endSession } = require('./end-session');

after(() => db.close());

let seq = 0;
const uid = (prefix) => `${prefix}${seq++}`;

/**
 * @param {{name: string, buyIns: number[], cashOut: number|null, cashOutAt?: string}[]} players
 * @returns {Promise<string>} the new session's id
 */
async function seedSession(players, { status = 'active' } = {}) {
  const sessionId = uid('s');
  const now = '2026-09-16T04:00:00.000Z';
  await runAsync(db, `INSERT INTO sessions (id, date, status, notes, gameType, createdAt, updatedAt)
                      VALUES (?, '2026-09-16', ?, 'test', 'in-person', ?, ?)`, [sessionId, status, now, now]);
  for (const player of players) {
    const playerId = uid('p');
    await runAsync(db, `INSERT INTO players (id, sessionId, name, paymentMethod, cashOutAmount, cashOutDate)
                        VALUES (?, ?, ?, 'cash', ?, ?)`,
      [playerId, sessionId, player.name, player.cashOut, player.cashOut == null ? null : (player.cashOutAt || now)]);
    for (const [index, amount] of player.buyIns.entries()) {
      await runAsync(db, `INSERT INTO buyIns (id, playerId, amount, timestamp, isRebuy, method)
                          VALUES (?, ?, ?, ?, ?, 'cash')`,
        [uid('b'), playerId, amount, `2026-09-16T0${index + 1}:00:00.000Z`, index > 0 ? 1 : 0]);
    }
  }
  return sessionId;
}

const playersOf = (sessionId) =>
  allAsync(db, `SELECT p.id, p.name, p.cashOutAmount, p.cashOutDate,
                       COALESCE((SELECT SUM(amount) FROM buyIns WHERE playerId = p.id), 0) AS totalBuyIn
                FROM players p WHERE p.sessionId = ? ORDER BY p.rowid`, [sessionId]);

test('endSession: the two Leos become one player with both stints of buy-ins', async () => {
  const sessionId = await seedSession([
    { name: 'Leo', buyIns: [100], cashOut: 79, cashOutAt: '2026-09-16T06:01:00.000Z' },
    { name: 'Jordan', buyIns: [100, 200], cashOut: 1329 },
    { name: 'leo', buyIns: [200, 300], cashOut: 504, cashOutAt: '2026-09-16T11:30:00.000Z' },
  ]);

  const result = await endSession(db, sessionId);

  const players = await playersOf(sessionId);
  assert.equal(players.length, 2);
  const leo = players.find((p) => p.name === 'Leo');
  assert.equal(leo.totalBuyIn, 600);
  assert.equal(leo.cashOutAmount, 583);
  assert.equal(leo.cashOutDate, '2026-09-16T11:30:00.000Z');
  assert.deepEqual(result.merges, [
    { name: 'Leo', keepId: leo.id, entries: 2, totalBuyIn: 600, totalCashOut: 583 },
  ]);
});

test('endSession: the banker is the biggest winner after merging, not before', async () => {
  // Split across two entries Leo tops nobody; merged he is up $700, more than
  // Jordan's $600, so merging first changes who banks.
  const sessionId = await seedSession([
    { name: 'Leo', buyIns: [100], cashOut: 500 },
    { name: 'Jordan', buyIns: [100], cashOut: 700 },
    { name: 'Leo', buyIns: [100], cashOut: 400 },
  ]);

  const result = await endSession(db, sessionId);

  const players = await playersOf(sessionId);
  const leo = players.find((p) => p.name === 'Leo');
  assert.equal(result.bankPlayerId, leo.id);
  const session = await getAsync(db, 'SELECT status, bankPlayerId FROM sessions WHERE id = ?', [sessionId]);
  assert.equal(session.bankPlayerId, leo.id);
  assert.equal(session.status, 'completed');
});

test('endSession: a session with no duplicates is completed and reports no merges', async () => {
  const sessionId = await seedSession([
    { name: 'Simon', buyIns: [100], cashOut: 50 },
    { name: 'Min', buyIns: [100], cashOut: 150 },
  ]);

  const result = await endSession(db, sessionId);

  assert.deepEqual(result.merges, []);
  const session = await getAsync(db, 'SELECT status FROM sessions WHERE id = ?', [sessionId]);
  assert.equal(session.status, 'completed');
});

test('endSession: ending a completed session is refused, leaving it untouched', async () => {
  const sessionId = await seedSession([
    { name: 'Leo', buyIns: [100], cashOut: 79 },
    { name: 'Leo', buyIns: [500], cashOut: 504 },
  ], { status: 'completed' });

  await assert.rejects(() => endSession(db, sessionId), (err) => err.code === 'ALREADY_COMPLETED');

  assert.equal((await playersOf(sessionId)).length, 2);
});

test('endSession: an unknown session is refused', async () => {
  await assert.rejects(() => endSession(db, 'nope'), (err) => err.code === 'NOT_FOUND');
});

const rakeEntriesFor = (sessionId) =>
  allAsync(db, 'SELECT kind, amount, fromName, toName, note FROM rake_entries WHERE sessionId = ?', [sessionId]);

test('endSession: rake is stored and credited to the holder', async () => {
  const sessionId = await seedSession([
    { name: 'Daniel H', buyIns: [200], cashOut: 1415 },
    { name: 'Simon', buyIns: [2000], cashOut: 1180 },
  ]);

  await endSession(db, sessionId, { rakeAmount: 133, rakeHolder: 'Stephen' });

  const session = await getAsync(db, 'SELECT rakeAmount, rakeHolder FROM sessions WHERE id = ?', [sessionId]);
  assert.equal(session.rakeAmount, 133);
  assert.equal(session.rakeHolder, 'Stephen');
  assert.deepEqual(await rakeEntriesFor(sessionId), [
    { kind: 'session', amount: 133, fromName: null, toName: 'Stephen', note: null },
  ]);
});

test('endSession: with no holder named, the banker holds the rake', async () => {
  const sessionId = await seedSession([
    { name: 'Daniel H', buyIns: [200], cashOut: 1415 },
    { name: 'Simon', buyIns: [2000], cashOut: 1180 },
  ]);

  await endSession(db, sessionId, { rakeAmount: 50 });

  const session = await getAsync(db, 'SELECT rakeAmount, rakeHolder FROM sessions WHERE id = ?', [sessionId]);
  assert.equal(session.rakeHolder, null, 'left empty so it follows a banker change');
  const [entry] = await rakeEntriesFor(sessionId);
  assert.equal(entry.toName, 'Daniel H', 'the ledger records who actually holds it');
});

test('endSession: a night with no rake writes nothing to the ledger', async () => {
  const sessionId = await seedSession([{ name: 'Simon', buyIns: [100], cashOut: 150 }]);

  await endSession(db, sessionId, { rakeAmount: 0 });

  assert.deepEqual(await rakeEntriesFor(sessionId), []);
  const session = await getAsync(db, 'SELECT rakeAmount FROM sessions WHERE id = ?', [sessionId]);
  assert.equal(session.rakeAmount, 0);
});

test('endSession: a leftover Rake player becomes the session s rake', async () => {
  const sessionId = await seedSession([
    { name: 'Daniel H', buyIns: [200], cashOut: 1415 },
    { name: 'Rake', buyIns: [], cashOut: 133 },
  ]);

  const result = await endSession(db, sessionId, {});

  const players = await playersOf(sessionId);
  assert.deepEqual(players.map((p) => p.name), ['Daniel H'], 'the fake player is gone');
  const session = await getAsync(db, 'SELECT rakeAmount FROM sessions WHERE id = ?', [sessionId]);
  assert.equal(session.rakeAmount, 133);
  assert.equal(result.rake.amount, 133);
  assert.equal(result.rake.convertedFromPlayer, true);
});

test('endSession: a typed amount wins over a leftover Rake player', async () => {
  const sessionId = await seedSession([
    { name: 'Daniel H', buyIns: [200], cashOut: 1415 },
    { name: 'Rake', buyIns: [], cashOut: 133 },
  ]);

  const result = await endSession(db, sessionId, { rakeAmount: 140 });

  const session = await getAsync(db, 'SELECT rakeAmount FROM sessions WHERE id = ?', [sessionId]);
  assert.equal(session.rakeAmount, 140, 'not 273 — the two are the same money');
  assert.equal(result.rake.discardedPlayerAmount, 133);
  assert.equal((await playersOf(sessionId)).length, 1);
});

test('endSession: the Rake player never banks', async () => {
  // It used to be possible: the pile "won" every session it appeared in.
  const sessionId = await seedSession([
    { name: 'Simon', buyIns: [100], cashOut: 50 },
    { name: 'Rake', buyIns: [], cashOut: 60 },
  ]);

  const result = await endSession(db, sessionId, {});

  assert.equal(result.bankPlayerId, null, 'nobody won, so nobody banks');
});

test('endSession: buy-ins keep their own timestamps after moving', async () => {
  const sessionId = await seedSession([
    { name: 'Min', buyIns: [100], cashOut: 0 },
    { name: 'Min', buyIns: [200], cashOut: 300 },
  ]);

  await endSession(db, sessionId);

  const [min] = await playersOf(sessionId);
  const buyIns = await allAsync(db, 'SELECT amount, timestamp FROM buyIns WHERE playerId = ? ORDER BY timestamp', [min.id]);
  assert.deepEqual(buyIns.map((b) => b.amount), [100, 200]);
  assert.equal(buyIns[0].timestamp, '2026-09-16T01:00:00.000Z');
});
