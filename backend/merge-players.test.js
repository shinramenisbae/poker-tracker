const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizePlayerName, planMerges } = require('./merge-players');

// Group A, 16 Sep: Leo cashed out for $79, rejoined, cashed out again for $504.
const leoTwice = [
  { id: 'leo1', name: 'Leo', firstBuyInAt: '2026-09-16T04:58:25.980Z', cashOutAmount: 79, cashOutDate: '2026-09-16T06:01:37.356Z' },
  { id: 'simon', name: 'Simon', firstBuyInAt: '2026-09-16T04:58:20.380Z', cashOutAmount: 1180, cashOutDate: '2026-09-16T11:26:59.799Z' },
  { id: 'leo2', name: 'leo ', firstBuyInAt: '2026-09-16T09:14:16.438Z', cashOutAmount: 504, cashOutDate: '2026-09-16T11:30:52.513Z' },
];

test('planMerges: the two Leos become one, keeping the earlier entry', () => {
  const plans = planMerges(leoTwice);
  assert.equal(plans.length, 1);
  assert.deepEqual(plans[0], {
    name: 'Leo',
    keepId: 'leo1',
    mergeIds: ['leo2'],
    cashOutAmount: 583,
    cashOutDate: '2026-09-16T11:30:52.513Z',
  });
});

test('planMerges: players who appear once are left alone', () => {
  assert.deepEqual(planMerges([leoTwice[1]]), []);
});

test('planMerges: names that only differ by case and spacing are one player', () => {
  const plans = planMerges([
    { id: 'a', name: 'Daniel H', firstBuyInAt: '2026-01-01T00:00:00.000Z', cashOutAmount: 10, cashOutDate: '2026-01-01T05:00:00.000Z' },
    { id: 'b', name: '  daniel   h ', firstBuyInAt: '2026-01-01T02:00:00.000Z', cashOutAmount: 5, cashOutDate: '2026-01-01T06:00:00.000Z' },
  ]);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].keepId, 'a');
  assert.equal(plans[0].name, 'Daniel H');
});

test('planMerges: different people with similar names stay separate', () => {
  const plans = planMerges([
    { id: 'a', name: 'Daniel', firstBuyInAt: '2026-01-01T00:00:00.000Z', cashOutAmount: 10, cashOutDate: '2026-01-01T05:00:00.000Z' },
    { id: 'b', name: 'Daniel H', firstBuyInAt: '2026-01-01T01:00:00.000Z', cashOutAmount: 20, cashOutDate: '2026-01-01T05:00:00.000Z' },
    { id: 'c', name: 'Daniel Y', firstBuyInAt: '2026-01-01T02:00:00.000Z', cashOutAmount: 30, cashOutDate: '2026-01-01T05:00:00.000Z' },
  ]);
  assert.deepEqual(plans, []);
});

test('planMerges: an entry with no buy-ins sorts after ones that have them', () => {
  const plans = planMerges([
    { id: 'late', name: 'Min', firstBuyInAt: null, cashOutAmount: 0, cashOutDate: '2026-01-01T06:00:00.000Z' },
    { id: 'first', name: 'Min', firstBuyInAt: '2026-01-01T01:00:00.000Z', cashOutAmount: 40, cashOutDate: '2026-01-01T05:00:00.000Z' },
  ]);
  assert.equal(plans[0].keepId, 'first');
  assert.deepEqual(plans[0].mergeIds, ['late']);
});

test('planMerges: a group where nobody cashed out keeps no cash-out', () => {
  const plans = planMerges([
    { id: 'a', name: 'Adam', firstBuyInAt: '2026-01-01T00:00:00.000Z', cashOutAmount: null, cashOutDate: null },
    { id: 'b', name: 'Adam', firstBuyInAt: '2026-01-01T01:00:00.000Z', cashOutAmount: null, cashOutDate: null },
  ]);
  assert.equal(plans[0].cashOutAmount, null);
  assert.equal(plans[0].cashOutDate, null);
});

test('planMerges: one entry still owing a cash-out contributes only what exists', () => {
  const plans = planMerges([
    { id: 'a', name: 'Adam', firstBuyInAt: '2026-01-01T00:00:00.000Z', cashOutAmount: 60, cashOutDate: '2026-01-01T05:00:00.000Z' },
    { id: 'b', name: 'Adam', firstBuyInAt: '2026-01-01T01:00:00.000Z', cashOutAmount: null, cashOutDate: null },
  ]);
  assert.equal(plans[0].cashOutAmount, 60);
  assert.equal(plans[0].cashOutDate, '2026-01-01T05:00:00.000Z');
});

test('planMerges: three entries of one player collapse into one', () => {
  const plans = planMerges([
    { id: 'a', name: 'Nick', firstBuyInAt: '2026-01-01T00:00:00.000Z', cashOutAmount: 10, cashOutDate: '2026-01-01T03:00:00.000Z' },
    { id: 'b', name: 'Nick', firstBuyInAt: '2026-01-01T01:00:00.000Z', cashOutAmount: 20, cashOutDate: '2026-01-01T04:00:00.000Z' },
    { id: 'c', name: 'Nick', firstBuyInAt: '2026-01-01T02:00:00.000Z', cashOutAmount: 30, cashOutDate: '2026-01-01T05:00:00.000Z' },
  ]);
  assert.deepEqual(plans[0].mergeIds, ['b', 'c']);
  assert.equal(plans[0].cashOutAmount, 60);
});

test('normalizePlayerName: trims, collapses spacing, ignores case', () => {
  assert.equal(normalizePlayerName('  Daniel   H '), 'daniel h');
  assert.equal(normalizePlayerName('Leo'), normalizePlayerName('leo '));
});
