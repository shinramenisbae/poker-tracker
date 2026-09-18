#!/usr/bin/env node
// One-off cleanup: collapse duplicate entries of one player in PAST sessions.
//
// From now on POST /api/sessions/:id/end does this when a session ends. Group A
// carries older sessions with a repeated name — mostly online imports from
// before the bot aggregated by canonical name, plus a few in-person nights
// where someone cashed out, came back, and was added again.
//
//   node scripts/merge-duplicate-players.js                   # dry run, prints every merge
//   node scripts/merge-duplicate-players.js --apply           # writes, after a backup
//   POKER_DB=/srv/poker-b/poker.db node scripts/... --apply   # the other group
//
// Nobody's totals change: buy-ins move to the surviving row and cash-outs are
// added together. Only the duplicate rows disappear.
//
// One thing it refuses to touch: rows that are identical down to the buy-in
// timestamps, which is a ledger imported twice rather than a player coming
// back. Adding those up would double someone's night and bury the evidence, so
// they are only listed, under "re-imports", for a separate decision.

const path = require('path');
const BACKEND = path.join(__dirname, '..', 'backend');
const sqlite3 = require(path.join(BACKEND, 'node_modules', 'sqlite3'));
const { planMerges } = require(path.join(BACKEND, 'merge-players'));
const { splitClonedPlans } = require(path.join(BACKEND, 'duplicate-imports'));
const { runAsync, allAsync, withTransaction } = require(path.join(BACKEND, 'db-async'));

const apply = process.argv.includes('--apply');
const dbPath = process.env.POKER_DB || path.join(BACKEND, 'poker.db');

async function main() {
  console.log(`${apply ? 'APPLYING to' : 'Dry run against'} ${dbPath}\n`);
  const db = new sqlite3.Database(dbPath, apply ? sqlite3.OPEN_READWRITE : sqlite3.OPEN_READONLY);
  const sessions = await allAsync(db, 'SELECT id, date, notes, gameType, bankPlayerId FROM sessions ORDER BY date');

  let sessionsTouched = 0;
  let rowsRemoved = 0;
  const reimports = [];

  for (const session of sessions) {
    const players = await allAsync(db, `
      SELECT p.id, p.name, p.cashOutAmount, p.cashOutDate,
             (SELECT MIN(timestamp) FROM buyIns WHERE playerId = p.id) AS firstBuyInAt
      FROM players p WHERE p.sessionId = ? ORDER BY p.rowid`, [session.id]);

    const buyIns = await allAsync(db, `
      SELECT b.playerId, b.amount, b.timestamp FROM buyIns b
      JOIN players p ON p.id = b.playerId WHERE p.sessionId = ?`, [session.id]);
    const withBuyIns = players.map((p) => ({
      ...p,
      buyIns: buyIns.filter((b) => b.playerId === p.id),
    }));

    const allPlans = planMerges(players);
    const { rejoins: plans, clones } = splitClonedPlans(allPlans, withBuyIns);

    for (const clone of clones) {
      reimports.push(`${session.date}  ${session.gameType}  "${session.notes || ''}"  ${clone.name} (${clone.clonedRows} repeated row${clone.clonedRows > 1 ? 's' : ''})`);
    }

    if (plans.length === 0) continue;
    sessionsTouched += 1;

    console.log(`${session.date}  ${session.gameType}  "${session.notes || ''}"`);
    for (const plan of plans) {
      const rows = [plan.keepId, ...plan.mergeIds].map((id) => {
        const p = players.find((x) => x.id === id);
        const buyIns = p.firstBuyInAt ? `from ${p.firstBuyInAt.slice(11, 16)}` : 'no buy-ins';
        return `${JSON.stringify(p.name)} (${buyIns}, cash-out ${p.cashOutAmount ?? 'none'})`;
      });
      console.log(`  ${plan.name}: ${rows.join(' + ')}  ->  cash-out ${plan.cashOutAmount ?? 'none'}`);
      rowsRemoved += plan.mergeIds.length;
      if (session.bankPlayerId && plan.mergeIds.includes(session.bankPlayerId)) {
        console.log(`    banker was a merged-away row — repointing to ${plan.keepId}`);
      }
    }

    if (!apply) continue;

    await withTransaction(db, async () => {
      for (const plan of plans) {
        const holes = plan.mergeIds.map(() => '?').join(', ');
        await runAsync(db, `UPDATE buyIns SET playerId = ? WHERE playerId IN (${holes})`,
          [plan.keepId, ...plan.mergeIds]);
        await runAsync(db, 'UPDATE players SET cashOutAmount = ?, cashOutDate = ? WHERE id = ?',
          [plan.cashOutAmount, plan.cashOutDate, plan.keepId]);
        await runAsync(db, `DELETE FROM players WHERE id IN (${holes})`, plan.mergeIds);
        if (session.bankPlayerId && plan.mergeIds.includes(session.bankPlayerId)) {
          await runAsync(db, 'UPDATE sessions SET bankPlayerId = ? WHERE id = ?', [plan.keepId, session.id]);
        }
      }
    });
  }

  console.log(`\n${apply ? 'Merged' : 'Would merge'}: ${sessionsTouched} sessions, ${rowsRemoved} duplicate rows removed.`);

  if (reimports.length > 0) {
    console.log(`\nSKIPPED — ${reimports.length} look like a ledger imported twice, not a player coming back.`);
    console.log('Their rows are identical down to the buy-in timestamps, so adding them up would');
    console.log('double that player\'s night. Deleting the repeats is the fix, and it is a separate job.\n');
    for (const line of reimports) console.log(`  ${line}`);
  }

  if (!apply) console.log('\nDry run. Re-run with --apply (after scripts/backup-db.sh) to write.');
  db.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
