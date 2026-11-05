const { test, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.POKER_DB = ':memory:';
process.env.SEED_ALIASES = '0';
const db = require('./database');
const { allAsync, getAsync, runAsync } = require('./db-async');
const { splitBuyIn, addBuyIn, DEFAULT_CREDIT_LIMIT } = require('./credit-limit');

after(() => db.close());

let seq = 0;
const uid = (prefix) => `${prefix}${seq++}`;

async function seedSession({ gameType = 'in-person', status = 'active', creditLimit = 500,
  creditCollector = 'Stephen', players = [] } = {}) {
  const sessionId = uid('s');
  const now = '2026-11-06T04:00:00.000Z';
  await runAsync(db, `INSERT INTO sessions (id, date, status, notes, gameType, createdAt, updatedAt, creditLimit, creditCollector)
                      VALUES (?, '2026-11-06', ?, '', ?, ?, ?, ?, ?)`,
  [sessionId, status, gameType, now, now, creditLimit, creditCollector]);
  const ids = {};
  for (const player of players) {
    const playerId = uid('p');
    ids[player.name] = playerId;
    await runAsync(db, `INSERT INTO players (id, sessionId, name, paymentMethod) VALUES (?, ?, ?, 'cash')`,
      [playerId, sessionId, player.name]);
    for (const [amount, method] of player.buyIns || []) {
      await runAsync(db, `INSERT INTO buyIns (id, playerId, amount, timestamp, method) VALUES (?, ?, ?, ?, ?)`,
        [uid('b'), playerId, amount, now, method]);
    }
  }
  return { sessionId, ids };
}

const buyInsOf = (playerId) =>
  allAsync(db, 'SELECT amount, method FROM buyIns WHERE playerId = ? ORDER BY rowid', [playerId]);

// A regular has played before, so they get the session's credit.
async function regular(name) {
  await seedSession({ status: 'completed', players: [{ name, buyIns: [[100, 'cash']] }] });
}

test('the starting credit limit is $500', () => {
  assert.equal(DEFAULT_CREDIT_LIMIT, 500);
});

test('splitBuyIn: within the limit stays owed', () => {
  assert.deepEqual(splitBuyIn({ amount: 200, owedSoFar: 200, limit: 500 }),
    [{ amount: 200, method: 'bank' }]);
});

test('splitBuyIn: the part over the limit is paid up front', () => {
  assert.deepEqual(splitBuyIn({ amount: 200, owedSoFar: 400, limit: 500 }),
    [{ amount: 100, method: 'bank' }, { amount: 100, method: 'prepaid' }]);
});

test('splitBuyIn: already at the limit, all of it is paid up front', () => {
  assert.deepEqual(splitBuyIn({ amount: 100, owedSoFar: 500, limit: 500 }),
    [{ amount: 100, method: 'prepaid' }]);
});

test('splitBuyIn: a $0 limit means nothing can be owed', () => {
  assert.deepEqual(splitBuyIn({ amount: 100, owedSoFar: 0, limit: 0 }),
    [{ amount: 100, method: 'prepaid' }]);
});

test('splitBuyIn: lands on cents', () => {
  assert.deepEqual(splitBuyIn({ amount: 100.1, owedSoFar: 450.2, limit: 500 }),
    [{ amount: 49.8, method: 'bank' }, { amount: 50.3, method: 'prepaid' }]);
});

test('addBuyIn: a regular going over the limit is split, and told who to pay', async () => {
  await regular('Leo');
  const { sessionId, ids } = await seedSession({ players: [{ name: 'Leo', buyIns: [[400, 'bank'], [300, 'cash']] }] });

  const result = await addBuyIn(db, { sessionId, playerId: ids.Leo, amount: 200, method: 'bank' });

  assert.deepEqual(await buyInsOf(ids.Leo), [
    { amount: 400, method: 'bank' },
    { amount: 300, method: 'cash' },
    { amount: 100, method: 'bank' },
    { amount: 100, method: 'prepaid' },
  ]);
  assert.deepEqual(result.creditSplit, { owed: 100, prepaid: 100, collector: 'Stephen', limit: 500, newPlayer: false });
});

test('addBuyIn: a new player gets no credit', async () => {
  const { sessionId, ids } = await seedSession({ players: [{ name: 'Newbie' }] });

  const result = await addBuyIn(db, { sessionId, playerId: ids.Newbie, amount: 100, method: 'bank' });

  assert.deepEqual(await buyInsOf(ids.Newbie), [{ amount: 100, method: 'prepaid' }]);
  assert.equal(result.creditSplit.newPlayer, true);
  assert.equal(result.creditSplit.limit, 0);
});

test('addBuyIn: someone who has played before is a regular whatever the case of their name', async () => {
  await regular('jordan');
  const { sessionId, ids } = await seedSession({ players: [{ name: 'Jordan' }] });

  const result = await addBuyIn(db, { sessionId, playerId: ids.Jordan, amount: 100, method: 'bank' });

  assert.deepEqual(await buyInsOf(ids.Jordan), [{ amount: 100, method: 'bank' }]);
  assert.equal(result.creditSplit, null);
});

test('addBuyIn: the session limit is what counts', async () => {
  await regular('Sam');
  const { sessionId, ids } = await seedSession({ creditLimit: 300, players: [{ name: 'Sam' }] });

  await addBuyIn(db, { sessionId, playerId: ids.Sam, amount: 400, method: 'bank' });

  assert.deepEqual(await buyInsOf(ids.Sam), [{ amount: 300, method: 'bank' }, { amount: 100, method: 'prepaid' }]);
});

test('addBuyIn: cash is paid on the spot, so it is never split', async () => {
  const { sessionId, ids } = await seedSession({ players: [{ name: 'Cashy' }] });

  const result = await addBuyIn(db, { sessionId, playerId: ids.Cashy, amount: 1000, method: 'cash' });

  assert.deepEqual(await buyInsOf(ids.Cashy), [{ amount: 1000, method: 'cash' }]);
  assert.equal(result.creditSplit, null);
});

test('addBuyIn: online sessions are recorded after the fact, so they are never split', async () => {
  const { sessionId, ids } = await seedSession({ gameType: 'online', players: [{ name: 'Online' }] });

  await addBuyIn(db, { sessionId, playerId: ids.Online, amount: 1000, method: 'bank' });

  assert.deepEqual(await buyInsOf(ids.Online), [{ amount: 1000, method: 'bank' }]);
});

test('addBuyIn: keeps the rebuy details on the owed part', async () => {
  await regular('Rebuyer');
  const { sessionId, ids } = await seedSession({ players: [{ name: 'Rebuyer', buyIns: [[450, 'bank']] }] });

  await addBuyIn(db, { sessionId, playerId: ids.Rebuyer, amount: 100, method: 'bank',
    isRebuy: true, rebuyType: 'stacked', stackedHand: 'AA' });

  const rows = await allAsync(db, 'SELECT amount, method, isRebuy, rebuyType, stackedHand FROM buyIns WHERE playerId = ? ORDER BY rowid', [ids.Rebuyer]);
  assert.deepEqual(rows.slice(1), [
    { amount: 50, method: 'bank', isRebuy: 1, rebuyType: 'stacked', stackedHand: 'AA' },
    { amount: 50, method: 'prepaid', isRebuy: 1, rebuyType: 'stacked', stackedHand: 'AA' },
  ]);
});

test('addBuyIn: a player from another session is refused', async () => {
  const { ids } = await seedSession({ players: [{ name: 'Elsewhere' }] });
  const { sessionId } = await seedSession();

  await assert.rejects(addBuyIn(db, { sessionId, playerId: ids.Elsewhere, amount: 100, method: 'bank' }),
    (err) => err.code === 'NOT_FOUND');
});

test('new sessions start with a $500 limit', async () => {
  const id = uid('s');
  await runAsync(db, `INSERT INTO sessions (id, date, createdAt, updatedAt) VALUES (?, '2026-11-06', 'x', 'x')`, [id]);
  const row = await getAsync(db, 'SELECT creditLimit, creditCollector FROM sessions WHERE id = ?', [id]);
  assert.deepEqual({ ...row }, { creditLimit: 500, creditCollector: null });
});
