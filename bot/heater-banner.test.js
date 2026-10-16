import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BIG_HEATER_AT, isBigHeater, splitBigHeaters, heaterBanner } from './heater-banner.js';

const hot = (playerName, length, event = 'extended') => ({ playerName, kind: 'hot', event, length });

test('the banner starts at 6 wins in a row — "more than 5"', () => {
  assert.equal(BIG_HEATER_AT, 6);
  assert.equal(isBigHeater(hot('Jeremy', 5)), false);
  assert.equal(isBigHeater(hot('Jeremy', 6)), true);
  assert.equal(isBigHeater(hot('Jeremy', 9)), true);
});

test('only a run still going gets a banner, never the one that just ended', () => {
  assert.equal(isBigHeater(hot('Jeremy', 7, 'broken')), false);
  // Six on the first night anyone looked is still six.
  assert.equal(isBigHeater(hot('Jeremy', 6, 'started')), true);
});

test('cold streaks never get the banner, however long', () => {
  assert.equal(isBigHeater({ playerName: 'Simon', kind: 'cold', event: 'extended', length: 8 }), false);
});

test('splitBigHeaters: big heaters come out, everything else stays in streak watch', () => {
  const big = hot('Jeremy', 6);
  const small = hot('Simon', 3, 'started');
  const ended = hot('Leo', 7, 'broken');
  assert.deepEqual(splitBigHeaters([big, small, ended]), { big: [big], rest: [small, ended] });
});

test('heaterBanner: a headline with the count, the name, and the ping', () => {
  const text = heaterBanner(hot('Jeremy', 6), '247247078261129217');
  const [headline, ...rest] = text.split('\n');
  assert.equal(headline, '# 🚨🔥 6 IN A ROW 🔥🚨');
  assert.match(rest.join('\n'), /\*\*Jeremy\*\* <@247247078261129217> has won 6 sessions straight\./);
});

test('heaterBanner: without a linked Discord account it names them without a ping', () => {
  const text = heaterBanner(hot('Jeremy', 7), null);
  assert.match(text, /\*\*Jeremy\*\* has won 7 sessions straight\./);
  assert.doesNotMatch(text, /<@/);
});

test('heaterBanner: the count keeps climbing on every win after six', () => {
  assert.match(heaterBanner(hot('Jeremy', 8), null), /^# 🚨🔥 8 IN A ROW 🔥🚨/);
});

test('heaterBanner: the same run on the same count reads the same, so a repost does not change it', () => {
  assert.equal(heaterBanner(hot('Jeremy', 6), null), heaterBanner(hot('Jeremy', 6), null));
});
