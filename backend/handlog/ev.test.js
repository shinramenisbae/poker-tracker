// Integration tests: raw PokerNow CSV → parseHandLog → computeSessionEv.
//
// Builds a minimal but realistic single-hand log (a preflop AA vs KK all-in
// that runs out) and asserts both the parse structure and the EV math. This is
// the end-to-end path the /handlog endpoint exercises.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseHandLog, computeSessionEv } = require('./ev');

// PokerNow stores each log line in a quoted `entry` column; the file is NOT in
// chronological order, so a real `order` key drives sorting. We emit increasing
// orders here. Suits use the unicode glyphs the real export uses.
function buildLog(entries) {
  const esc = (s) => `"${s.replace(/"/g, '""')}"`;
  const rows = entries.map((e, i) => `${esc(e)},2024-01-01T00:00:${String(i).padStart(2, '0')}Z,${i + 1}`);
  return 'entry,at,order\n' + rows.join('\n') + '\n';
}

const HEADS_UP_ALLIN = buildLog([
  `-- starting hand #1 (id: hand1) No Limit Texas Hold'em (dealer: "A @ 1") --`,
  `Player stacks: "A @ 1" (100.00) | "B @ 2" (100.00)`,
  `"A @ 1" posts a small blind of 0.50`,
  `"B @ 2" posts a big blind of 1.00`,
  `"A @ 1" raises to 100.00 and go all in`,
  `"B @ 2" calls 100.00 and go all in`,
  `Flop:  [2♣, 7♦, 9♠]`,
  `Turn: 2♣, 7♦, 9♠ [J♥]`,
  `River: 2♣, 7♦, 9♠, J♥ [3♣]`,
  `"A @ 1" shows a A♥, A♦.`,
  `"B @ 2" shows a K♥, K♦.`,
  `"A @ 1" collected 200.00 from pot`,
  `-- ending hand #1 --`,
]);

test('parseHandLog: extracts one hold\'em hand with players, board, cards, pot', () => {
  const hands = parseHandLog(HEADS_UP_ALLIN);
  assert.equal(hands.length, 1);
  const h = hands[0];
  assert.equal(h.handNumber, 1);
  assert.equal(h.gameType, 'holdem');
  assert.deepEqual(h.players, ['A @ 1', 'B @ 2']);
  assert.equal(h.allInPlayers.length, 2);
  assert.deepEqual(h.finalBoards.primary, ['2c', '7d', '9s', 'Jh', '3c']);
  assert.deepEqual(h.shownCards['A @ 1'], ['Ah', 'Ad']);
  assert.deepEqual(h.shownCards['B @ 2'], ['Kh', 'Kd']);
  assert.equal(h.collected['A @ 1'], 200);
  // The all-in happened preflop, so the board snapshot at all-in is empty.
  assert.deepEqual(h.boardAtAllIn[0], []);
});

test('computeSessionEv: actual net is zero-sum and matches the pot', () => {
  const { hands } = computeSessionEv(HEADS_UP_ALLIN, { samples: 4000 });
  assert.equal(hands.length, 1);
  const pp = hands[0].perPlayer;
  assert.equal(pp['A @ 1'].actualNet, 100);  // won the 200 pot, put in 100
  assert.equal(pp['B @ 2'].actualNet, -100);
  assert.ok(hands[0].hasAllInEv, 'a shown all-in with a run-out should be EV-eligible');
});

test('computeSessionEv: expected net reflects ~82/18 equity and stays zero-sum', () => {
  const { hands } = computeSessionEv(HEADS_UP_ALLIN, { samples: 4000 });
  const pp = hands[0].perPlayer;

  // AA is ~82% of a 200 pot → expected net ≈ 0.82*200 - 100 ≈ +64.
  assert.ok(pp['A @ 1'].expectedNet > 55 && pp['A @ 1'].expectedNet < 73,
    `AA expected net ~+64, got ${pp['A @ 1'].expectedNet}`);
  assert.ok(pp['A @ 1'].isAllInEv && pp['B @ 2'].isAllInEv);

  // Expected nets must cancel exactly (heads-up, equal contributions).
  const sum = pp['A @ 1'].expectedNet + pp['B @ 2'].expectedNet;
  assert.ok(Math.abs(sum) < 1e-9, `expected nets should be zero-sum, got ${sum}`);
});

test('computeSessionEv: a fold-out (no shown all-in) is not EV-eligible', () => {
  const log = buildLog([
    `-- starting hand #2 (id: hand2) No Limit Texas Hold'em (dealer: "A @ 1") --`,
    `Player stacks: "A @ 1" (100.00) | "B @ 2" (100.00)`,
    `"A @ 1" posts a small blind of 0.50`,
    `"B @ 2" posts a big blind of 1.00`,
    `"A @ 1" raises to 3.00`,
    `"B @ 2" folds`,
    `"A @ 1" collected 2.00 from pot`,
    `-- ending hand #2 --`,
  ]);
  const { hands } = computeSessionEv(log, { samples: 1000 });
  assert.equal(hands[0].hasAllInEv, false);
  // Uncalled portion of the raise is returned, so A nets just the BB they won.
  assert.equal(hands[0].perPlayer['A @ 1'].expectedNet, hands[0].perPlayer['A @ 1'].actualNet);
});

// Regression: the most common all-in pattern is a shove that a BIGGER stack
// CALLS. PokerNow only tags the shover "...and go all in"; the caller has chips
// behind so their line is a plain "calls X" (not tagged all-in). So the hand
// has exactly ONE declared all-in. The old gate required >=2 declared all-ins
// and silently dropped these real races (3 eligible instead of 9 on a real
// 191-hand log). It must now qualify off the two-way showdown.
test('computeSessionEv: shove + covering call (1 declared all-in) IS EV-eligible', () => {
  const log = buildLog([
    `-- starting hand #3 (id: hand3) No Limit Texas Hold'em (dealer: "A @ 1") --`,
    `Player stacks: "A @ 1" (50.00) | "B @ 2" (200.00)`, // B covers A
    `"A @ 1" posts a small blind of 0.50`,
    `"B @ 2" posts a big blind of 1.00`,
    `"A @ 1" raises to 50.00 and go all in`,             // shover: tagged all-in
    `"B @ 2" calls 50.00`,                                // caller: NOT tagged (chips behind)
    `Flop:  [2♣, 7♦, 9♠]`,
    `Turn: 2♣, 7♦, 9♠ [J♥]`,
    `River: 2♣, 7♦, 9♠, J♥ [3♣]`,
    `"A @ 1" shows a A♥, A♦.`,
    `"B @ 2" shows a K♥, K♦.`,
    `"A @ 1" collected 100.00 from pot`,
    `-- ending hand #3 --`,
  ]);
  const { hands } = computeSessionEv(log, { samples: 4000 });
  assert.equal(hands[0].hasAllInEv, true, 'a shove + covering call must qualify');
  const pp = hands[0].perPlayer;
  assert.ok(pp['A @ 1'].isAllInEv && pp['B @ 2'].isAllInEv);
  // AA ~82% of the 100 pot → expected net ≈ +64; both sides EV-charted, zero-sum.
  assert.ok(pp['A @ 1'].expectedNet > 27 && pp['A @ 1'].expectedNet < 37,
    `AA expected net ~+32, got ${pp['A @ 1'].expectedNet}`);
  assert.ok(Math.abs(pp['A @ 1'].expectedNet + pp['B @ 2'].expectedNet) < 1e-9, 'expected nets zero-sum');
});

// A lone shove that everyone FOLDS to (one declared all-in, no second committed
// player) must still be excluded — relaxing the gate to >=1 must not let these
// through. This is what the showdownCommitted >= 2 check guards.
test('computeSessionEv: uncalled shove (everyone folds) is NOT EV-eligible', () => {
  const log = buildLog([
    `-- starting hand #4 (id: hand4) No Limit Texas Hold'em (dealer: "A @ 1") --`,
    `Player stacks: "A @ 1" (50.00) | "B @ 2" (50.00)`,
    `"A @ 1" posts a small blind of 0.50`,
    `"B @ 2" posts a big blind of 1.00`,
    `"A @ 1" raises to 50.00 and go all in`,
    `"B @ 2" folds`,
    `"A @ 1" collected 2.00 from pot`,
    `-- ending hand #4 --`,
  ]);
  const { hands } = computeSessionEv(log, { samples: 1000 });
  assert.equal(hands[0].hasAllInEv, false, 'an uncalled shove has no showdown to compute equity over');
});
