const { test } = require('node:test');
const assert = require('node:assert/strict');
const { balancesFrom, checkEntry } = require('./rake-ledger');

// What the group actually holds as of 16 Sep 2026.
const opening = [
  { kind: 'adjust', amount: 372.5, toName: 'Stephen', note: 'opening balance' },
  { kind: 'adjust', amount: 329, toName: 'Jordan', note: 'opening balance' },
  { kind: 'adjust', amount: 40, toName: 'Jeremy', note: 'opening balance' },
];

test('balancesFrom: opening balances add up to the pile', () => {
  const { total, holders } = balancesFrom(opening);
  assert.equal(total, 741.5);
  assert.deepEqual(holders, [
    { name: 'Stephen', balance: 372.5 },
    { name: 'Jordan', balance: 329 },
    { name: 'Jeremy', balance: 40 },
  ]);
});

test('balancesFrom: a session credits whoever holds that night s rake', () => {
  const { total, holders } = balancesFrom([
    ...opening,
    { kind: 'session', amount: 133, toName: 'Daniel H', sessionId: 's1' },
  ]);
  assert.equal(total, 874.5);
  assert.equal(holders.find((h) => h.name === 'Daniel H').balance, 133);
});

test('balancesFrom: spending leaves the pile', () => {
  const { total, holders } = balancesFrom([
    ...opening,
    { kind: 'spend', amount: 120, fromName: 'Jeremy', note: 'snacks' },
  ]);
  assert.equal(total, 621.5);
  assert.equal(holders.find((h) => h.name === 'Jeremy').balance, -80);
});

test('balancesFrom: a hand-over moves money without changing the pile', () => {
  const { total, holders } = balancesFrom([
    ...opening,
    { kind: 'give', amount: 329, fromName: 'Jordan', toName: 'Stephen' },
  ]);
  assert.equal(total, 741.5);
  assert.equal(holders.find((h) => h.name === 'Stephen').balance, 701.5);
  assert.equal(holders.some((h) => h.name === 'Jordan'), false, 'a zero balance is not listed');
});

test('balancesFrom: an adjustment can take money off someone', () => {
  const { total } = balancesFrom([
    ...opening,
    { kind: 'adjust', amount: 50, fromName: 'Stephen', note: 'miscount' },
  ]);
  assert.equal(total, 691.5);
});

test('balancesFrom: cents survive a long ledger', () => {
  const { total } = balancesFrom([
    { kind: 'adjust', amount: 0.1, toName: 'A' },
    { kind: 'adjust', amount: 0.2, toName: 'A' },
  ]);
  assert.equal(total, 0.3);
});

test('balancesFrom: nothing at all is an empty pile', () => {
  assert.deepEqual(balancesFrom([]), { total: 0, holders: [] });
});

test('checkEntry: spending what you hold is fine', () => {
  const balances = balancesFrom(opening);
  assert.deepEqual(checkEntry({ kind: 'spend', amount: 40, fromName: 'Jeremy' }, balances), { ok: true });
});

test('checkEntry: spending more than you hold is refused, with the real balance', () => {
  const balances = balancesFrom(opening);
  const result = checkEntry({ kind: 'spend', amount: 100, fromName: 'Jeremy' }, balances);
  assert.equal(result.ok, false);
  assert.match(result.reason, /\$40\.00/);
});

test('checkEntry: handing over more than you hold is refused', () => {
  const balances = balancesFrom(opening);
  const result = checkEntry({ kind: 'give', amount: 500, fromName: 'Jordan', toName: 'Stephen' }, balances);
  assert.equal(result.ok, false);
  assert.match(result.reason, /\$329\.00/);
});

test('checkEntry: an admin adjustment may take a balance negative', () => {
  // Corrections exist precisely for when the ledger disagrees with reality.
  const balances = balancesFrom(opening);
  assert.deepEqual(checkEntry({ kind: 'adjust', amount: 999, fromName: 'Jeremy' }, balances), { ok: true });
});

test('checkEntry: zero and negative amounts are refused', () => {
  const balances = balancesFrom(opening);
  assert.equal(checkEntry({ kind: 'spend', amount: 0, fromName: 'Jeremy' }, balances).ok, false);
  assert.equal(checkEntry({ kind: 'spend', amount: -5, fromName: 'Jeremy' }, balances).ok, false);
});

test('checkEntry: handing rake to yourself is refused', () => {
  const balances = balancesFrom(opening);
  const result = checkEntry({ kind: 'give', amount: 10, fromName: 'Stephen', toName: 'Stephen' }, balances);
  assert.equal(result.ok, false);
  assert.match(result.reason, /yourself/i);
});

test('checkEntry: an entry with nobody attached is refused', () => {
  const balances = balancesFrom(opening);
  assert.equal(checkEntry({ kind: 'spend', amount: 10 }, balances).ok, false);
  assert.equal(checkEntry({ kind: 'session', amount: 10 }, balances).ok, false);
});

test('checkEntry: an unknown kind is refused', () => {
  assert.equal(checkEntry({ kind: 'nonsense', amount: 10, toName: 'A' }, balancesFrom([])).ok, false);
});
