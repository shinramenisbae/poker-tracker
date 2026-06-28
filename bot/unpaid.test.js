import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unpaidDebtors, hasOutstanding } from './unpaid.js';

// Luke is the biggest winner (bank). George owes $200 via bank; Simon paid
// partly cash and owes $108 via bank; a pure cash loser owes nothing chaseable.
function session() {
  return {
    bankPlayerId: null,
    players: [
      { id: 'luke', name: 'Luke', buyIns: [{ amount: 100, method: 'cash' }], cashOut: { amount: 570.5 } },
      { id: 'simon', name: 'Simon', buyIns: [{ amount: 100, method: 'cash' }, { amount: 108, method: 'bank' }], cashOut: { amount: 0 } },
      { id: 'george', name: 'George', buyIns: [{ amount: 200, method: 'bank' }], cashOut: { amount: 0 } },
      { id: 'cashonly', name: 'CashOnly', buyIns: [{ amount: 50, method: 'cash' }], cashOut: { amount: 0 } },
    ],
  };
}

test('unpaidDebtors: lists bank-transfer debtors, sorted by amount desc', () => {
  const d = unpaidDebtors(session(), new Set());
  assert.deepEqual(d.map((x) => x.playerName), ['George', 'Simon']);
  assert.equal(d[0].owes, 200);
  assert.equal(d[1].owes, 108);
});

test('unpaidDebtors: a pure cash-on-table loser is not a debtor', () => {
  const names = unpaidDebtors(session(), new Set()).map((d) => d.playerName);
  assert.ok(!names.includes('CashOnly'));
});

test('unpaidDebtors: excludes players already marked paid', () => {
  const d = unpaidDebtors(session(), new Set(['George']));
  assert.deepEqual(d.map((x) => x.playerName), ['Simon']);
});

test('hasOutstanding: true until everyone has paid', () => {
  assert.equal(hasOutstanding(session(), new Set()), true);
  assert.equal(hasOutstanding(session(), new Set(['George'])), true);
  assert.equal(hasOutstanding(session(), new Set(['George', 'Simon'])), false);
});

test('unpaidDebtors: the bank player is never a debtor', () => {
  const names = unpaidDebtors(session(), new Set()).map((d) => d.playerName);
  assert.ok(!names.includes('Luke'));
});
