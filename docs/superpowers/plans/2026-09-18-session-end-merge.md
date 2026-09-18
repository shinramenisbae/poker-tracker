# Ending a session on the server, merging a player who comes back — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ending a session happens in one server call that merges duplicate entries of the same player and then picks the banker from the merged results.

**Architecture:** Pure modules decide *what* to merge and *who* banks; a DB-level module applies both inside one transaction; the HTTP route is a thin wrapper. The browser stops computing the banker and just calls the new endpoint. The same pure planner drives the one-off cleanup script for past sessions.

**Tech Stack:** Node 22, Express 4, `sqlite3` (callback API), CommonJS backend, `node --test`; React 19 + TypeScript frontend, Vite, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-18-rake-banker-merge-design.md` (Part A)

## Global Constraints

- **No new npm dependencies.** `deploy.sh` does not run `npm install`, so a new production dependency breaks the box.
- **Backend is CommonJS** (`require`), **bot is ESM** (`import`), **frontend is TS + ESM**. Never mix.
- **Nothing dev-only in `app/tsconfig.app.json` `types`** — `tsc -b` fails on the VPS, where dev deps are absent.
- **Backend tests are `node --test`** with `node:assert/strict`, in `backend/*.test.js`. Frontend tests are Vitest in `app/src/**/*.test.ts(x)`.
- **Rake is out of scope here.** `POST /api/sessions/:id/end` takes no rake fields in this PR; Part C adds them.
- **Every commit message ends with:**
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **Money is REAL in SQLite.** Compare with a tolerance (`Math.abs(a - b) < 0.005`), never `===`.

## File Structure

| File | Responsibility |
|---|---|
| `backend/merge-players.js` (new) | Pure: which entries are the same player, which one is kept, what the merged cash-out is |
| `backend/bank-player.js` (new) | Pure: biggest winner by profit |
| `backend/db-async.js` (new) | Promise wrappers for `sqlite3` + `withTransaction` |
| `backend/end-session.js` (new) | Applies the merge plan and the banker in one transaction |
| `backend/server.js` (modify) | `POST /api/sessions/:id/end` route, thin |
| `scripts/merge-duplicate-players.js` (new) | One-off cleanup of past sessions, dry-run by default |
| `app/src/api/index.ts` (modify) | `endSession(id)` |
| `app/src/hooks/useStorage.ts` (modify) | `endSession` mutation |
| `app/src/pages/SessionDetail.tsx` (modify) | End Session calls it, navigates with the merge summary |
| `app/src/pages/Results.tsx` (modify) | Shows the merge note |

---

### Task 1: Deciding what merges

**Files:**
- Create: `backend/merge-players.js`
- Test: `backend/merge-players.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `normalizePlayerName(name: string): string`
  - `planMerges(players: MergeInput[]): MergePlan[]` where
    `MergeInput = {id: string, name: string, firstBuyInAt: string|null, cashOutAmount: number|null, cashOutDate: string|null}`
    and `MergePlan = {name: string, keepId: string, mergeIds: string[], cashOutAmount: number|null, cashOutDate: string|null}`

- [ ] **Step 1: Write the failing test**

Create `backend/merge-players.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizePlayerName, planMerges } = require('./merge-players');

// Group A, 16 Sep: Leo cashed out for $79, rejoined, cashed out again for $504.
const leoTwice = [
  { id: 'leo1', name: 'Leo', firstBuyInAt: '2026-09-16T04:58:25.980Z', cashOutAmount: 79, cashOutDate: '2026-09-16T06:01:37.356Z' },
  { id: 'simon', name: 'Simon', firstBuyInAt: '2026-09-16T04:58:20.380Z', cashOutAmount: 1180, cashOutDate: '2026-09-16T11:26:59.799Z' },
  { id: 'leo2', name: 'leo ', firstBuyInAt: '2026-09-16T09:14:16.438Z', cashOutAmount: 504, cashOutDate: '2026-09-16T11:30:52.513Z' },
];

test('planMerges: the two Leos become one, keeping the earlier entry', () => {
  const plans = planMerges(leoTwice);
  assert.equal(plans.length, 1);
  assert.deepEqual(plans[0], {
    name: 'Leo',
    keepId: 'leo1',
    mergeIds: ['leo2'],
    cashOutAmount: 583,
    cashOutDate: '2026-09-16T11:30:52.513Z',
  });
});

test('planMerges: players who appear once are left alone', () => {
  assert.deepEqual(planMerges([leoTwice[1]]), []);
});

test('planMerges: names that only differ by case and spacing are one player', () => {
  const plans = planMerges([
    { id: 'a', name: 'Daniel H', firstBuyInAt: '2026-01-01T00:00:00.000Z', cashOutAmount: 10, cashOutDate: '2026-01-01T05:00:00.000Z' },
    { id: 'b', name: '  daniel   h ', firstBuyInAt: '2026-01-01T02:00:00.000Z', cashOutAmount: 5, cashOutDate: '2026-01-01T06:00:00.000Z' },
  ]);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].keepId, 'a');
  assert.equal(plans[0].name, 'Daniel H');
});

test('planMerges: different people with similar names stay separate', () => {
  const plans = planMerges([
    { id: 'a', name: 'Daniel', firstBuyInAt: '2026-01-01T00:00:00.000Z', cashOutAmount: 10, cashOutDate: '2026-01-01T05:00:00.000Z' },
    { id: 'b', name: 'Daniel H', firstBuyInAt: '2026-01-01T01:00:00.000Z', cashOutAmount: 20, cashOutDate: '2026-01-01T05:00:00.000Z' },
    { id: 'c', name: 'Daniel Y', firstBuyInAt: '2026-01-01T02:00:00.000Z', cashOutAmount: 30, cashOutDate: '2026-01-01T05:00:00.000Z' },
  ]);
  assert.deepEqual(plans, []);
});

test('planMerges: an entry with no buy-ins sorts after ones that have them', () => {
  const plans = planMerges([
    { id: 'late', name: 'Min', firstBuyInAt: null, cashOutAmount: 0, cashOutDate: '2026-01-01T06:00:00.000Z' },
    { id: 'first', name: 'Min', firstBuyInAt: '2026-01-01T01:00:00.000Z', cashOutAmount: 40, cashOutDate: '2026-01-01T05:00:00.000Z' },
  ]);
  assert.equal(plans[0].keepId, 'first');
  assert.deepEqual(plans[0].mergeIds, ['late']);
});

test('planMerges: a group where nobody cashed out keeps no cash-out', () => {
  const plans = planMerges([
    { id: 'a', name: 'Adam', firstBuyInAt: '2026-01-01T00:00:00.000Z', cashOutAmount: null, cashOutDate: null },
    { id: 'b', name: 'Adam', firstBuyInAt: '2026-01-01T01:00:00.000Z', cashOutAmount: null, cashOutDate: null },
  ]);
  assert.equal(plans[0].cashOutAmount, null);
  assert.equal(plans[0].cashOutDate, null);
});

test('planMerges: one entry still owing a cash-out contributes only what exists', () => {
  const plans = planMerges([
    { id: 'a', name: 'Adam', firstBuyInAt: '2026-01-01T00:00:00.000Z', cashOutAmount: 60, cashOutDate: '2026-01-01T05:00:00.000Z' },
    { id: 'b', name: 'Adam', firstBuyInAt: '2026-01-01T01:00:00.000Z', cashOutAmount: null, cashOutDate: null },
  ]);
  assert.equal(plans[0].cashOutAmount, 60);
  assert.equal(plans[0].cashOutDate, '2026-01-01T05:00:00.000Z');
});

test('planMerges: three entries of one player collapse into one', () => {
  const plans = planMerges([
    { id: 'a', name: 'Nick', firstBuyInAt: '2026-01-01T00:00:00.000Z', cashOutAmount: 10, cashOutDate: '2026-01-01T03:00:00.000Z' },
    { id: 'b', name: 'Nick', firstBuyInAt: '2026-01-01T01:00:00.000Z', cashOutAmount: 20, cashOutDate: '2026-01-01T04:00:00.000Z' },
    { id: 'c', name: 'Nick', firstBuyInAt: '2026-01-01T02:00:00.000Z', cashOutAmount: 30, cashOutDate: '2026-01-01T05:00:00.000Z' },
  ]);
  assert.deepEqual(plans[0].mergeIds, ['b', 'c']);
  assert.equal(plans[0].cashOutAmount, 60);
});

test('normalizePlayerName: trims, collapses spacing, ignores case', () => {
  assert.equal(normalizePlayerName('  Daniel   H '), 'daniel h');
  assert.equal(normalizePlayerName('Leo'), normalizePlayerName('leo '));
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd backend && node --test merge-players.test.js`
Expected: FAIL — `Cannot find module './merge-players'`.

- [ ] **Step 3: Write the module**

Create `backend/merge-players.js`:

```js
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

    const [keep, ...rest] = ordered;
    const cashOuts = ordered.filter((p) => p.cashOutAmount != null);

    plans.push({
      name: keep.name,
      keepId: keep.id,
      // Database order, not sorted order: the UPDATE/DELETE below don't care,
      // and a stable list reads better in the dry-run output.
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
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd backend && node --test merge-players.test.js`
Expected: PASS, 9/9.

- [ ] **Step 5: Commit**

```bash
git add backend/merge-players.js backend/merge-players.test.js
git commit -m "$(printf 'Merge planning: two entries of one player are one player\n\nA player who cashes out early and rejoins is added again by hand, so\nthe session carries two rows for one person — Leo was both -$21 and\n+$4 on 16 Sep instead of -$17. This decides which rows are the same\nperson, which one survives, and what the combined cash-out is.\n\nPure and separate from the database, because the same planning has to\nrun over past sessions in the cleanup script.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 2: Picking the banker

**Files:**
- Create: `backend/bank-player.js`
- Test: `backend/bank-player.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `pickBankPlayer(players: {id: string, totalBuyIn: number, cashOutAmount: number|null}[]): string|null`

- [ ] **Step 1: Write the failing test**

Create `backend/bank-player.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pickBankPlayer } = require('./bank-player');

test('pickBankPlayer: the biggest winner banks', () => {
  assert.equal(pickBankPlayer([
    { id: 'simon', totalBuyIn: 2000, cashOutAmount: 1180 },
    { id: 'danielh', totalBuyIn: 200, cashOutAmount: 1415 },
    { id: 'jordan', totalBuyIn: 300, cashOutAmount: 1329 },
  ]), 'danielh');
});

test('pickBankPlayer: nobody up means nobody banks', () => {
  assert.equal(pickBankPlayer([
    { id: 'a', totalBuyIn: 100, cashOutAmount: 50 },
    { id: 'b', totalBuyIn: 100, cashOutAmount: 100 },
  ]), null);
});

test('pickBankPlayer: a player still owing a cash-out cannot bank', () => {
  assert.equal(pickBankPlayer([
    { id: 'a', totalBuyIn: 100, cashOutAmount: null },
    { id: 'b', totalBuyIn: 100, cashOutAmount: 150 },
  ]), 'b');
});

test('pickBankPlayer: equal winners — the first listed banks', () => {
  assert.equal(pickBankPlayer([
    { id: 'a', totalBuyIn: 100, cashOutAmount: 200 },
    { id: 'b', totalBuyIn: 100, cashOutAmount: 200 },
  ]), 'a');
});

test('pickBankPlayer: cents of profit are not a win', () => {
  // REAL arithmetic leaves dust on a balanced session; a $0.002 "winner"
  // should not be handed everyone's money.
  assert.equal(pickBankPlayer([
    { id: 'a', totalBuyIn: 100, cashOutAmount: 100.002 },
    { id: 'b', totalBuyIn: 100, cashOutAmount: 99.998 },
  ]), null);
});

test('pickBankPlayer: no players at all', () => {
  assert.equal(pickBankPlayer([]), null);
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd backend && node --test bank-player.test.js`
Expected: FAIL — `Cannot find module './bank-player'`.

- [ ] **Step 3: Write the module**

Create `backend/bank-player.js`:

```js
// Who holds the money after a session: the biggest winner.
//
// Mirrors identifyBankPlayer() in app/src/utils/calculations.ts and
// bot/settlement.js. It lives on the server too because ending a session
// picks the banker AFTER merging duplicate entries, and only the server
// knows the merged result.
//
// A session can be re-pointed at someone else by hand afterwards; that is
// a separate feature (Part B of the spec), and it overrides this.

// SQLite stores money as REAL, so a balanced session can leave fractions of
// a cent behind. Anything under half a cent is not a win.
const CENT = 0.005;

/**
 * @param {{id: string, totalBuyIn: number, cashOutAmount: number|null}[]} players
 * @returns {string|null} id of the biggest winner, or null when nobody is up
 */
function pickBankPlayer(players) {
  let bestId = null;
  let bestProfit = 0;
  for (const player of players || []) {
    if (player.cashOutAmount == null) continue; // still owes a cash-out
    const profit = player.cashOutAmount - player.totalBuyIn;
    if (profit > CENT && profit > bestProfit) {
      bestProfit = profit;
      bestId = player.id;
    }
  }
  return bestId;
}

module.exports = { pickBankPlayer };
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd backend && node --test bank-player.test.js`
Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add backend/bank-player.js backend/bank-player.test.js
git commit -m "$(printf 'Bank player: the biggest winner, decided on the server\n\nThe browser has always picked the banker. Ending a session now merges\nduplicate entries first, and only the server knows the merged result,\nso the choice moves here — mirroring identifyBankPlayer() on the\nfrontend and in the bot.\n\nFractions of a cent are not a win: REAL arithmetic leaves dust on a\nbalanced session, and dust should not be handed everyone else s money.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 3: Applying it to the database

**Files:**
- Create: `backend/db-async.js`
- Create: `backend/end-session.js`
- Test: `backend/end-session.test.js`

**Interfaces:**
- Consumes: `planMerges` (Task 1), `pickBankPlayer` (Task 2)
- Produces:
  - `backend/db-async.js`: `runAsync(db, sql, params)`, `getAsync(db, sql, params)`, `allAsync(db, sql, params)`, `withTransaction(db, fn)`
  - `backend/end-session.js`: `endSession(db, sessionId): Promise<{bankPlayerId: string|null, merges: {name, keepId, entries, totalBuyIn, totalCashOut}[]}>`, throwing `Error` with `.code` of `'NOT_FOUND'` or `'ALREADY_COMPLETED'`

- [ ] **Step 1: Write the failing test**

Create `backend/end-session.test.js`:

```js
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.POKER_DB = ':memory:';
process.env.SEED_ALIASES = '0';
const db = require('./database');
const { allAsync, getAsync, runAsync } = require('./db-async');
const { endSession } = require('./end-session');

after(() => db.close());

let seq = 0;
const uid = (prefix) => `${prefix}${seq++}`;

/**
 * @param {{name: string, buyIns: number[], cashOut: number|null, cashOutAt?: string}[]} players
 * @returns {Promise<string>} the new session's id
 */
async function seedSession(players, { status = 'active' } = {}) {
  const sessionId = uid('s');
  const now = '2026-09-16T04:00:00.000Z';
  await runAsync(db, `INSERT INTO sessions (id, date, status, notes, gameType, createdAt, updatedAt)
                      VALUES (?, '2026-09-16', ?, 'test', 'in-person', ?, ?)`, [sessionId, status, now, now]);
  for (const player of players) {
    const playerId = uid('p');
    await runAsync(db, `INSERT INTO players (id, sessionId, name, paymentMethod, cashOutAmount, cashOutDate)
                        VALUES (?, ?, ?, 'cash', ?, ?)`,
      [playerId, sessionId, player.name, player.cashOut, player.cashOut == null ? null : (player.cashOutAt || now)]);
    for (const [index, amount] of player.buyIns.entries()) {
      await runAsync(db, `INSERT INTO buyIns (id, playerId, amount, timestamp, isRebuy, method)
                          VALUES (?, ?, ?, ?, ?, 'cash')`,
        [uid('b'), playerId, amount, `2026-09-16T0${index + 1}:00:00.000Z`, index > 0 ? 1 : 0]);
    }
  }
  return sessionId;
}

const playersOf = (sessionId) =>
  allAsync(db, `SELECT p.id, p.name, p.cashOutAmount, p.cashOutDate,
                       COALESCE((SELECT SUM(amount) FROM buyIns WHERE playerId = p.id), 0) AS totalBuyIn
                FROM players p WHERE p.sessionId = ? ORDER BY p.rowid`, [sessionId]);

test('endSession: the two Leos become one player with both stints of buy-ins', async () => {
  const sessionId = await seedSession([
    { name: 'Leo', buyIns: [100], cashOut: 79, cashOutAt: '2026-09-16T06:01:00.000Z' },
    { name: 'Jordan', buyIns: [100, 200], cashOut: 1329 },
    { name: 'leo', buyIns: [200, 300], cashOut: 504, cashOutAt: '2026-09-16T11:30:00.000Z' },
  ]);

  const result = await endSession(db, sessionId);

  const players = await playersOf(sessionId);
  assert.equal(players.length, 2);
  const leo = players.find((p) => p.name === 'Leo');
  assert.equal(leo.totalBuyIn, 600);
  assert.equal(leo.cashOutAmount, 583);
  assert.equal(leo.cashOutDate, '2026-09-16T11:30:00.000Z');
  assert.deepEqual(result.merges, [
    { name: 'Leo', keepId: leo.id, entries: 2, totalBuyIn: 600, totalCashOut: 583 },
  ]);
});

test('endSession: the banker is the biggest winner after merging, not before', async () => {
  // Split across two entries Leo tops nobody; merged he is up $700, more than
  // Jordan's $600, so merging first changes who banks.
  const sessionId = await seedSession([
    { name: 'Leo', buyIns: [100], cashOut: 500 },
    { name: 'Jordan', buyIns: [100], cashOut: 700 },
    { name: 'Leo', buyIns: [100], cashOut: 400 },
  ]);

  const result = await endSession(db, sessionId);

  const players = await playersOf(sessionId);
  const leo = players.find((p) => p.name === 'Leo');
  assert.equal(result.bankPlayerId, leo.id);
  const session = await getAsync(db, 'SELECT status, bankPlayerId FROM sessions WHERE id = ?', [sessionId]);
  assert.equal(session.bankPlayerId, leo.id);
  assert.equal(session.status, 'completed');
});

test('endSession: a session with no duplicates is completed and reports no merges', async () => {
  const sessionId = await seedSession([
    { name: 'Simon', buyIns: [100], cashOut: 50 },
    { name: 'Min', buyIns: [100], cashOut: 150 },
  ]);

  const result = await endSession(db, sessionId);

  assert.deepEqual(result.merges, []);
  const session = await getAsync(db, 'SELECT status FROM sessions WHERE id = ?', [sessionId]);
  assert.equal(session.status, 'completed');
});

test('endSession: ending a completed session is refused, leaving it untouched', async () => {
  const sessionId = await seedSession([
    { name: 'Leo', buyIns: [100], cashOut: 79 },
    { name: 'Leo', buyIns: [500], cashOut: 504 },
  ], { status: 'completed' });

  await assert.rejects(() => endSession(db, sessionId), (err) => err.code === 'ALREADY_COMPLETED');

  assert.equal((await playersOf(sessionId)).length, 2);
});

test('endSession: an unknown session is refused', async () => {
  await assert.rejects(() => endSession(db, 'nope'), (err) => err.code === 'NOT_FOUND');
});

test('endSession: buy-ins keep their own timestamps after moving', async () => {
  const sessionId = await seedSession([
    { name: 'Min', buyIns: [100], cashOut: 0 },
    { name: 'Min', buyIns: [200], cashOut: 300 },
  ]);

  await endSession(db, sessionId);

  const [min] = await playersOf(sessionId);
  const buyIns = await allAsync(db, 'SELECT amount, timestamp FROM buyIns WHERE playerId = ? ORDER BY timestamp', [min.id]);
  assert.deepEqual(buyIns.map((b) => b.amount), [100, 200]);
  assert.equal(buyIns[0].timestamp, '2026-09-16T01:00:00.000Z');
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd backend && node --test end-session.test.js`
Expected: FAIL — `Cannot find module './db-async'`.

- [ ] **Step 3: Write the promise wrappers**

Create `backend/db-async.js`:

```js
// Promise wrappers for the sqlite3 callback API.
//
// server.js is callback-style throughout, which is fine for a single query.
// A multi-step write that has to roll back cleanly is a different matter: in
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
```

- [ ] **Step 4: Write the end-session module**

Create `backend/end-session.js`:

```js
// Ending a session: everything that has to be true the moment a game is over.
//
// The browser used to mark the session completed and name the banker itself.
// Both now happen here, in one transaction and in a fixed order, because the
// second depends on the first: Leo's two rows have to become one player
// before anyone asks who won the most.
//
// Part C of the spec adds rake to this same call.

const { planMerges } = require('./merge-players');
const { pickBankPlayer } = require('./bank-player');
const { runAsync, getAsync, allAsync, withTransaction } = require('./db-async');

function failure(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * @param {import('sqlite3').Database} db
 * @param {string} sessionId
 * @returns {Promise<{bankPlayerId: string|null,
 *   merges: {name: string, keepId: string, entries: number,
 *            totalBuyIn: number, totalCashOut: number}[]}>}
 */
async function endSession(db, sessionId) {
  const session = await getAsync(db, 'SELECT id, status FROM sessions WHERE id = ?', [sessionId]);
  if (!session) throw failure('NOT_FOUND', 'Session not found');
  if (session.status === 'completed') {
    throw failure('ALREADY_COMPLETED', 'This session has already been ended');
  }

  return withTransaction(db, async () => {
    const players = await allAsync(db, `
      SELECT p.id, p.name, p.cashOutAmount, p.cashOutDate,
             (SELECT MIN(timestamp) FROM buyIns WHERE playerId = p.id) AS firstBuyInAt
      FROM players p WHERE p.sessionId = ? ORDER BY p.rowid`, [sessionId]);

    const plans = planMerges(players);
    for (const plan of plans) {
      const holes = plan.mergeIds.map(() => '?').join(', ');
      await runAsync(db, `UPDATE buyIns SET playerId = ? WHERE playerId IN (${holes})`,
        [plan.keepId, ...plan.mergeIds]);
      await runAsync(db, 'UPDATE players SET cashOutAmount = ?, cashOutDate = ? WHERE id = ?',
        [plan.cashOutAmount, plan.cashOutDate, plan.keepId]);
      await runAsync(db, `DELETE FROM players WHERE id IN (${holes})`, plan.mergeIds);
    }

    // Re-read: totals per player only mean anything once the merges are in.
    const merged = await allAsync(db, `
      SELECT p.id, p.cashOutAmount,
             COALESCE((SELECT SUM(amount) FROM buyIns WHERE playerId = p.id), 0) AS totalBuyIn
      FROM players p WHERE p.sessionId = ? ORDER BY p.rowid`, [sessionId]);

    const bankPlayerId = pickBankPlayer(merged);
    const now = new Date().toISOString();
    await runAsync(db, `UPDATE sessions SET status = 'completed', bankPlayerId = ?, updatedAt = ?
                        WHERE id = ?`, [bankPlayerId, now, sessionId]);

    const byId = new Map(merged.map((p) => [p.id, p]));
    return {
      bankPlayerId,
      merges: plans.map((plan) => ({
        name: plan.name,
        keepId: plan.keepId,
        entries: plan.mergeIds.length + 1,
        totalBuyIn: byId.get(plan.keepId)?.totalBuyIn ?? 0,
        totalCashOut: plan.cashOutAmount ?? 0,
      })),
    };
  });
}

module.exports = { endSession };
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd backend && node --test end-session.test.js`
Expected: PASS, 6/6.

- [ ] **Step 6: Run the whole backend suite**

Run: `cd backend && npm test`
Expected: every test passes, including the 23 that existed before.

- [ ] **Step 7: Commit**

```bash
git add backend/db-async.js backend/end-session.js backend/end-session.test.js
git commit -m "$(printf 'Ending a session: merge, then pick the banker, in one transaction\n\nMerging Leo s two rows and choosing the banker cannot be two separate\nsteps: the banker is the biggest winner, and until the rows are one\nplayer the biggest winner can be the wrong person. Both now happen in\none transaction, in that order.\n\nThe promise wrappers exist for the rollback. In callback style every\nerror path needs its own ROLLBACK, and the one path that misses it\nleaves a half-merged session behind.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 4: The route

**Files:**
- Modify: `backend/server.js` (after the `PUT /api/sessions/:id` handler, which ends at line 394)

**Interfaces:**
- Consumes: `endSession` (Task 3)
- Produces: `POST /api/sessions/:id/end` → `200 {…session, merges}` / `404` / `409`

- [ ] **Step 1: Extract the session reader both routes need**

`GET /api/sessions/:id` (line 192) already assembles a session with players and
buy-ins, and the new route needs the same thing. Lift that body into a helper
above the routes rather than writing a third copy of the nesting — and give it
the early-return guard the original lacks, where one failed query could send a
response per player row:

```js
// Assembles one session with its players and their buy-ins.
// Shared by GET /api/sessions/:id and POST /api/sessions/:id/end.
function readSession(sessionId, callback) {
  db.get('SELECT * FROM sessions WHERE id = ?', [sessionId], (err, session) => {
    if (err) return callback(err);
    if (!session) return callback(null, null);

    db.all('SELECT * FROM players WHERE sessionId = ?', [sessionId], (err, players) => {
      if (err) return callback(err);
      if (!players || players.length === 0) return callback(null, { ...session, players: [] });

      let completed = 0;
      const playersWithBuyIns = new Array(players.length);
      players.forEach((player, index) => {
        db.all('SELECT * FROM buyIns WHERE playerId = ? ORDER BY timestamp', [player.id], (err, buyIns) => {
          if (err) return callback(err);
          playersWithBuyIns[index] = {
            ...player,
            buyIns: buyIns || [],
            cashOut: player.cashOutAmount != null
              ? { amount: player.cashOutAmount, timestamp: new Date(player.cashOutDate).getTime() }
              : null,
          };
          if (++completed === players.length) callback(null, { ...session, players: playersWithBuyIns });
        });
      });
    });
  });
}
```

Then make `GET /api/sessions/:id` use it:

```js
app.get('/api/sessions/:id', (req, res) => {
  readSession(req.params.id, (err, session) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  });
});
```

- [ ] **Step 2: Add the route**

In `backend/server.js`, add near the top with the other requires:

```js
const { endSession } = require('./end-session');
```

and add this route immediately after the `PUT /api/sessions/:id` handler:

```js
// POST /api/sessions/:id/end — finish a session.
//
// Replaces the browser PUTting {status, bankPlayerId}: merging duplicate
// entries and naming the banker have to happen together, in that order, and
// atomically. Returns the finished session plus what was merged, so the
// results page can say what happened to Leo's two rows.
app.post('/api/sessions/:id/end', async (req, res) => {
  const sessionId = req.params.id;
  try {
    const { merges } = await endSession(db, sessionId);
    readSession(sessionId, (err, session) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!session) return res.status(404).json({ error: 'Session not found' });
      res.json({ ...session, merges });
    });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    if (err.code === 'ALREADY_COMPLETED') return res.status(409).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 3: Verify by hand against synthetic data**

```bash
node -e "process.env.PORT='5055';process.env.SEED_ALIASES='0';process.env.POKER_DB='<scratch>/end-test.db';require('./backend/server.js')" &
curl -s -X POST localhost:5055/api/sessions -H 'Content-Type: application/json' \
  -d '{"date":"2026-09-18","notes":"merge test","players":[{"id":"l1","name":"Leo","buyIns":[],"cashOut":null,"paymentMethod":"cash"},{"id":"l2","name":"leo ","buyIns":[],"cashOut":null,"paymentMethod":"cash"},{"id":"j1","name":"Jordan","buyIns":[],"cashOut":null,"paymentMethod":"cash"}]}'
```

Add buy-ins and cash-outs through the existing endpoints, then:

```bash
curl -s -X POST localhost:5055/api/sessions/<id>/end | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.status, j.bankPlayerId, JSON.stringify(j.merges), j.players.map(p=>p.name+':'+p.buyIns.length))})"
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:5055/api/sessions/<id>/end   # expect 409
```

Expected: `completed`, one merge entry for Leo, two players left, and 409 on the second call.

- [ ] **Step 4: Run the backend suite**

Run: `cd backend && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/server.js
git commit -m "$(printf 'POST /api/sessions/:id/end, and one session reader\n\nThe route is thin: end-session.js does the work, and the response\ncarries the finished session plus what merged, so the results page can\nsay what happened to Leo s two rows. A second call gets 409 rather\nthan re-running the merge.\n\nGET /api/sessions/:id and the new route need the same session-with-\nplayers-and-buy-ins assembly, so it becomes one helper instead of a\nthird copy of the nesting — with the early-return guard the original\nlacked, where one failed query could send a response per player row.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 5: The frontend calls it

**Files:**
- Modify: `app/src/api/index.ts` (after `fetchSession`, line ~20)
- Modify: `app/src/hooks/useStorage.ts` (add to the mutation list and the return object)
- Test: `app/src/hooks/useStorage.test.ts` (extend)

**Interfaces:**
- Consumes: `POST /api/sessions/:id/end` (Task 4)
- Produces:
  - `api.endSession(id: string): Promise<EndSessionResult>` where
    `EndSessionResult = Session & {merges: SessionMerge[]}` and
    `SessionMerge = {name: string, keepId: string, entries: number, totalBuyIn: number, totalCashOut: number}`
  - `useSessions().endSession(id: string): Promise<EndSessionResult>`

- [ ] **Step 1: Write the failing test**

Append to `app/src/hooks/useStorage.test.ts` (inside the existing `describe('useSessions')`):

```ts
  it('endSession posts to the end endpoint and stores the finished session', async () => {
    const finished = {
      ...apiSession('s1', { status: 'completed', bankPlayerId: 's1-p1' }),
      merges: [{ name: 'Leo', keepId: 's1-p1', entries: 2, totalBuyIn: 600, totalCashOut: 583 }],
    };
    const fetchMock = stubApi({
      '/api/sessions/s1': [apiSession('s1')],
      '/api/sessions/s1/end': [finished],
    });

    const { result } = renderHook(() => useSessions('s1'));
    await waitFor(() => expect(result.current.getSession('s1')).toBeDefined());

    let returned: Awaited<ReturnType<typeof result.current.endSession>> | undefined;
    await act(async () => { returned = await result.current.endSession('s1'); });

    expect(returned?.merges).toEqual([
      { name: 'Leo', keepId: 's1-p1', entries: 2, totalBuyIn: 600, totalCashOut: 583 },
    ]);
    expect(result.current.getSession('s1')?.status).toBe('completed');
    expect(requestedUrls(fetchMock)).toEqual(['/api/sessions/s1', '/api/sessions/s1/end']);
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/hooks/useStorage.test.ts`
Expected: FAIL — `result.current.endSession is not a function`.

- [ ] **Step 3: Add the API call**

In `app/src/api/index.ts`, after `fetchSession`:

```ts
export interface SessionMerge {
  name: string;
  keepId: string;
  entries: number;
  totalBuyIn: number;
  totalCashOut: number;
}
export type EndSessionResult = Session & { merges: SessionMerge[] };

// Ends a session: the server merges duplicate entries of one player and picks
// the banker from the merged results, which is why this isn't a plain update.
export async function endSession(id: string): Promise<EndSessionResult> {
  const response = await fetch(`${API_BASE_URL}/sessions/${id}/end`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return handleResponse<EndSessionResult>(response);
}
```

- [ ] **Step 4: Add the hook mutation**

In `app/src/hooks/useStorage.ts`, import it with the others:

```ts
  endSession as apiEndSession,
```

then add alongside the other mutations, and include `endSession` in the returned object:

```ts
  const endSession = useCallback(async (id: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const finished = await apiEndSession(id);
      setSessions((prev) => prev.map((session) => (session.id === id ? finished : session)));
      return finished;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to end session';
      setError(message);
      console.error('Error ending session:', err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd app && npx vitest run src/hooks/useStorage.test.ts`
Expected: PASS, 5/5.

- [ ] **Step 6: Commit**

```bash
git add app/src/api/index.ts app/src/hooks/useStorage.ts app/src/hooks/useStorage.test.ts
git commit -m "$(printf 'Frontend: end a session through the new endpoint\n\nOne POST replaces the PUT that carried a browser-computed banker. The\nresponse is the finished session plus what merged, and the hook stores\nthe session so the page updates without another fetch.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 6: End Session and the results note

**Files:**
- Modify: `app/src/pages/SessionDetail.tsx` (`handleEndSession`, lines 215-235; the `identifyBankPlayer` import on line 11)
- Modify: `app/src/pages/Results.tsx` (imports, and the top of `<main>` at line 115)
- Test: `app/src/pages/Results.test.tsx` (new)

**Interfaces:**
- Consumes: `useSessions().endSession` (Task 5), `SessionMerge` (Task 5)
- Produces: navigation to `/session/:id/results` with `state: {merges: SessionMerge[]}`

- [ ] **Step 1: Write the failing test**

Create `app/src/pages/Results.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Results } from './Results';

const session = {
  id: 's1', date: '2026-09-16', status: 'completed', notes: 'Warm up sesh',
  bankPlayerId: 's1-leo', gameType: 'in-person', createdAt: '2026-09-16T04:00:00.000Z',
  updatedAt: '2026-09-16T12:00:00.000Z', discordThreadId: null, settledAt: null, settledBy: null,
  players: [
    { id: 's1-leo', sessionId: 's1', name: 'Leo', paymentMethod: 'cash', cashOutAmount: 583,
      cashOutDate: '2026-09-16T11:30:00.000Z', cashOut: { amount: 583, timestamp: 1789557000000 },
      buyIns: [{ id: 'b1', playerId: 's1-leo', amount: 600, timestamp: '2026-09-16T05:00:00.000Z', isRebuy: 0, method: 'cash' }] },
  ],
};

function renderResults(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/session/s1/results', state }]}>
      <Routes><Route path="/session/:id/results" element={<Results />} /></Routes>
    </MemoryRouter>
  );
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('Results', () => {
  it('reports what was merged when the session was ended', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(session), { status: 200 })));

    renderResults({ merges: [{ name: 'Leo', keepId: 's1-leo', entries: 2, totalBuyIn: 600, totalCashOut: 583 }] });

    await waitFor(() => expect(screen.getByText(/Merged Leo's 2 entries/)).toBeInTheDocument());
    expect(screen.getByText(/\$600\.00 in, \$583\.00 out/)).toBeInTheDocument();
  });

  it('says nothing when nothing merged', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(session), { status: 200 })));

    renderResults();

    await waitFor(() => expect(screen.getByText('Session Summary')).toBeInTheDocument());
    expect(screen.queryByText(/Merged/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/pages/Results.test.tsx`
Expected: FAIL — the merge note is not in the document.

- [ ] **Step 3: Show the note on the results page**

In `app/src/pages/Results.tsx`, add to the imports:

```tsx
import { useLocation } from 'react-router-dom';
import type { SessionMerge } from '../api';
```

inside the component, above `const session = ...`:

```tsx
  // Passed by End Session, not stored: it describes what just happened, and is
  // gone on reload like any other one-off notice.
  const merges = (useLocation().state as { merges?: SessionMerge[] } | null)?.merges ?? [];
```

and at the top of `<main>`, before the Session Summary card:

```tsx
        {merges.length > 0 && (
          <div className="card mb-4 border-accent-primary">
            {merges.map((merge) => (
              <p key={merge.keepId} className="text-text-secondary text-sm">
                🔗 Merged {merge.name}'s {merge.entries} entries — {formatCurrency(merge.totalBuyIn)} in,{' '}
                {formatCurrency(merge.totalCashOut)} out
              </p>
            ))}
          </div>
        )}
```

- [ ] **Step 4: Point End Session at the new endpoint**

In `app/src/pages/SessionDetail.tsx`, take `endSession` from the hook instead of `updateSession`, drop the now-unused `identifyBankPlayer` import, and replace `handleEndSession`:

```tsx
  const handleEndSession = async () => {
    if (actionLoading) return;

    setActionLoading(true);
    setActionError(null);

    try {
      // The server merges any duplicate entries and picks the banker from the
      // merged results — a player who cashed out and rejoined is one person.
      const { merges } = await endSession(session.id);
      navigate(`/session/${session.id}/results`, { state: { merges } });
    } catch {
      setActionError('Failed to end session. Please try again.');
    } finally {
      setActionLoading(false);
    }
  };
```

- [ ] **Step 5: Run the tests, the build and the linter**

```bash
cd app && npx vitest run && npm run build && npm run lint
```
Expected: all tests pass, build clean, no lint errors. `updateSession` may now be unused in `SessionDetail.tsx` — remove it from the destructuring if lint says so.

- [ ] **Step 6: Verify in the browser**

Start the bench backend and the proxied dev server (`.claude/launch.json`), create a session with two entries for one name, buy in and cash out both, press End Session, and confirm: the results page shows the merge note, the session detail page now lists one Leo with both stints of buy-ins, and the banker is right.

- [ ] **Step 7: Commit**

```bash
git add app/src/pages/SessionDetail.tsx app/src/pages/Results.tsx app/src/pages/Results.test.tsx
git commit -m "$(printf 'End Session: one call, and the results page says what merged\n\nThe button posts to /end instead of PUTting a banker the browser\nworked out, and carries the merge summary to the results page in\nnavigation state — it describes what just happened, so it belongs in\nthe navigation, not the database.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 7: Cleaning up past sessions

**Files:**
- Create: `scripts/merge-duplicate-players.js`

**Interfaces:**
- Consumes: `planMerges` (Task 1)
- Produces: a command-line script; dry-run by default, `--apply` to write

- [ ] **Step 1: Write the script**

Create `scripts/merge-duplicate-players.js`:

```js
#!/usr/bin/env node
// One-off cleanup: collapse duplicate entries of one player in PAST sessions.
//
// From now on POST /api/sessions/:id/end does this when a session ends. Group A
// carries 111 older sessions with a repeated name — mostly online imports from
// before the bot aggregated by canonical name, plus a few in-person nights.
//
//   node scripts/merge-duplicate-players.js                 # dry run, prints every merge
//   node scripts/merge-duplicate-players.js --apply         # writes, after a backup
//   POKER_DB=/srv/poker-b/poker.db node scripts/... --apply # the other group
//
// Nobody's totals change: buy-ins move to the surviving row and cash-outs are
// added together. Only the duplicate rows disappear.

const path = require('path');
const sqlite3 = require(path.join(__dirname, '..', 'backend', 'node_modules', 'sqlite3'));
const { planMerges } = require(path.join(__dirname, '..', 'backend', 'merge-players'));
const { runAsync, allAsync, withTransaction } = require(path.join(__dirname, '..', 'backend', 'db-async'));

const apply = process.argv.includes('--apply');
const dbPath = process.env.POKER_DB || path.join(__dirname, '..', 'backend', 'poker.db');

async function main() {
  const db = new sqlite3.Database(dbPath, apply ? sqlite3.OPEN_READWRITE : sqlite3.OPEN_READONLY);
  const sessions = await allAsync(db, 'SELECT id, date, notes, gameType, bankPlayerId FROM sessions ORDER BY date');

  let sessionsTouched = 0;
  let rowsRemoved = 0;

  for (const session of sessions) {
    const players = await allAsync(db, `
      SELECT p.id, p.name, p.cashOutAmount, p.cashOutDate,
             (SELECT MIN(timestamp) FROM buyIns WHERE playerId = p.id) AS firstBuyInAt
      FROM players p WHERE p.sessionId = ? ORDER BY p.rowid`, [session.id]);

    const plans = planMerges(players);
    if (plans.length === 0) continue;
    sessionsTouched += 1;

    console.log(`\n${session.date}  ${session.gameType}  "${session.notes || ''}"`);
    for (const plan of plans) {
      const rows = [plan.keepId, ...plan.mergeIds].map((id) => {
        const p = players.find((x) => x.id === id);
        return `${JSON.stringify(p.name)} (cash-out ${p.cashOutAmount ?? 'none'})`;
      });
      console.log(`  ${plan.name}: ${rows.join(' + ')}  →  cash-out ${plan.cashOutAmount ?? 'none'}`);
      rowsRemoved += plan.mergeIds.length;
      if (session.bankPlayerId && plan.mergeIds.includes(session.bankPlayerId)) {
        console.log(`    banker was a merged-away row — repointing to ${plan.keepId}`);
      }
    }

    if (!apply) continue;

    await withTransaction(db, async () => {
      for (const plan of plans) {
        const holes = plan.mergeIds.map(() => '?').join(', ');
        await runAsync(db, `UPDATE buyIns SET playerId = ? WHERE playerId IN (${holes})`, [plan.keepId, ...plan.mergeIds]);
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
  if (!apply) console.log('Dry run. Re-run with --apply (after scripts/backup-db.sh) to write.');
  db.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Dry-run it against the real data, read-only**

A dry run opens the database `OPEN_READONLY`, so it can run straight against
production without a copy. From this machine, via the VPS runner script (the
branch has to be on the box first, or copy the two files across):

```bash
bash /c/Users/astep/.ssh/poker-vps.sh '<passphrase>' \
  'cd /root/.openclaw/workspace/poker-tracker && node scripts/merge-duplicate-players.js' \
  | tee <scratch>/merge-dry-a.txt
tail -3 <scratch>/merge-dry-a.txt
```

Expected: around 111 sessions listed, Leo's 16 September pair among them, and
no session where two clearly different people (`Daniel` and `Daniel H`) are
collapsed. Repeat with `POKER_DB=/srv/poker-b/poker.db` for group B, which
should report nothing.

- [ ] **Step 3: Prove on a copy that nobody's totals move**

Work on a copy for the write test, never production:

```bash
cp backend/poker.db <scratch>/merge-apply-test.db     # on the box, or any real snapshot
POKER_DB=<scratch>/merge-apply-test.db node scripts/merge-duplicate-players.js --apply
```

Then, per session, compare the sum of buy-ins and the sum of cash-outs before
and after. They must be identical; only the player row count falls.

- [ ] **Step 4: Commit**

```bash
git add scripts/merge-duplicate-players.js
git commit -m "$(printf 'Script: collapse duplicate entries in past sessions\n\nDry run by default — it prints every merge for a human to read before\nanything is written, because the one thing it cannot know is whether\ntwo people genuinely share a name.\n\nReuses the planner the live endpoint uses, so history and new sessions\ncannot drift apart. Nobody s totals change: buy-ins move to the\nsurviving row, cash-outs add up, duplicate rows go.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 8: Ship it

- [ ] **Step 1: Full check**

```bash
cd app && npm run build && npm run lint && npx vitest run
cd ../backend && npm test
cd ../bot && npm test
```
Expected: all green.

- [ ] **Step 2: Open the PR**

Body covers: what merging does and the Leo example; the banker now chosen after merging (a real behaviour change); the new endpoint and the 409; the session-reader helper; the cleanup script with its dry-run output attached; and the reminder that group B needs its extra `deploy.sh` run after merge.

- [ ] **Step 3: After merge — deploy group B**

```bash
cd /root/.openclaw/workspace/poker-tracker
WEB_ROOT=/var/www/poker-tracker-b BACKEND_SERVICE=tribe-poker-backend-b.service SKIP_BUILD=1 bash deploy.sh
```

- [ ] **Step 4: Run the cleanup on production, with the user's approval**

Back up first (`scripts/backup-db.sh`), show the user the dry run for each group, then `--apply` per database. Group B has no duplicates, so expect it to report nothing.
