#!/usr/bin/env node
// One-off: turn the old "Rake" players into each session's rake field.
//
// For 22 group A sessions the night's rake was recorded by adding a player
// called Rake (or "rale", or "stephen rake?") and cashing it out for the take.
// That made the pile look like a player: it won those sessions, appeared in the
// settlement, and sat near the top of the player stats.
//
//   node scripts/convert-rake-players.js                    # dry run
//   node scripts/convert-rake-players.js --apply            # writes, after a backup
//   POKER_DB=/srv/poker-b/poker.db node scripts/... --apply # the other group
//
// The rake is cash-out minus buy-ins, because a couple of rows were given
// buy-ins too — 27 May 2026 had $40 in and $80 out, which is $40 of rake — and
// the difference keeps the session's pot balanced once the row is gone.
//
// No ledger entries are written. These sessions are before the cut-off and
// their money is already inside the opening balances, so crediting anyone now
// would count it twice. Deleting the rows is also what removes "Rake", "rale"
// and "stephen rake?" from the aliases list, since that list is built from the
// players who exist.

const path = require('path');
const BACKEND = path.join(__dirname, '..', 'backend');
const sqlite3 = require(path.join(BACKEND, 'node_modules', 'sqlite3'));
const { rakeFromPlayers, isRakeRow } = require(path.join(BACKEND, 'rake-session'));
const { runAsync, allAsync, withTransaction } = require(path.join(BACKEND, 'db-async'));

const apply = process.argv.includes('--apply');
const dbPath = process.env.POKER_DB || path.join(BACKEND, 'poker.db');

async function main() {
  console.log(`${apply ? 'APPLYING to' : 'Dry run against'} ${dbPath}\n`);
  const db = new sqlite3.Database(dbPath, apply ? sqlite3.OPEN_READWRITE : sqlite3.OPEN_READONLY);

  const rows = await allAsync(db, `
    SELECT p.id, p.name, p.sessionId, p.cashOutAmount, s.date, s.notes, s.rakeAmount AS existingRake
    FROM players p JOIN sessions s ON s.id = p.sessionId
    ORDER BY s.date`);
  const rakeRows = rows.filter((r) => isRakeRow(r.name));

  let converted = 0;
  let emptied = 0;
  let total = 0;

  for (const row of rakeRows) {
    const buyIns = await allAsync(db, 'SELECT amount FROM buyIns WHERE playerId = ?', [row.id]);
    const { amount } = rakeFromPlayers([{ ...row, buyIns, cashOutAmount: row.cashOutAmount }]);
    const buyInTotal = buyIns.reduce((sum, b) => sum + b.amount, 0);

    const detail = buyInTotal > 0 ? ` (cash-out ${row.cashOutAmount} − buy-ins ${buyInTotal})` : '';
    if (amount === 0) {
      console.log(`${row.date}  "${row.notes || ''}"  ${JSON.stringify(row.name)} — empty row, deleting`);
      emptied += 1;
    } else {
      console.log(`${row.date}  "${row.notes || ''}"  ${JSON.stringify(row.name)} → rake $${amount}${detail}`);
      converted += 1;
      total += amount;
    }

    if (!apply) continue;

    await withTransaction(db, async () => {
      if (amount !== 0) {
        await runAsync(db, 'UPDATE sessions SET rakeAmount = rakeAmount + ? WHERE id = ?', [amount, row.sessionId]);
      }
      await runAsync(db, 'DELETE FROM buyIns WHERE playerId = ?', [row.id]);
      await runAsync(db, 'DELETE FROM players WHERE id = ?', [row.id]);
    });
  }

  console.log(`\n${apply ? 'Converted' : 'Would convert'}: ${converted} rake rows worth $${total.toFixed(2)}, plus ${emptied} empty row(s) deleted.`);
  if (!apply) console.log('Dry run. Re-run with --apply (after scripts/backup-db.sh) to write.');
  db.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
