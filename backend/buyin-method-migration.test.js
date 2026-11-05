const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

// Opening the database runs the rename, so each open is its own process: that
// is what a restart is, and the rename has to survive being run again by one.
function run(dbPath, script) {
  const result = spawnSync(process.execPath, ['-e', `
    const db = require('./database');
    const { allAsync, runAsync } = require('./db-async');
    (async () => { ${script} db.close(); })().catch((e) => { console.error(e); process.exit(1); });
  `], { cwd: __dirname, env: { ...process.env, POKER_DB: dbPath, SEED_ALIASES: '0' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('old buy-ins are renamed once, and a restart leaves new ones alone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-migration-'));
  const dbPath = path.join(dir, 'poker.db');
  try {
    // A database from before the rename: the marker has not been written.
    run(dbPath, `
      await runAsync(db, "DELETE FROM schema_migrations");
      await runAsync(db, "INSERT INTO sessions (id, date, createdAt, updatedAt) VALUES ('s', 'd', 'x', 'x')");
      await runAsync(db, "INSERT INTO players (id, sessionId, name) VALUES ('p', 's', 'Daniel Y')");
      for (const [id, method] of [['owed', 'bank'], ['upfront', 'prepaid'], ['table', 'cash']]) {
        await runAsync(db, "INSERT INTO buyIns (id, playerId, amount, timestamp, method) VALUES (?, 'p', 500, 'x', ?)", [id, method]);
      }
    `);

    const read = `console.log(JSON.stringify(await allAsync(db, 'SELECT id, method FROM buyIns ORDER BY id')));`;
    assert.deepEqual(JSON.parse(run(dbPath, read)), [
      { id: 'owed', method: 'credit' },
      { id: 'table', method: 'cash' },
      { id: 'upfront', method: 'bank' },
    ]);

    // A real bank buy-in made after the rename must not become a debt.
    run(dbPath, `await runAsync(db, "INSERT INTO buyIns (id, playerId, amount, timestamp, method) VALUES ('later', 'p', 100, 'x', 'bank')");`);
    const rows = JSON.parse(run(dbPath, read));
    assert.equal(rows.find((r) => r.id === 'later').method, 'bank');
    assert.equal(rows.find((r) => r.id === 'upfront').method, 'bank');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
