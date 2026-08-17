const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadAliasSeed } = require('./seed');

// aliases-seed.json holds the FIRST group's roster — real player names and the
// PokerNow nicknames they play under. It reaches a second group's tracker by
// two separate routes: the one-shot insert into alias_mappings, and
// /api/alias-mappings reading canonical_players straight off the file on every
// request. Gating the load itself closes both.

const SEED = JSON.stringify({
  aliases: ['Alfie Dwan', 'Actual patt'],
  canonical_players: ['Alfie', 'Patt'],
  initial_mappings: { 'Alfie Dwan': 'Alfie' },
});

test('loadAliasSeed: the original instance still gets its seed', () => {
  const seed = loadAliasSeed({}, () => SEED);
  assert.deepEqual(seed.canonical_players, ['Alfie', 'Patt']);
  assert.equal(seed.aliases.length, 2);
});

test('loadAliasSeed: SEED_ALIASES=0 yields an empty seed, not another group\'s roster', () => {
  const seed = loadAliasSeed({ SEED_ALIASES: '0' }, () => SEED);
  assert.deepEqual(seed.aliases, []);
  assert.deepEqual(seed.canonical_players, []);
  assert.deepEqual(seed.initial_mappings, {});
});

test('loadAliasSeed: never reads the file when seeding is off', () => {
  let read = false;
  loadAliasSeed({ SEED_ALIASES: '0' }, () => { read = true; return SEED; });
  assert.equal(read, false);
});

test('loadAliasSeed: an unreadable seed file degrades to empty rather than throwing', () => {
  const seed = loadAliasSeed({}, () => { throw new Error('ENOENT'); });
  assert.deepEqual(seed.canonical_players, []);
});

test('loadAliasSeed: malformed JSON degrades to empty too', () => {
  const seed = loadAliasSeed({}, () => '{not json');
  assert.deepEqual(seed.aliases, []);
});
