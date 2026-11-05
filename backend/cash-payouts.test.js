const { test, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.POKER_DB = ':memory:';
process.env.SEED_ALIASES = '0';
const db = require('./database');
const { allAsync, runAsync } = require('./db-async');
const { saveCashPayouts } = require('./cash-payouts');

after(() => db.close());

let seq = 0;
const uid = (prefix) => `${prefix}${seq++}`;

async function seed({ status = 'completed' } = {}) {
  const sessionId = uid('s');
  await runAsync(db, `INSERT INTO sessions (id, date, status, createdAt, updatedAt) VALUES (?, '2026-11-06', ?, 'x', 'x')`, [sessionId, status]);
  const addPlayer = async (name, cashOut, credit) => {
    const id = uid('p');
    await runAsync(db, `INSERT INTO players (id, sessionId, name, cashOutAmount) VALUES (?, ?, ?, ?)`, [id, sessionId, name, cashOut]);
    if (credit) {
      await runAsync(db, `INSERT INTO buyIns (id, playerId, amount, timestamp, method) VALUES (?, ?, ?, 'x', 'credit')`, [uid('b'), id, credit]);
    }
    return id;
  };
  return {
    sessionId,
    simon: await addPlayer('Simon', 895, 400),
    min: await addPlayer('Min', 950, 500),
    nick: await addPlayer('Nick', 0, 500),
  };
}

const cashPaid = async (sessionId) => Object.fromEntries(
  (await allAsync(db, 'SELECT name, cashPaid FROM players WHERE sessionId = ?', [sessionId])).map((p) => [p.name, p.cashPaid]));

test('saves each amount, and everyone else has none recorded', async () => {
  const { sessionId, simon } = await seed();
  await saveCashPayouts(db, sessionId, { [simon]: 500 });
  assert.deepEqual(await cashPaid(sessionId), { Simon: 500, Min: null, Nick: null });
});

test('saving again replaces the whole set', async () => {
  const { sessionId, simon, min } = await seed();
  await saveCashPayouts(db, sessionId, { [simon]: 500 });
  await saveCashPayouts(db, sessionId, { [min]: 450 });
  assert.deepEqual(await cashPaid(sessionId), { Simon: null, Min: 450, Nick: null });
});

test('$0 is a recorded answer: paid by transfer', async () => {
  const { sessionId, simon } = await seed();
  await saveCashPayouts(db, sessionId, { [simon]: 0 });
  assert.equal((await cashPaid(sessionId)).Simon, 0);
});

for (const bad of [495, -50, 'lots', null]) {
  test(`refuses ${bad}: cash comes in $50s, and a bad save changes nothing`, async () => {
    const { sessionId, simon, min } = await seed();
    await saveCashPayouts(db, sessionId, { [min]: 450 });
    await assert.rejects(saveCashPayouts(db, sessionId, { [min]: 100, [simon]: bad }), (e) => e.code === 'BAD_AMOUNT');
    assert.deepEqual(await cashPaid(sessionId), { Simon: null, Min: 450, Nick: null });
  });
}

test('refuses cash for someone the banker owes nothing', async () => {
  const { sessionId, nick } = await seed();
  await assert.rejects(saveCashPayouts(db, sessionId, { [nick]: 50 }), (e) => e.code === 'BAD_AMOUNT');
});

test('refuses a player from another session', async () => {
  const { sessionId } = await seed();
  const other = await seed();
  await assert.rejects(saveCashPayouts(db, sessionId, { [other.simon]: 50 }), (e) => e.code === 'UNKNOWN_PLAYER');
});

test('refuses while the game is still running', async () => {
  const { sessionId, simon } = await seed({ status: 'active' });
  await assert.rejects(saveCashPayouts(db, sessionId, { [simon]: 50 }), (e) => e.code === 'ACTIVE');
});

test('refuses an unknown session', async () => {
  await assert.rejects(saveCashPayouts(db, 'nope', {}), (e) => e.code === 'NOT_FOUND');
});
