// Which tracker backend each Discord server talks to.
//
// One bot process can serve several servers, each with its own tracker (its own
// database, so no group can see another's sessions, stats or bank accounts).
// This module maps guildId -> tracker.
//
// SECURITY: the mapping is operator-controlled, supplied via the GUILD_TRACKERS
// env var. It deliberately cannot be set from Discord — if a server owner could
// name their own tracker URL, any owner could point their guild at another
// group's tracker and read its data. A guild that isn't listed resolves to no
// tracker at all, and the bot ignores it.
//
// GUILD_TRACKERS is JSON:
//   [{"guildId":"123","apiBase":"https://a.example.com/api","uiBase":"https://a.example.com","label":"Tribe A"}]
//
// LEGACY MODE: with GUILD_TRACKERS unset, the single TRACKER_API_BASE /
// TRACKER_UI_BASE pair is used for whatever guild the bot is in — exactly the
// pre-multi-server behaviour, so existing single-server deployments are
// unaffected.

function parseGuildTrackers(raw) {
  if (!raw || !String(raw).trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`GUILD_TRACKERS is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('GUILD_TRACKERS must be a JSON array of {guildId, apiBase, uiBase}');
  }
  return parsed.map((e, i) => {
    const guildId = String(e && e.guildId ? e.guildId : '').trim();
    const apiBase = String(e && e.apiBase ? e.apiBase : '').trim().replace(/\/$/, '');
    const uiBase = String(e && e.uiBase ? e.uiBase : '').trim().replace(/\/$/, '');
    if (!guildId) throw new Error(`GUILD_TRACKERS[${i}] is missing guildId`);
    if (!apiBase) throw new Error(`GUILD_TRACKERS[${i}] (guild ${guildId}) is missing apiBase`);
    return { guildId, apiBase, uiBase: uiBase || apiBase.replace(/\/api$/, ''), label: (e.label || '').trim() || guildId };
  });
}

/**
 * @param {object} env process.env-like
 * @returns {{entries: Array, byGuild: Map, legacy: boolean}}
 */
function buildRegistry(env = {}) {
  const configured = parseGuildTrackers(env.GUILD_TRACKERS);

  if (configured && configured.length > 0) {
    const byGuild = new Map();
    for (const e of configured) {
      if (byGuild.has(e.guildId)) {
        throw new Error(`GUILD_TRACKERS lists guild ${e.guildId} more than once`);
      }
      byGuild.set(e.guildId, e);
    }
    return { entries: configured, byGuild, legacy: false };
  }

  // Legacy single-tracker mode.
  const apiBase = String(env.TRACKER_API_BASE || '').trim().replace(/\/$/, '');
  const uiBase = String(env.TRACKER_UI_BASE || '').trim().replace(/\/$/, '');
  if (!apiBase) return { entries: [], byGuild: new Map(), legacy: true };
  const entry = { guildId: null, apiBase, uiBase: uiBase || apiBase.replace(/\/api$/, ''), label: 'default' };
  return { entries: [entry], byGuild: new Map(), legacy: true };
}

/**
 * Resolve the tracker for a guild. In legacy mode the single tracker serves
 * whatever guild asks. In configured mode an unlisted guild gets null — the
 * bot then does nothing there, which is the isolation guarantee.
 */
function trackerFor(registry, guildId) {
  if (!registry) return null;
  if (registry.legacy) return registry.entries[0] || null;
  if (!guildId) return null;
  return registry.byGuild.get(String(guildId)) || null;
}

export { buildRegistry, trackerFor, parseGuildTrackers };
