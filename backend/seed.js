// Loading aliases-seed.json, or deliberately not.
//
// That file holds the FIRST group's roster — real player names and the PokerNow
// nicknames they play under. Loading it is how this deployment bootstrapped its
// alias table, and stays the default so nothing changes for it.
//
// A SECOND group's tracker must not inherit it, and it arrives by two routes:
//
//   1. the one-shot insert into alias_mappings on a first-run database, and
//   2. /api/alias-mappings, which folds canonical_players straight off the file
//      into every response — so an empty database is not enough on its own.
//
// Gating the load closes both at once: with SEED_ALIASES=0 there is simply no
// seed data for either to draw on. /link then rejects the other group's player
// names too, since it validates against canonicalPlayers.
//
// Kept separate from server.js so the rule is testable without a database.

const EMPTY = { aliases: [], canonical_players: [], initial_mappings: {} };

/**
 * @param {object} env process.env-like
 * @param {() => string} readSeedFile returns the raw file contents
 * @returns {{aliases: string[], canonical_players: string[], initial_mappings: object}}
 */
function loadAliasSeed(env = {}, readSeedFile) {
  if (String(env.SEED_ALIASES) === '0') return { ...EMPTY };
  let parsed;
  try {
    parsed = JSON.parse(readSeedFile());
  } catch {
    // A missing or malformed seed is not fatal: the alias UI just starts empty.
    return { ...EMPTY };
  }
  return {
    aliases: parsed.aliases || [],
    canonical_players: parsed.canonical_players || [],
    initial_mappings: parsed.initial_mappings || {},
  };
}

module.exports = { loadAliasSeed };
