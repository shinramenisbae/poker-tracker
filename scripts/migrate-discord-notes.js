// One-shot: clean up existing sessions whose Discord linkage was stored in
// the notes field. Move the threadId into the new discordThreadId column and
// rewrite notes to "Online session (date)" (for online imports) or strip the
// "Announced on Discord..." suffix (for in-person announces).
//
// Run from the tracker repo root: node scripts/migrate-discord-notes.js
const path = require('path');
const sqlite3 = require(path.join(__dirname, '..', 'backend', 'node_modules', 'sqlite3'));

const dbPath = path.join(__dirname, '..', 'backend', 'poker.db');
const db = new sqlite3.Database(dbPath);

const IMPORT_RE = /^Imported from Discord \(threadId=(\d+)\)$/;
const ANNOUNCE_RE = /\s*Announced on Discord \(threadId=(\d+)\)\s*/;

db.all('SELECT id, date, notes, gameType, discordThreadId FROM sessions', [], (err, rows) => {
  if (err) { console.error(err); process.exit(1); }
  const updates = [];
  for (const r of rows) {
    if (r.discordThreadId) continue; // already migrated
    const notes = r.notes || '';

    const importMatch = notes.match(IMPORT_RE);
    if (importMatch) {
      updates.push({ id: r.id, newNotes: `Online session (${r.date})`, threadId: importMatch[1] });
      continue;
    }

    const announceMatch = notes.match(ANNOUNCE_RE);
    if (announceMatch) {
      const cleaned = notes.replace(ANNOUNCE_RE, '').trim();
      updates.push({ id: r.id, newNotes: cleaned, threadId: announceMatch[1] });
    }
  }

  console.log(`Migrating ${updates.length} sessions of ${rows.length} total.`);
  if (updates.length === 0) { db.close(); return; }

  const stmt = db.prepare('UPDATE sessions SET notes = ?, discordThreadId = ? WHERE id = ?');
  let done = 0;
  for (const u of updates) {
    stmt.run(u.newNotes, u.threadId, u.id, (err) => {
      if (err) console.error('Update failed for', u.id, err);
      done++;
      if (done === updates.length) {
        stmt.finalize();
        console.log(`Done. ${done} sessions migrated.`);
        db.close();
      }
    });
  }
});
