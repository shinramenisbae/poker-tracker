const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rakeFromPlayers, isRakeRow } = require('./rake-session');

const player = (id, name, buyIns, cashOut) => ({
  id, name,
  buyIns: buyIns.map((amount) => ({ amount })),
  cashOutAmount: cashOut,
});

test('isRakeRow: the names rake has been entered under, and nothing else', () => {
  assert.equal(isRakeRow('Rake'), true);
  assert.equal(isRakeRow(' rake '), true);
  assert.equal(isRakeRow('rale'), true);            // 6 Sep 2026, a typo worth $130
  assert.equal(isRakeRow('stephen rake?'), true);   // 5 Jul 2026, an empty row
  assert.equal(isRakeRow('Drake'), false);          // a person, not the pile
  assert.equal(isRakeRow('Raketa'), false);
  assert.equal(isRakeRow('Stephen'), false);
});

test('rakeFromPlayers: a Rake player becomes that night s rake', () => {
  const result = rakeFromPlayers([
    player('p1', 'Simon', [100], 50),
    player('p2', 'Rake', [], 133),
  ]);
  assert.equal(result.amount, 133);
  assert.deepEqual(result.removeIds, ['p2']);
});

test('rakeFromPlayers: buy-ins on the Rake row come back off', () => {
  // 27 May 2026: the Rake row was given a $40 buy-in and an $80 cash-out, so
  // the rake was $40 and the session still balances once the row is gone.
  const result = rakeFromPlayers([player('p1', 'Rake', [40], 80)]);
  assert.equal(result.amount, 40);
});

test('rakeFromPlayers: an empty Rake row is removed and carries nothing', () => {
  const result = rakeFromPlayers([player('p1', 'stephen rake?', [], 0)]);
  assert.equal(result.amount, 0);
  assert.deepEqual(result.removeIds, ['p1']);
});

test('rakeFromPlayers: no Rake row, nothing to convert', () => {
  const result = rakeFromPlayers([player('p1', 'Simon', [100], 50)]);
  assert.equal(result.amount, 0);
  assert.deepEqual(result.removeIds, []);
});

test('rakeFromPlayers: a Rake row that never cashed out carries nothing', () => {
  const result = rakeFromPlayers([player('p1', 'Rake', [], null)]);
  assert.equal(result.amount, 0);
  assert.deepEqual(result.removeIds, ['p1']);
});

test('rakeFromPlayers: two Rake rows add up', () => {
  const result = rakeFromPlayers([player('p1', 'Rake', [], 100), player('p2', 'rake', [], 33)]);
  assert.equal(result.amount, 133);
  assert.deepEqual(result.removeIds, ['p1', 'p2']);
});
