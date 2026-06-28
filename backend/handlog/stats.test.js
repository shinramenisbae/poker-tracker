// Tests for the player-style stats engine (VPIP / PFR / AF).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { derive, computeStatsFromHands, initCounters } = require('./stats');

test('derive: zero hands → all zero, AF 0 (not NaN)', () => {
  const d = derive(initCounters());
  assert.equal(d.handsDealt, 0);
  assert.equal(d.vpip, 0);
  assert.equal(d.pfr, 0);
  assert.equal(d.af, 0);
});

test('derive: ratios and aggression factor', () => {
  const d = derive({
    handsDealt: 10, vpipHands: 3, pfrHands: 2,
    postflopBets: 4, postflopRaises: 2, postflopCalls: 3,
  });
  assert.equal(d.vpip, 0.3);
  assert.equal(d.pfr, 0.2);
  assert.equal(d.af, (4 + 2) / 3); // = 2
});

test('derive: AF is null (∞) when aggressive actions but zero calls', () => {
  const d = derive({ ...initCounters(), handsDealt: 5, postflopBets: 1, postflopRaises: 1, postflopCalls: 0 });
  assert.equal(d.af, null);
});

test('derive: AF is 0 when no postflop action at all', () => {
  const d = derive({ ...initCounters(), handsDealt: 5, postflopCalls: 0 });
  assert.equal(d.af, 0);
});

test('computeStatsFromHands: VPIP/PFR are preflop-only; AF counters are postflop-only', () => {
  const hand = {
    players: ['A @ 1', 'B @ 2'],
    actions: [
      { playerKey: 'A @ 1', type: 'raise', street: 'preflop' }, // VPIP + PFR for A
      { playerKey: 'B @ 2', type: 'calls', street: 'preflop' }, // VPIP only for B
      { playerKey: 'A @ 1', type: 'bets', street: 'flop' },     // postflop bet A
      { playerKey: 'B @ 2', type: 'raise', street: 'flop' },    // postflop raise B
      { playerKey: 'A @ 1', type: 'calls', street: 'flop' },    // postflop call A
    ],
  };
  const stats = computeStatsFromHands([hand]);

  assert.deepEqual(stats['A @ 1'], {
    handsDealt: 1, vpipHands: 1, pfrHands: 1,
    postflopBets: 1, postflopRaises: 0, postflopCalls: 1,
  });
  assert.deepEqual(stats['B @ 2'], {
    handsDealt: 1, vpipHands: 1, pfrHands: 0,
    postflopBets: 0, postflopRaises: 1, postflopCalls: 0,
  });
});

test('computeStatsFromHands: a preflop check (BB option) is not VPIP', () => {
  const hand = {
    players: ['A @ 1', 'B @ 2'],
    actions: [
      { playerKey: 'A @ 1', type: 'straddle', street: 'preflop' }, // voluntary → VPIP
      { playerKey: 'B @ 2', type: 'checks', street: 'preflop' },   // not voluntary
    ],
  };
  const stats = computeStatsFromHands([hand]);
  assert.equal(stats['A @ 1'].vpipHands, 1);
  assert.equal(stats['B @ 2'].vpipHands, 0);
});
