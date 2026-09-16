const { test, after } = require('node:test');
const assert = require('node:assert/strict');

// Schema-only DB: database.js reads POKER_DB when it's required.
process.env.POKER_DB = ':memory:';
const db = require('./database');

after(() => db.close());

function plan(sql) {
  return new Promise((resolve, reject) => {
    // serialize() queues this behind database.js's schema statements.
    db.serialize(() => {
      db.all(`EXPLAIN QUERY PLAN ${sql}`, ['x'], (err, rows) =>
        err ? reject(err) : resolve(rows.map((r) => r.detail).join(' | '))
      );
    });
  });
}

// The session endpoints run these once per session and once per player (225
// sessions and ~2.5k players in group A). As full-table scans they cost most of
// a second per GET /api/sessions; each must be an index lookup.

test('players-by-session lookup uses an index, not a table scan', async () => {
  const detail = await plan('SELECT * FROM players WHERE sessionId = ?');
  assert.match(detail, /SEARCH players USING INDEX/);
});

test('buy-ins-by-player lookup uses an index and needs no extra sort', async () => {
  const detail = await plan('SELECT * FROM buyIns WHERE playerId = ? ORDER BY timestamp');
  assert.match(detail, /SEARCH buyIns USING INDEX/);
  assert.doesNotMatch(detail, /TEMP B-TREE/);
});
