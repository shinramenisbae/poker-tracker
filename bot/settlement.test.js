import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateSettlements, identifyBankPlayer } from './settlement.js';

// Mixed cash/bank session mirroring the reported scenario: the bank player is
// the biggest winner (no bankPlayerId stored), and two losers paid partly cash.
function mixedSession() {
  return {
    bankPlayerId: null, // force biggest-winner fallback
    players: [
      { id: 'luke', name: 'Luke', buyIns: [{ amount: 100, method: 'cash' }], cashOut: { amount: 570.5 } }, // +470.50
      { id: 'simon', name: 'Simon', buyIns: [{ amount: 100, method: 'cash' }, { amount: 108, method: 'bank' }], cashOut: { amount: 0 } }, // -208
      { id: 'ivan', name: 'Ivan', buyIns: [{ amount: 100, method: 'cash' }, { amount: 150, method: 'bank' }], cashOut: { amount: 0 } }, // -250
      { id: 'george', name: 'George', buyIns: [{ amount: 200, method: 'bank' }], cashOut: { amount: 0 } }, // -200 all bank
    ],
  };
}

test('identifyBankPlayer: picks the biggest winner', () => {
  assert.equal(identifyBankPlayer(mixedSession()), 'luke');
});

test('calculateSettlements: partly-cash losers owe only their bank shortfall', () => {
  const byName = Object.fromEntries(calculateSettlements(mixedSession()).map((s) => [s.playerName, s]));

  // Simon: $100 cash already on table, still owes the $108 bank buy-in.
  assert.equal(byName.Simon.profitLoss, -208);
  assert.equal(byName.Simon.cashBuyIn, 100);
  assert.equal(byName.Simon.bankOwed, 108);

  // Ivan: $100 cash on table, owes $150 via bank.
  assert.equal(byName.Ivan.profitLoss, -250);
  assert.equal(byName.Ivan.cashBuyIn, 100);
  assert.equal(byName.Ivan.bankOwed, 150);

  // George: all bank, owes the full $200, no cash component.
  assert.equal(byName.George.cashBuyIn, 0);
  assert.equal(byName.George.bankOwed, 200);
});

test('calculateSettlements: an all-bank loser has zero cashBuyIn (no cash annotation)', () => {
  const byName = Object.fromEntries(calculateSettlements(mixedSession()).map((s) => [s.playerName, s]));
  assert.ok(byName.George.cashBuyIn < 0.005, 'all-bank loser should not be annotated as paying cash');
});

test('calculateSettlements: respects an explicitly stored bankPlayerId', () => {
  const s = mixedSession();
  s.bankPlayerId = 'luke';
  const rows = calculateSettlements(s);
  const luke = rows.find((r) => r.playerId === 'luke');
  // Bank player collects cash from the pool rather than owing/receiving a transfer.
  assert.equal(luke.bankOwed, 0);
});

test('calculateSettlements: no winner (everyone flat/down) → empty', () => {
  const session = {
    bankPlayerId: null,
    players: [
      { id: 'a', name: 'A', buyIns: [{ amount: 100, method: 'cash' }], cashOut: { amount: 50 } },
      { id: 'b', name: 'B', buyIns: [{ amount: 100, method: 'cash' }], cashOut: { amount: 100 } },
    ],
  };
  // B broke even, A lost — no positive-profit player, so no bank → no settlement.
  assert.deepEqual(calculateSettlements(session), []);
});
