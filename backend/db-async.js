// Promise wrappers for the sqlite3 callback API.
//
// server.js is callback-style throughout, which is fine for a single query. A
// multi-step write that has to roll back cleanly is a different matter: in
// callbacks every error path needs its own ROLLBACK, and one missed path
// leaves a half-finished change behind.

function runAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

function getAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function allAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

/**
 * Runs `fn` between BEGIN IMMEDIATE and COMMIT, rolling back on any throw.
 *
 * One connection is shared by the whole process, so a write from another
 * request that lands mid-transaction joins this one and would be rolled back
 * with it. Keep the body short — this app's writes are a handful of rows from
 * a dozen people, and a half-merged session is the worse outcome.
 */
async function withTransaction(db, fn) {
  await runAsync(db, 'BEGIN IMMEDIATE');
  try {
    const result = await fn();
    await runAsync(db, 'COMMIT');
    return result;
  } catch (err) {
    await runAsync(db, 'ROLLBACK').catch(() => {});
    throw err;
  }
}

module.exports = { runAsync, getAsync, allAsync, withTransaction };
