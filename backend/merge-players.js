// Which entries in one session are the same person.
//
// A player who cashes out early and rejoins is added again by hand, so the
// session ends up with two rows for one person: on 16 Sep 2026 Leo was both
// -$21 and +$4 instead of -$17. Ending a session collapses them.
//
// Pure: it decides, it does not touch the database. The same planning runs in
// scripts/merge-duplicate-players.js over past sessions.

/** Same person, typed differently: spacing and case carry no meaning. */
function normalizePlayerName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * @param {{id: string, name: string, firstBuyInAt: string|null,
 *          cashOutAmount: number|null, cashOutDate: string|null}[]} players
 * @returns {{name: string, keepId: string, mergeIds: string[],
 *            cashOutAmount: number|null, cashOutDate: string|null}[]}
 *   one entry per player who appears more than once; [] when nobody does
 */
function planMerges(players) {
  const groups = new Map();
  for (const player of players || []) {
    const key = normalizePlayerName(player.name);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(player);
  }

  const plans = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;

    // Earliest buy-in first; an entry that never bought in has no claim to
    // being the original, so it sorts last. Ties keep their existing order.
    const ordered = group
      .map((player, index) => ({ player, index }))
      .sort((a, b) => {
        const at = a.player.firstBuyInAt;
        const bt = b.player.firstBuyInAt;
        if (at !== bt) {
          if (at === null) return 1;
          if (bt === null) return -1;
          return at < bt ? -1 : 1;
        }
        return a.index - b.index;
      })
      .map((entry) => entry.player);

    const keep = ordered[0];
    const cashOuts = ordered.filter((p) => p.cashOutAmount != null);

    plans.push({
      name: keep.name,
      keepId: keep.id,
      // Database order, not sorted order: the UPDATE/DELETE don't care, and a
      // stable list reads better in the dry-run output.
      mergeIds: group.filter((p) => p.id !== keep.id).map((p) => p.id),
      cashOutAmount: cashOuts.length
        ? Math.round(cashOuts.reduce((sum, p) => sum + p.cashOutAmount, 0) * 100) / 100
        : null,
      cashOutDate: cashOuts.length
        ? cashOuts.map((p) => p.cashOutDate).filter(Boolean).sort().at(-1) ?? null
        : null,
    });
  }
  return plans;
}

module.exports = { normalizePlayerName, planMerges };
