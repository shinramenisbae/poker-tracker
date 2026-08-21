import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateDebts, formatDebtsBoard } from './debts.js';

// Two completed sessions. In s1 Luke banks; George owes $200, Simon $108.
// In s2 Patt banks and George owes another $50.
function s1(over = {}) {
  return {
    id: 's1', date: '2026-08-01', status: 'completed', bankPlayerId: null, settledAt: null,
    players: [
      { id: 'luke', name: 'Luke', buyIns: [{ amount: 100, method: 'cash' }], cashOut: { amount: 570.5 } },
      { id: 'simon', name: 'Simon', buyIns: [{ amount: 100, method: 'cash' }, { amount: 108, method: 'bank' }], cashOut: { amount: 0 } },
      { id: 'george', name: 'George', buyIns: [{ amount: 200, method: 'bank' }], cashOut: { amount: 0 } },
    ],
    ...over,
  };
}
function s2(over = {}) {
  return {
    id: 's2', date: '2026-08-08', status: 'completed', bankPlayerId: null, settledAt: null,
    players: [
      { id: 'patt', name: 'Patt', buyIns: [{ amount: 50, method: 'cash' }], cashOut: { amount: 100 } },
      { id: 'george', name: 'George', buyIns: [{ amount: 50, method: 'bank' }], cashOut: { amount: 0 } },
    ],
    ...over,
  };
}

test('aggregateDebts: sums a player across sessions and counts them', () => {
  const rows = aggregateDebts([s1(), s2()], {});
  const george = rows.find((r) => r.playerName === 'George');
  assert.equal(george.total, 250);
  assert.equal(george.sessionCount, 2);
});

test('aggregateDebts: sorted biggest debtor first', () => {
  const rows = aggregateDebts([s1(), s2()], {});
  assert.deepEqual(rows.map((r) => r.playerName), ['George', 'Simon']);
});

test('aggregateDebts: a player marked paid in one session still owes the other', () => {
  const payments = { s1: { George: { paidAt: 'x' } } };
  const george = aggregateDebts([s1(), s2()], payments).find((r) => r.playerName === 'George');
  assert.equal(george.total, 50);
  assert.equal(george.sessionCount, 1);
});

test('aggregateDebts: fully paid players do not appear', () => {
  const payments = { s1: { George: {}, Simon: {} }, s2: { George: {} } };
  assert.deepEqual(aggregateDebts([s1(), s2()], payments), []);
});

test('aggregateDebts: an active session contributes nothing', () => {
  const active = s2({ status: 'active', players: [{ id: 'x', name: 'X', buyIns: [{ amount: 50, method: 'bank' }] }] });
  const rows = aggregateDebts([s1(), active], {});
  assert.ok(!rows.some((r) => r.playerName === 'X'));
});

test('aggregateDebts: a settled session contributes nothing', () => {
  const rows = aggregateDebts([s1({ settledAt: '2026-08-02T00:00:00Z' }), s2()], {});
  assert.deepEqual(rows.map((r) => r.playerName), ['George']);
  assert.equal(rows[0].total, 50);
});

test('aggregateDebts: no sessions means no rows', () => {
  assert.deepEqual(aggregateDebts([], {}), []);
});

// --- the message ---

test('formatDebtsBoard: names, amounts and session counts, no mention syntax', () => {
  const text = formatDebtsBoard(aggregateDebts([s1(), s2()], {}));
  assert.match(text, /George.*\$250\.00.*2 sessions/);
  assert.match(text, /Simon.*\$108\.00.*1 session\b/);
  assert.doesNotMatch(text, /<@/);
});

test('formatDebtsBoard: empty is a celebration, not a blank table', () => {
  assert.match(formatDebtsBoard([]), /nobody owes|no outstanding/i);
});

test('formatDebtsBoard: caps the list and says how many were cut', () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ playerName: `P${i}`, total: 100 - i, sessionCount: 1 }));
  const text = formatDebtsBoard(rows, { cap: 20 });
  assert.match(text, /and 10 more/i);
  assert.ok(!text.includes('P25'));
});

test('formatDebtsBoard: stays under Discord\'s 2000-character limit even when huge', () => {
  const rows = Array.from({ length: 500 }, (_, i) => ({ playerName: `LongPlayerName${i}`, total: 12345.67, sessionCount: 12 }));
  assert.ok(formatDebtsBoard(rows).length <= 2000);
});
