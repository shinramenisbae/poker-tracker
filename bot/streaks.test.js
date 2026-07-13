import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStreakTransitions, isLatestCompletedSession } from './streaks.js';

// Build a completed session where each [name, profit] pair becomes a player
// with a single $100 buy-in and a cash-out of 100 + profit.
let seq = 0;
function sess(id, date, results, status = 'completed') {
  seq += 1;
  return {
    id,
    date,
    status,
    createdAt: `2026-01-01T00:00:${String(seq).padStart(2, '0')}Z`,
    players: results.map(([name, profit], i) => ({
      id: `${id}-p${i}`,
      name,
      buyIns: [{ amount: 100, method: 'bank' }],
      cashOut: { amount: 100 + profit },
    })),
  };
}

function only(transitions, name) {
  return transitions.filter((t) => t.playerName === name);
}

test('3 straight wins → hot started (2 wins is nothing)', () => {
  const sessions = [
    sess('s1', '2026-06-01', [['Jeremy', 50], ['Simon', -50]]),
    sess('s2', '2026-06-02', [['Jeremy', 20], ['Simon', -20]]),
    sess('s3', '2026-06-03', [['Jeremy', 10], ['Simon', -10]]),
  ];
  // After s2: only 2 in a row — nothing yet.
  assert.deepEqual(only(computeStreakTransitions(sessions, 's2'), 'Jeremy'), []);
  // After s3: hot started for Jeremy, cold started for Simon.
  const t3 = computeStreakTransitions(sessions, 's3');
  assert.deepEqual(only(t3, 'Jeremy'), [{ playerName: 'Jeremy', kind: 'hot', event: 'started', length: 3 }]);
  assert.deepEqual(only(t3, 'Simon'), [{ playerName: 'Simon', kind: 'cold', event: 'started', length: 3 }]);
});

test('4th straight win → hot extended', () => {
  const sessions = [
    sess('s1', '2026-06-01', [['Jeremy', 50]]),
    sess('s2', '2026-06-02', [['Jeremy', 20]]),
    sess('s3', '2026-06-03', [['Jeremy', 10]]),
    sess('s4', '2026-06-04', [['Jeremy', 5]]),
  ];
  assert.deepEqual(computeStreakTransitions(sessions, 's4'), [
    { playerName: 'Jeremy', kind: 'hot', event: 'extended', length: 4 },
  ]);
});

test('loss after a 3-win heater → hot broken (and no cold started)', () => {
  const sessions = [
    sess('s1', '2026-06-01', [['Jeremy', 50]]),
    sess('s2', '2026-06-02', [['Jeremy', 20]]),
    sess('s3', '2026-06-03', [['Jeremy', 10]]),
    sess('s4', '2026-06-04', [['Jeremy', -30]]),
  ];
  assert.deepEqual(computeStreakTransitions(sessions, 's4'), [
    { playerName: 'Jeremy', kind: 'hot', event: 'broken', length: 3 },
  ]);
});

test('win after a 3-loss freeze → cold broken', () => {
  const sessions = [
    sess('s1', '2026-06-01', [['Simon', -50]]),
    sess('s2', '2026-06-02', [['Simon', -20]]),
    sess('s3', '2026-06-03', [['Simon', -10]]),
    sess('s4', '2026-06-04', [['Simon', 40]]),
  ];
  assert.deepEqual(computeStreakTransitions(sessions, 's4'), [
    { playerName: 'Simon', kind: 'cold', event: 'broken', length: 3 },
  ]);
});

test('an exactly-even session breaks a would-be streak', () => {
  const sessions = [
    sess('s1', '2026-06-01', [['Jeremy', 50]]),
    sess('s2', '2026-06-02', [['Jeremy', 20]]),
    sess('s3', '2026-06-03', [['Jeremy', 0]]), // even
    sess('s4', '2026-06-04', [['Jeremy', 10]]),
  ];
  // s4 leaves Jeremy on a 1-win tail, not 3+ — no transition at all.
  assert.deepEqual(computeStreakTransitions(sessions, 's4'), []);
});

test('skipping a session does NOT break a streak', () => {
  const sessions = [
    sess('s1', '2026-06-01', [['Jeremy', 50]]),
    sess('s2', '2026-06-02', [['Jeremy', 20]]),
    sess('s3', '2026-06-03', [['Patt', 5]]), // Jeremy absent
    sess('s4', '2026-06-04', [['Jeremy', 10]]),
  ];
  assert.deepEqual(only(computeStreakTransitions(sessions, 's4'), 'Jeremy'), [
    { playerName: 'Jeremy', kind: 'hot', event: 'started', length: 3 },
  ]);
});

test('sessions AFTER the target are ignored (historic repost is accurate)', () => {
  const sessions = [
    sess('s1', '2026-06-01', [['Jeremy', 50]]),
    sess('s2', '2026-06-02', [['Jeremy', 20]]),
    sess('s3', '2026-06-03', [['Jeremy', 10]]),
    sess('s4', '2026-06-04', [['Jeremy', -99]]), // later loss must not matter
  ];
  assert.deepEqual(computeStreakTransitions(sessions, 's3'), [
    { playerName: 'Jeremy', kind: 'hot', event: 'started', length: 3 },
  ]);
});

test('active sessions and non-cashed-out players are excluded', () => {
  const active = sess('sX', '2026-06-02', [['Jeremy', 999]], 'active');
  const noCashOut = sess('s2', '2026-06-02', [['Jeremy', 20]]);
  noCashOut.players[0].cashOut = null;
  const sessions = [
    sess('s1', '2026-06-01', [['Jeremy', 50]]),
    active,
    noCashOut,
    sess('s3', '2026-06-03', [['Jeremy', 20]]),
    sess('s4', '2026-06-04', [['Jeremy', 10]]),
  ];
  // Played sequence is s1, s3, s4 = 3 wins → started.
  assert.deepEqual(computeStreakTransitions(sessions, 's4'), [
    { playerName: 'Jeremy', kind: 'hot', event: 'started', length: 3 },
  ]);
});

test('unknown session id → no transitions', () => {
  const sessions = [sess('s1', '2026-06-01', [['Jeremy', 50]])];
  assert.deepEqual(computeStreakTransitions(sessions, 'nope'), []);
});

test('isLatestCompletedSession: true only for the newest completed session', () => {
  const sessions = [
    sess('s1', '2026-06-01', [['Jeremy', 50]]),
    sess('s2', '2026-06-02', [['Jeremy', 20]]),
    sess('sA', '2026-06-03', [['Jeremy', 1]], 'active'),
  ];
  assert.equal(isLatestCompletedSession(sessions, 's2'), true);
  assert.equal(isLatestCompletedSession(sessions, 's1'), false);
  assert.equal(isLatestCompletedSession(sessions, 'sA'), false);
});
