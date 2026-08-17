const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shouldSeedAliases } = require('./seed');

// aliases-seed.json holds the FIRST group's roster — real player names and
// their PokerNow nicknames. Seeding it into a second group's database hands
// that group a list of strangers, which is what happened to group B.

test('shouldSeedAliases: seeds a first-run database, as it always has', () => {
  assert.equal(shouldSeedAliases({}, 0), true);
});

test('shouldSeedAliases: never re-seeds a database that already has aliases', () => {
  assert.equal(shouldSeedAliases({}, 1), false);
  assert.equal(shouldSeedAliases({}, 214), false);
});

test('shouldSeedAliases: SEED_ALIASES=0 keeps another group\'s roster out', () => {
  assert.equal(shouldSeedAliases({ SEED_ALIASES: '0' }, 0), false);
});

test('shouldSeedAliases: any other SEED_ALIASES value leaves seeding on', () => {
  assert.equal(shouldSeedAliases({ SEED_ALIASES: '1' }, 0), true);
  assert.equal(shouldSeedAliases({ SEED_ALIASES: '' }, 0), true);
});
