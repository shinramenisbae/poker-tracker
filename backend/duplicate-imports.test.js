const { test } = require('node:test');
const assert = require('node:assert/strict');
const { playerFingerprint, splitClonedPlans } = require('./duplicate-imports');

// 8 Apr 2026 online, exactly as it sits in the database: the same ledger was
// imported twice, so Jordan has two rows with the same $70 buy-in and the same
// $764.71 cash-out. The rows are NOT byte-identical — each buy-in got its own
// timestamp as the import wrote it, 1.3 seconds apart — which is why matching
// on timestamps misses them entirely.
const jordanClone = { id: 'j1', cashOutAmount: 764.71, cashOutDate: '2026-04-08T20:00:00.000Z', buyIns: [{ amount: 70, timestamp: '2026-05-20T23:52:19.236Z' }] };
const jordanCloneToo = { id: 'j2', cashOutAmount: 764.71, cashOutDate: '2026-04-08T20:00:00.000Z', buyIns: [{ amount: 70, timestamp: '2026-05-20T23:52:20.570Z' }] };

// 16 Sep 2026 in-person: Leo really did cash out and buy back in later.
const leoFirst = { id: 'l1', cashOutAmount: 79, cashOutDate: '2026-09-16T06:01:37.356Z', buyIns: [{ amount: 100, timestamp: '2026-09-16T04:58:25.980Z' }] };
const leoAgain = {
  id: 'l2',
  cashOutAmount: 504,
  cashOutDate: '2026-09-16T11:30:52.513Z',
  buyIns: [
    { amount: 300, timestamp: '2026-09-16T09:14:16.438Z' },
    { amount: 200, timestamp: '2026-09-16T10:09:00.000Z' },
  ],
};

test('playerFingerprint: the same row imported twice matches despite its timestamps', () => {
  assert.equal(playerFingerprint(jordanClone), playerFingerprint(jordanCloneToo));
});

test('playerFingerprint: same money at a different time of night is a different row', () => {
  // Someone who buys in $100, busts, and buys in $100 again later has two rows
  // worth adding up — their cash-outs happened at different moments.
  const firstStint = { id: 'a', cashOutAmount: 0, cashOutDate: '2026-09-16T06:00:00.000Z', buyIns: [{ amount: 100, timestamp: '2026-09-16T04:00:00.000Z' }] };
  const secondStint = { id: 'b', cashOutAmount: 0, cashOutDate: '2026-09-16T11:00:00.000Z', buyIns: [{ amount: 100, timestamp: '2026-09-16T09:00:00.000Z' }] };
  assert.notEqual(playerFingerprint(firstStint), playerFingerprint(secondStint));
});

test('playerFingerprint: a later stint differs from the first', () => {
  assert.notEqual(playerFingerprint(leoFirst), playerFingerprint(leoAgain));
});

test('playerFingerprint: buy-in order does not matter', () => {
  const reversed = { ...leoAgain, id: 'x', buyIns: [...leoAgain.buyIns].reverse() };
  assert.equal(playerFingerprint(leoAgain), playerFingerprint(reversed));
});

test('playerFingerprint: an empty row differs from one that played', () => {
  assert.notEqual(
    playerFingerprint({ id: 'e', cashOutAmount: null, buyIns: [] }),
    playerFingerprint(leoFirst)
  );
});

test('splitClonedPlans: a rejoin is safe to merge', () => {
  const plans = [{ name: 'Leo', keepId: 'l1', mergeIds: ['l2'] }];
  const { rejoins, clones } = splitClonedPlans(plans, [leoFirst, leoAgain]);
  assert.equal(rejoins.length, 1);
  assert.deepEqual(clones, []);
});

test('splitClonedPlans: two identical rows are a re-import, not a rejoin', () => {
  const plans = [{ name: 'Jordan', keepId: 'j1', mergeIds: ['j2'] }];
  const { rejoins, clones } = splitClonedPlans(plans, [jordanClone, jordanCloneToo]);
  assert.deepEqual(rejoins, []);
  assert.equal(clones.length, 1);
  assert.equal(clones[0].name, 'Jordan');
});

test('splitClonedPlans: one clone pair condemns the whole group', () => {
  // Nick on 8 Apr: two identical big rows and two identical small ones. Summing
  // any of it would double his night.
  const nick = [
    { id: 'n1', cashOutAmount: 933.15, buyIns: [{ amount: 238.73, timestamp: '2026-04-08T23:52:00.000Z' }] },
    { id: 'n2', cashOutAmount: 50.4, buyIns: [{ amount: 50, timestamp: '2026-04-08T23:52:00.000Z' }] },
    { id: 'n3', cashOutAmount: 50.4, buyIns: [{ amount: 50, timestamp: '2026-04-08T23:52:00.000Z' }] },
    { id: 'n4', cashOutAmount: 933.15, buyIns: [{ amount: 238.73, timestamp: '2026-04-08T23:52:00.000Z' }] },
  ];
  const plans = [{ name: 'Nick', keepId: 'n1', mergeIds: ['n2', 'n3', 'n4'] }];
  const { rejoins, clones } = splitClonedPlans(plans, nick);
  assert.deepEqual(rejoins, []);
  assert.equal(clones[0].clonedRows, 2);
});

test('splitClonedPlans: a stray empty row is still a safe merge', () => {
  // "Nick (no buy-ins, cash-out 0) + Nick (238.73 in, 933.15 out)" — one is
  // somebody adding a name and never using it.
  const rows = [
    { id: 'a', cashOutAmount: 0, buyIns: [] },
    { id: 'b', cashOutAmount: 933.15, buyIns: [{ amount: 238.73, timestamp: '2026-04-08T09:17:00.000Z' }] },
  ];
  const plans = [{ name: 'Nick', keepId: 'a', mergeIds: ['b'] }];
  const { rejoins, clones } = splitClonedPlans(plans, rows);
  assert.equal(rejoins.length, 1);
  assert.deepEqual(clones, []);
});
