const { test, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.POKER_DB = ':memory:';
process.env.SEED_ALIASES = '0';
const db = require('./database');
const { allAsync, runAsync } = require('./db-async');
const { resolveMergedName, currentPlayerName, movePayments, redirectOf } = require('./merged-names');

after(() => db.close());

// removed_canonicals as group A had it on 27 Sep 2026.
const removed = [
  { name: 'Jermey 1', mergedInto: 'Jeremy' },
  { name: 'Dre', mergedInto: 'Jeremy' },
  { name: 'jeremy', mergedInto: 'Jeremy' },
];

test('resolveMergedName: a merged-away name comes back as the name it was merged into', () => {
  assert.equal(resolveMergedName('Dre', removed), 'Jeremy');
});

test('resolveMergedName: typed in any case or spacing, still the same person', () => {
  assert.equal(resolveMergedName('dre', removed), 'Jeremy');
  assert.equal(resolveMergedName('  DRE ', removed), 'Jeremy');
});

test('resolveMergedName: a merge that only fixed the case gives the proper spelling', () => {
  assert.equal(resolveMergedName('jeremy', removed), 'Jeremy');
});

test('resolveMergedName: the merge target itself is left alone', () => {
  assert.equal(resolveMergedName('Jeremy', removed), 'Jeremy');
});

test('resolveMergedName: a name nobody merged comes back exactly as typed', () => {
  assert.equal(resolveMergedName('Daniel Y', removed), 'Daniel Y');
});

test('resolveMergedName: follows a chain of merges to the end', () => {
  const chain = [{ name: 'A', mergedInto: 'B' }, { name: 'B', mergedInto: 'C' }];
  assert.equal(resolveMergedName('A', chain), 'C');
});

test('resolveMergedName: a deleted player is not renamed to nothing', () => {
  assert.equal(resolveMergedName('Ghost', [{ name: 'Ghost', mergedInto: null }]), 'Ghost');
});

test('resolveMergedName: a loop in the record cannot hang it', () => {
  const loop = [{ name: 'A', mergedInto: 'B' }, { name: 'B', mergedInto: 'A' }];
  assert.ok(['A', 'B'].includes(resolveMergedName('A', loop)));
});

test('currentPlayerName: reads the merge record from the database', async () => {
  await runAsync(db, `INSERT INTO removed_canonicals (name, mergedInto, removedAt) VALUES ('Dre', 'Jeremy', '2026-08-14T22:44:36.498Z')`);
  assert.equal(await currentPlayerName(db, 'Dre'), 'Jeremy');
  assert.equal(await currentPlayerName(db, 'Simon'), 'Simon');
});

let seq = 0;
async function session() {
  const id = `s${seq++}`;
  await runAsync(db, `INSERT INTO sessions (id, date, status, notes, gameType, createdAt, updatedAt)
                      VALUES (?, '2026-07-19', 'completed', 'test', 'in-person', '2026-07-19T00:00:00Z', '2026-07-19T00:00:00Z')`, [id]);
  return id;
}
const pay = (sessionId, playerName, paidAt, paidBy) => runAsync(db,
  'INSERT INTO session_payments (sessionId, playerName, paidAt, paidBy) VALUES (?, ?, ?, ?)',
  [sessionId, playerName, paidAt, paidBy]);
const marks = (sessionId) => allAsync(db,
  'SELECT playerName, paidAt, paidBy FROM session_payments WHERE sessionId = ? ORDER BY playerName', [sessionId]);

test('movePayments: a paid mark follows the player to the new name', async () => {
  // 12 Sep 2026: marked paid as "Dre", only ever as "Dre".
  const s = await session();
  await pay(s, 'Dre', '2026-09-13T04:31:33.412Z', 'Jeremy');
  await movePayments(db, 'Dre', 'Jeremy');
  assert.deepEqual(await marks(s), [{ playerName: 'Jeremy', paidAt: '2026-09-13T04:31:33.412Z', paidBy: 'Jeremy' }]);
});

test('movePayments: marked under both names, the earlier mark is the one kept', async () => {
  // 19 Jul 2026: he paid on 20 Jul as "Dre"; after the first merge left that
  // behind, Nick marked him paid again as "Jeremy" on 15 Aug.
  const s = await session();
  await pay(s, 'Dre', '2026-07-20T05:02:55.070Z', 'Jeremy');
  await pay(s, 'Jeremy', '2026-08-15T23:33:27.524Z', 'Nick');
  await movePayments(db, 'Dre', 'Jeremy');
  assert.deepEqual(await marks(s), [{ playerName: 'Jeremy', paidAt: '2026-07-20T05:02:55.070Z', paidBy: 'Jeremy' }]);
});

test('movePayments: when the new name was marked first, that mark stays', async () => {
  const s = await session();
  await pay(s, 'Jeremy', '2026-07-20T00:00:00.000Z', 'Stephen');
  await pay(s, 'Dre', '2026-08-01T00:00:00.000Z', 'Jeremy');
  await movePayments(db, 'Dre', 'Jeremy');
  assert.deepEqual(await marks(s), [{ playerName: 'Jeremy', paidAt: '2026-07-20T00:00:00.000Z', paidBy: 'Stephen' }]);
});

test('movePayments: other players\' marks are untouched', async () => {
  const s = await session();
  await pay(s, 'Dre', '2026-07-20T00:00:00.000Z', 'Jeremy');
  await pay(s, 'Simon', '2026-07-21T00:00:00.000Z', 'Simon');
  await movePayments(db, 'Dre', 'Jeremy');
  assert.deepEqual((await marks(s)).map((m) => m.playerName), ['Jeremy', 'Simon']);
});

// Telling the table when a typed name was redirected. On 9 Oct 2026 "Daniel H"
// was quietly entered as "Daniel" because of a merge that turned out wrong;
// saying so out loud is how the next wrong merge gets caught.
test('redirectOf: a merged-away name is reported as moved', () => {
  assert.deepEqual(redirectOf('Dre', 'Jeremy'), { from: 'Dre', to: 'Jeremy' });
});

test('redirectOf: the name as typed is what is reported', () => {
  assert.deepEqual(redirectOf('  dre ', 'Jeremy'), { from: 'dre', to: 'Jeremy' });
});

test('redirectOf: a name that stayed put says nothing', () => {
  assert.equal(redirectOf('Simon', 'Simon'), null);
});

test('redirectOf: fixing only the case or spacing is not worth a notice', () => {
  assert.equal(redirectOf('jeremy', 'Jeremy'), null);
  assert.equal(redirectOf('Daniel  Y', 'Daniel Y'), null);
});

test('redirectOf: nothing typed, nothing to say', () => {
  assert.equal(redirectOf(undefined, undefined), null);
  assert.equal(redirectOf('', ''), null);
});
