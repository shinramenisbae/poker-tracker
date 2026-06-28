// Tests for the Monte-Carlo equity calculator.
//
// Most assertions use scenarios with a DETERMINISTIC outcome (one side is
// drawing dead, or the board is already a made hand) so they never depend on
// RNG variance and can't flake in CI. One wide-tolerance sanity check covers
// the actual sampling path.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeEquity } = require('./equity');

test('drawing dead: quad aces vs nothing → 100% / 0% regardless of river', () => {
  // Board already has three aces; player A holds the case ace = quad aces, which
  // nothing in B's hand can beat on any river. Deterministic even via sampling.
  const eq = computeEquity({
    holeCards: [['Ah', 'Kd'], ['2c', '3d']],
    communityCards: ['As', 'Ad', 'Ac', 'Th'],
    gameType: 'holdem',
    samples: 2000,
  });
  assert.equal(eq[0], 1);
  assert.equal(eq[1], 0);
});

test('exact board (no cards to come): royal flush on board → split pot', () => {
  // Both players play the board (a royal flush). Exact/deterministic path.
  const eq = computeEquity({
    holeCards: [['2c', '3d'], ['4h', '5c']],
    communityCards: ['As', 'Ks', 'Qs', 'Js', 'Ts'],
    gameType: 'holdem',
    samples: 1000,
  });
  assert.equal(eq[0], 0.5);
  assert.equal(eq[1], 0.5);
});

test('exact board: made royal flush beats trips', () => {
  const eq = computeEquity({
    holeCards: [['Js', 'Ts'], ['2c', '2d']], // A: As Ks Qs Js Ts royal; B: trip 2s
    communityCards: ['As', 'Ks', 'Qs', '2h', '7d'],
    gameType: 'holdem',
    samples: 1000,
  });
  assert.equal(eq[0], 1);
  assert.equal(eq[1], 0);
});

test('equities sum to ~1 and AA vs KK preflop is ~82% (wide tolerance)', () => {
  const eq = computeEquity({
    holeCards: [['Ad', 'As'], ['Kd', 'Ks']],
    communityCards: [],
    gameType: 'holdem',
    samples: 20000,
  });
  assert.ok(Math.abs(eq[0] + eq[1] - 1) < 1e-9, `equities should sum to 1, got ${eq[0] + eq[1]}`);
  assert.ok(eq[0] > 0.78 && eq[0] < 0.86, `AA equity ~0.82 expected, got ${eq[0]}`);
});
