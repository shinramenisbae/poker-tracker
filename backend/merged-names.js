// Keeping a merged player merged.
//
// Merging "Dre" into "Jeremy" on the aliases page renames every row that
// exists at that moment and records the merge in removed_canonicals. Two
// things then went wrong for Jeremy.
//
// The name came back. In-person players are typed in by hand, and nothing
// looked at the merge record, so on 19 Aug, 12 Sep and 25 Sep 2026 he was
// entered as "Dre" again. Those rows belonged to nobody the tracker knew:
// no bank account on the results post, a streak of his own, and invisible
// on the aliases page — which hides merged-away names — so they could not
// even be merged a second time.
//
// The payments stayed behind. session_payments is keyed by player name and
// the merge did not touch it, so every session he had been marked paid for
// as "Dre" showed him unpaid again as "Jeremy". On 15 Aug two people
// re-marked him paid for 19 Jul and 1 Aug, leaving each session with a paid
// row under both names.

const { normalizePlayerName } = require('./merge-players');
const { allAsync, runAsync } = require('./db-async');

/**
 * The name a player goes by now, given the merges recorded so far.
 *
 * Follows a chain (A merged into B, later B into C) and matches the way
 * planMerges does — spacing and case carry no meaning — so "dre" lands on
 * "Jeremy" as surely as "Dre" does. A deletion (no merge target) is not a
 * rename, and a name nobody merged away comes back exactly as typed.
 *
 * @param {string} name as typed
 * @param {{name: string, mergedInto: string|null}[]} removed removed_canonicals rows
 * @returns {string}
 */
function resolveMergedName(name, removed = []) {
  const into = new Map();
  for (const row of removed) {
    if (row.mergedInto) into.set(normalizePlayerName(row.name), row.mergedInto);
  }

  let current = name;
  const seen = new Set();
  for (;;) {
    const key = normalizePlayerName(current);
    const next = into.get(key);
    if (!next || seen.has(key)) return current;
    seen.add(key);
    current = next;
    // A merge that only fixed the case ("jeremy" into "Jeremy") points back at
    // itself: take its spelling and stop.
    if (normalizePlayerName(next) === key) return next;
  }
}

/**
 * Whether a typed name was moved onto someone else, worth telling the table.
 *
 * A redirect is only as right as the merge behind it. "Daniel H" was merged
 * into "Daniel" on 29 Jul 2026 although they are two people, and on 9 Oct he
 * was entered as "Daniel" without anyone being told. Reporting the move is
 * what lets the table catch a wrong merge on the night. A fix to the case or
 * spacing alone ("jeremy" to "Jeremy") is not news and is not reported.
 *
 * @param {string} typed
 * @param {string} resolved what resolveMergedName made of it
 * @returns {{from: string, to: string} | null}
 */
function redirectOf(typed, resolved) {
  if (typeof typed !== 'string' || !typed.trim()) return null;
  if (normalizePlayerName(typed) === normalizePlayerName(resolved)) return null;
  return { from: typed.trim(), to: resolved };
}

/** resolveMergedName against the database's merge record. */
async function currentPlayerName(db, name) {
  if (typeof name !== 'string' || !name.trim()) return name;
  const removed = await allAsync(db, 'SELECT name, mergedInto FROM removed_canonicals');
  return resolveMergedName(name, removed);
}

/**
 * Move one player's "paid" marks onto the name they were merged into.
 *
 * A session can already hold a mark under both names — someone re-marked the
 * player after an earlier merge left the old one behind. The earlier mark is
 * the one that records when they actually paid, so it survives, under the new
 * name.
 *
 * @returns {Promise<number>} marks now filed under `into` that were under `from`
 */
async function movePayments(db, from, into) {
  await runAsync(db, `
    DELETE FROM session_payments
     WHERE playerName = ?
       AND EXISTS (SELECT 1 FROM session_payments old
                    WHERE old.sessionId = session_payments.sessionId
                      AND old.playerName = ? AND old.paidAt < session_payments.paidAt)`,
  [into, from]);
  await runAsync(db, `
    DELETE FROM session_payments
     WHERE playerName = ?
       AND EXISTS (SELECT 1 FROM session_payments kept
                    WHERE kept.sessionId = session_payments.sessionId AND kept.playerName = ?)`,
  [from, into]);
  const { changes } = await runAsync(db,
    'UPDATE session_payments SET playerName = ? WHERE playerName = ?', [into, from]);
  return changes;
}

module.exports = { resolveMergedName, redirectOf, currentPlayerName, movePayments };
