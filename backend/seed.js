// Whether to seed aliases-seed.json into a fresh database.
//
// That file holds the FIRST group's roster — real player names and the PokerNow
// nicknames they play under. Seeding it into a first-run database is how this
// deployment bootstrapped, and stays the default so nothing changes for it.
//
// A SECOND group's tracker must not inherit it: their alias screen would list
// 45 strangers, and the runbook promises each group its own players. Set
// SEED_ALIASES=0 on any instance that isn't the original.
//
// Kept separate from server.js so the rule is testable without a database.

/**
 * @param {object} env process.env-like
 * @param {number} existingRowCount rows already in alias_mappings
 * @returns {boolean}
 */
function shouldSeedAliases(env = {}, existingRowCount = 0) {
  if (String(env.SEED_ALIASES) === '0') return false;
  return existingRowCount === 0;
}

module.exports = { shouldSeedAliases };
