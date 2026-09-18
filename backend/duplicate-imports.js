// Telling a player who came back from a ledger that was imported twice.
//
// Both look the same from a distance: one name, two rows. They need opposite
// treatment. A rejoin is one person's night split in two, so the rows add up.
// A re-import is the same row twice, so adding them up doubles someone's night
// and hides the evidence that the import ran twice.
//
// The 8 April 2026 online session has both patterns side by side: Jordan with
// $70 in and $764.71 out on two rows down to the timestamp (imported twice),
// and — in the in-person session of the same date — a Nick who was added and
// never played alongside the Nick who did (safe to collapse).
//
// Only the one-off history cleanup needs this. A session ending today came from
// the in-person flow, where every buy-in carries the moment it was tapped in, so
// two rows are never identical.

/**
 * What this row looks like as money: its buy-in amounts (order-independent),
 * its cash-out, and when it cashed out. Two rows with the same fingerprint are
 * the same row twice.
 *
 * Buy-in timestamps are deliberately left out. An import writes one per row as
 * it goes, so the same ledger imported twice produces rows seconds apart — on
 * 8 April 2026, 1.3 seconds. Including them would match nothing. The cash-out
 * time stays in, because it comes from the ledger rather than the clock: two
 * genuine stints end at different moments, two copies of one row do not.
 *
 * @param {{cashOutAmount: number|null, cashOutDate: string|null,
 *          buyIns: {amount: number}[]}} player
 * @returns {string}
 */
function playerFingerprint(player) {
  const buyIns = (player.buyIns || [])
    .map((b) => String(b.amount))
    .sort()
    .join(',');
  return `${buyIns}|${player.cashOutAmount ?? 'none'}|${player.cashOutDate ?? 'none'}`;
}

/**
 * Splits merge plans into the ones that are safe to apply and the ones that
 * look like a double import.
 *
 * A single cloned pair condemns the whole group: Nick's four rows on 8 April
 * are two pairs, and merging the other two would still double his night.
 *
 * @param {{name: string, keepId: string, mergeIds: string[]}[]} plans
 * @param {{id: string, cashOutAmount: number|null, buyIns: object[]}[]} players
 * @returns {{rejoins: object[], clones: {name: string, clonedRows: number, plan: object}[]}}
 */
function splitClonedPlans(plans, players) {
  const byId = new Map((players || []).map((p) => [p.id, p]));
  const rejoins = [];
  const clones = [];

  for (const plan of plans || []) {
    const ids = [plan.keepId, ...plan.mergeIds];
    const seen = new Map();
    let clonedRows = 0;
    for (const id of ids) {
      const player = byId.get(id);
      if (!player) continue;
      const fingerprint = playerFingerprint(player);
      if (seen.has(fingerprint)) clonedRows += 1;
      else seen.set(fingerprint, id);
    }
    if (clonedRows > 0) clones.push({ name: plan.name, clonedRows, plan });
    else rejoins.push(plan);
  }

  return { rejoins, clones };
}

module.exports = { playerFingerprint, splitClonedPlans };
