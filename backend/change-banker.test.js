const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canChangeBanker } = require('./change-banker');

const session = (over = {}) => ({
  id: 's1',
  status: 'completed',
  settledAt: null,
  players: [
    { id: 'p-danielh', name: 'Daniel H' },
    { id: 'p-stephen', name: 'Stephen' },
    { id: 'p-leo', name: 'Leo' },
  ],
  ...over,
});

test('canChangeBanker: a finished session with nobody paid yet can move', () => {
  assert.deepEqual(canChangeBanker({ session: session(), playerId: 'p-stephen', paidCount: 0 }), { ok: true });
});

test('canChangeBanker: the banker can be someone who lost on the night', () => {
  // The whole point: the biggest winner may be new to the group, and the money
  // is better left with a regular.
  assert.deepEqual(canChangeBanker({ session: session(), playerId: 'p-leo', paidCount: 0 }), { ok: true });
});

test('canChangeBanker: not while the game is still running', () => {
  const result = canChangeBanker({ session: session({ status: 'active' }), playerId: 'p-stephen', paidCount: 0 });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ACTIVE');
  assert.match(result.reason, /still/i);
});

test('canChangeBanker: not once someone has paid the old banker', () => {
  const result = canChangeBanker({ session: session(), playerId: 'p-stephen', paidCount: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PAID');
  assert.match(result.reason, /paid/i);
});

test('canChangeBanker: not once the books are closed', () => {
  const result = canChangeBanker({
    session: session({ settledAt: '2026-09-17T10:00:00.000Z' }),
    playerId: 'p-stephen',
    paidCount: 0,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'SETTLED');
});

test('canChangeBanker: the new banker has to have played that session', () => {
  const result = canChangeBanker({ session: session(), playerId: 'p-nobody', paidCount: 0 });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'UNKNOWN_PLAYER');
});

test('canChangeBanker: a payment outranks an unknown player in the refusal', () => {
  // Both wrong; the caller should hear the one they can do something about.
  const result = canChangeBanker({ session: session(), playerId: 'p-nobody', paidCount: 2 });
  assert.equal(result.code, 'PAID');
});
