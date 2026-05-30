# Player Bank Accounts in the Tracker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move player bank details from the VPS-only `bot/bank-accounts.json` into a `bank_accounts` database table, editable from the Manage Players page (`/#/aliases`), with the Discord bot reading them from the tracker API on demand.

**Architecture:** New `bank_accounts` SQLite table keyed by canonical player name + three REST endpoints on the Express backend (port 5001). The React frontend adds a per-player "💳 bank" button opening an edit modal. The bot drops its JSON read and fetches the accounts map from the API each time it posts a results message, falling back to "no account on file" if the fetch fails. A one-time script migrates the existing 18 entries (folding Arya→Aarya).

**Tech Stack:** Node/Express + sqlite3 (callback API), React + TypeScript + Vite + Tailwind, discord.js bot (ESM), Node built-in `node:test`.

**Key facts for the implementer:**
- Backend has **no test framework** — verify backend tasks with `curl` against a locally running backend (`cd backend && node server.js`, port 5001).
- Bot is ESM (`"type": "module"`) and already uses `node:test` (see `bot/triage.test.js`).
- Frontend type/build check: `cd app && npm run build` (`tsc -b && vite build`).
- sqlite3 here uses the **callback** API (`db.run(sql, params, function(err){ this.changes })`), not promises.
- The canonical player names shown on the right of the aliases page come from `GET /api/alias-mappings` → `canonicalPlayers`.

---

## Task 1: Backend — `bank_accounts` table

**Files:**
- Modify: `backend/database.js` (add a `CREATE TABLE IF NOT EXISTS` inside the existing `db.serialize(() => { ... })` block, after the `removed_canonicals` table at lines 111-117)

- [ ] **Step 1: Add the table definition**

In `backend/database.js`, immediately after the `removed_canonicals` `db.run(...)` block (ends at line 117) and before the `// Migration: add method column` block, insert:

```js
  // bank_accounts: per-player bank details for the bot's Discord settlement
  // messages. Keyed by canonical player name (exact match, same as the bot's
  // lookup). Edited from the Manage Players page.
  db.run(`
    CREATE TABLE IF NOT EXISTS bank_accounts (
      name        TEXT PRIMARY KEY,
      displayName TEXT,
      account     TEXT,
      updatedAt   TEXT NOT NULL
    )
  `);
```

- [ ] **Step 2: Verify the table is created**

Run:
```bash
cd backend && node -e "const db=require('./database'); setTimeout(()=>db.all(\"SELECT name FROM sqlite_master WHERE type='table' AND name='bank_accounts'\",[],(e,r)=>{console.log(e||r);process.exit(0)}),300);"
```
Expected: `[ { name: 'bank_accounts' } ]`

- [ ] **Step 3: Commit**

```bash
git add backend/database.js
git commit -m "Backend: add bank_accounts table"
```

---

## Task 2: Backend — bank-account endpoints (GET / PUT / DELETE)

**Files:**
- Modify: `backend/server.js` (insert after the `PUT /api/alias-mappings/:alias` handler, which ends at line 923, before the `// --- Hand log / all-in EV API ---` comment at line 925)

- [ ] **Step 1: Add the three endpoints**

In `backend/server.js`, insert this block after line 923 (the closing of the `PUT /api/alias-mappings/:alias` handler):

```js
// --- Bank accounts API ---
// Player bank details for the bot's Discord settlement messages. Keyed by
// canonical player name (exact match, same as the bot's lookup).

// GET /api/bank-accounts → { accounts: { "<name>": { displayName, account } } }
app.get('/api/bank-accounts', (req, res) => {
  db.all('SELECT name, displayName, account FROM bank_accounts', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const accounts = {};
    for (const r of rows) {
      accounts[r.name] = { displayName: r.displayName || '', account: r.account || '' };
    }
    res.json({ accounts });
  });
});

// PUT /api/bank-accounts/:name — upsert { displayName, account }
app.put('/api/bank-accounts/:name', (req, res) => {
  const name = (req.params.name || '').trim();
  const displayName = ((req.body && req.body.displayName) || '').trim();
  const account = ((req.body && req.body.account) || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  if (!displayName && !account) {
    return res.status(400).json({ error: 'Provide displayName and/or account, or use DELETE to clear.' });
  }
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO bank_accounts (name, displayName, account, updatedAt) VALUES (?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET displayName = excluded.displayName, account = excluded.account, updatedAt = excluded.updatedAt`,
    [name, displayName, account, now],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ name, displayName, account });
    }
  );
});

// DELETE /api/bank-accounts/:name — remove a player's bank details
app.delete('/api/bank-accounts/:name', (req, res) => {
  const name = (req.params.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  db.run('DELETE FROM bank_accounts WHERE name = ?', [name], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true, name, deleted: this.changes });
  });
});
```

- [ ] **Step 2: Start the backend locally**

Run (in a separate shell, leave it running):
```bash
cd backend && node server.js
```
Expected: `Poker Tracker backend running on port 5001`

- [ ] **Step 3: Verify PUT → GET → DELETE round-trip**

Run:
```bash
curl -s -X PUT http://localhost:5001/api/bank-accounts/TestPlayer -H 'Content-Type: application/json' -d '{"displayName":"Test Holder","account":"01-0000-0000000-00"}'
curl -s http://localhost:5001/api/bank-accounts
curl -s -X DELETE http://localhost:5001/api/bank-accounts/TestPlayer
curl -s http://localhost:5001/api/bank-accounts
```
Expected, in order:
1. `{"name":"TestPlayer","displayName":"Test Holder","account":"01-0000-0000000-00"}`
2. `{"accounts":{"TestPlayer":{"displayName":"Test Holder","account":"01-0000-0000000-00"}}}`
3. `{"ok":true,"name":"TestPlayer","deleted":1}`
4. `{"accounts":{}}`

Also verify the blank-body guard:
```bash
curl -s -X PUT http://localhost:5001/api/bank-accounts/X -H 'Content-Type: application/json' -d '{"displayName":"","account":""}'
```
Expected: `{"error":"Provide displayName and/or account, or use DELETE to clear."}`

Stop the backend (Ctrl-C) when done.

- [ ] **Step 4: Commit**

```bash
git add backend/server.js
git commit -m "Backend: bank-accounts GET/PUT/DELETE endpoints"
```

---

## Task 3: Backend — consistency hooks in delete-player and merge

**Files:**
- Modify: `backend/server.js` — `DELETE /api/players/:name` handler (lines 1229-1264) and `POST /api/players/merge` handler (lines 1159-1196)

- [ ] **Step 1: Cascade bank-account delete when a player is deleted**

In the `DELETE /api/players/:name` handler, inside the `db.serialize(() => { ... })` block, after the `db.run('DELETE FROM hand_evs WHERE playerName = ?', ...)` call (lines 1250-1253) and before the `db.run('INSERT INTO removed_canonicals ...)` call, insert:

```js
    db.run('DELETE FROM bank_accounts WHERE name = ?', [name], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      counts.bankAccounts = this.changes;
    });
```

Also add `bankAccounts: 0` to the `counts` object initializer at line 1233 so the response includes it:

```js
  const counts = { players: 0, aliasMappingsByRealName: 0, aliasMappingsByKey: 0, handEvs: 0, bankAccounts: 0 };
```

- [ ] **Step 2: Move the bank account on merge**

In the `POST /api/players/merge` handler, inside the `db.run('UPDATE hand_evs ...', ...)` callback (the one starting at line 1180), after `counts.handEvs = this.changes;` (line 1182) and before the `db.run('INSERT INTO removed_canonicals ...)` call (line 1187), insert:

```js
      // Move bank details to the merge target if it has none of its own.
      db.run(
        `UPDATE bank_accounts SET name = ? WHERE name = ? AND NOT EXISTS (SELECT 1 FROM bank_accounts WHERE name = ?)`,
        [into, from, into]
      );
      db.run('DELETE FROM bank_accounts WHERE name = ?', [from]);
```

- [ ] **Step 3: Verify merge moves the bank row**

Start the backend (`cd backend && node server.js`), then run:
```bash
curl -s -X PUT http://localhost:5001/api/bank-accounts/MergeFrom -H 'Content-Type: application/json' -d '{"displayName":"From Holder","account":"11-1111-1111111-11"}'
curl -s -X POST http://localhost:5001/api/players/merge -H 'Content-Type: application/json' -d '{"from":"MergeFrom","into":"MergeInto"}'
curl -s http://localhost:5001/api/bank-accounts
```
Expected: the final GET shows `MergeInto` (not `MergeFrom`) holding `From Holder` / `11-1111-1111111-11`.

Cleanup:
```bash
curl -s -X DELETE http://localhost:5001/api/bank-accounts/MergeInto
```
Stop the backend.

- [ ] **Step 4: Commit**

```bash
git add backend/server.js
git commit -m "Backend: keep bank_accounts consistent on player delete/merge"
```

---

## Task 4: Bot — pure bank helpers + tests

**Files:**
- Create: `bot/bank.js`
- Create: `bot/bank.test.js`

- [ ] **Step 1: Write the failing tests**

Create `bot/bank.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountsMapFromResponse, consolidateBankAccounts } from './bank.js';

test('accountsMapFromResponse: extracts a clean map', () => {
  const json = { accounts: { George: { displayName: 'George Lin', account: '01-0170-0115185-00' } } };
  assert.deepEqual(accountsMapFromResponse(json), {
    George: { displayName: 'George Lin', account: '01-0170-0115185-00' },
  });
});

test('accountsMapFromResponse: missing/!object accounts → empty map', () => {
  assert.deepEqual(accountsMapFromResponse(null), {});
  assert.deepEqual(accountsMapFromResponse({}), {});
  assert.deepEqual(accountsMapFromResponse({ accounts: null }), {});
  assert.deepEqual(accountsMapFromResponse('nope'), {});
});

test('accountsMapFromResponse: skips malformed entries, defaults fields', () => {
  const json = { accounts: { A: null, B: { displayName: 'Bee' } } };
  assert.deepEqual(accountsMapFromResponse(json), { B: { displayName: 'Bee', account: '' } });
});

test('consolidateBankAccounts: drops _comment and lists rows', () => {
  const raw = { _comment: 'note', Stephen: { displayName: 'S F', account: '99' } };
  assert.deepEqual(consolidateBankAccounts(raw), [
    { name: 'Stephen', displayName: 'S F', account: '99' },
  ]);
});

test('consolidateBankAccounts: folds Arya into Aarya, Aarya wins', () => {
  const raw = {
    Aarya: { displayName: 'Aarya Real', account: 'AA' },
    Arya: { displayName: 'Arya Old', account: 'AR' },
  };
  const rows = consolidateBankAccounts(raw);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { name: 'Aarya', displayName: 'Aarya Real', account: 'AA' });
});

test('consolidateBankAccounts: Aarya inherits fields it is missing from Arya', () => {
  const raw = {
    Aarya: { displayName: '', account: '' },
    Arya: { displayName: 'Arya Old', account: 'AR' },
  };
  const rows = consolidateBankAccounts(raw);
  assert.deepEqual(rows, [{ name: 'Aarya', displayName: 'Arya Old', account: 'AR' }]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd bot && node --test bank.test.js`
Expected: FAIL — `Cannot find module './bank.js'`.

- [ ] **Step 3: Implement `bot/bank.js`**

Create `bot/bank.js`:

```js
// Pure helpers for the bot's bank-account handling. No side effects — unit-tested.

// Build the { name → { displayName, account } } map from the tracker's
// GET /api/bank-accounts response, tolerating a missing/malformed body.
export function accountsMapFromResponse(json) {
  const accounts = json && typeof json === 'object' ? json.accounts : null;
  if (!accounts || typeof accounts !== 'object') return {};
  const out = {};
  for (const [name, info] of Object.entries(accounts)) {
    if (!info || typeof info !== 'object') continue;
    out[name] = { displayName: info.displayName || '', account: info.account || '' };
  }
  return out;
}

// Consolidate the legacy bank-accounts.json object into a list of rows to import.
// Drops the "_comment" key and folds "Arya" into "Aarya" (same person; Aarya is
// the canonical name). Aarya's own non-empty values win; any field Aarya is
// missing is filled from Arya.
export function consolidateBankAccounts(raw) {
  const obj = { ...(raw || {}) };
  delete obj._comment;
  if (obj.Arya) {
    const aarya = obj.Aarya || { displayName: '', account: '' };
    const arya = obj.Arya;
    obj.Aarya = {
      displayName: (aarya.displayName || '').trim() || (arya.displayName || '').trim(),
      account: (aarya.account || '').trim() || (arya.account || '').trim(),
    };
    delete obj.Arya;
  }
  return Object.entries(obj).map(([name, info]) => ({
    name,
    displayName: (info && info.displayName) || '',
    account: (info && info.account) || '',
  }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd bot && node --test bank.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add bot/bank.js bot/bank.test.js
git commit -m "Bot: pure bank-account helpers (map + Arya→Aarya consolidation)"
```

---

## Task 5: Bot — read bank accounts from the API instead of the JSON file

**Files:**
- Modify: `bot/index.js` (remove the `fs` import at line 18; remove the JSON load at lines 44-46; add a `bank.js` import; add `fetchBankAccounts`; parameterize `formatResultsMessage`; update `postResultsMessage`)

- [ ] **Step 1: Remove the `fs` import**

In `bot/index.js`, delete line 18:
```js
import fs from 'node:fs/promises';
```
(`path` stays — it is still used at line 28 for `__dirname`.)

- [ ] **Step 2: Add the bank helper import**

Next to the other local imports (after `import { createKeyedSerializer } from './serialize.js';`), add:
```js
import { accountsMapFromResponse } from './bank.js';
```

- [ ] **Step 3: Remove the JSON load**

Delete these three lines (currently 44-46):
```js
const bankAccounts = JSON.parse(await fs.readFile(path.join(__dirname, 'bank-accounts.json'), 'utf8'));
delete bankAccounts._comment;
console.log(`Loaded ${Object.keys(bankAccounts).length} bank accounts.`);
```

- [ ] **Step 4: Add `fetchBankAccounts` above `postResultsMessage`**

Immediately before `async function postResultsMessage(thread, session) {`, insert:

```js
// Bank accounts live in the tracker DB. Fetch on demand so edits made in the
// Manage Players UI take effect immediately. Returns {} on any failure, which
// makes formatResultsMessage fall back to "no account on file".
async function fetchBankAccounts() {
  try {
    return accountsMapFromResponse(await trackerGet('/bank-accounts'));
  } catch (err) {
    console.error('Failed to fetch bank accounts:', err.message);
    return {};
  }
}
```

- [ ] **Step 5: Parameterize `formatResultsMessage`**

Change its signature from:
```js
function formatResultsMessage(session, results) {
```
to:
```js
function formatResultsMessage(session, results, bankAccounts) {
```
(The body already references `bankAccounts` at the current lines 594 and 608 — those now resolve to the parameter instead of a module global. No other body changes.)

- [ ] **Step 6: Update `postResultsMessage` to fetch and pass the map**

Replace the body of `postResultsMessage`:
```js
async function postResultsMessage(thread, session) {
  const results = computePerPlayerResults(session);
  const text = formatResultsMessage(session, results);
  await thread.send(text);
}
```
with:
```js
async function postResultsMessage(thread, session) {
  const results = computePerPlayerResults(session);
  const bankAccounts = await fetchBankAccounts();
  const text = formatResultsMessage(session, results, bankAccounts);
  await thread.send(text);
}
```

- [ ] **Step 7: Verify syntax and that no stale references remain**

Run:
```bash
cd bot && node --check index.js && grep -n "fs\.\|bank-accounts.json\|import fs" index.js
```
Expected: `node --check` prints nothing (success); the `grep` prints **no matches** (exit 1 is fine — it means the removed references are gone).

- [ ] **Step 8: Run the full bot test suite**

Run: `cd bot && node --test`
Expected: all tests pass (triage + serialize + bank).

- [ ] **Step 9: Commit**

```bash
git add bot/index.js
git commit -m "Bot: read bank accounts from tracker API instead of JSON file"
```

---

## Task 6: Frontend — API client functions + types

**Files:**
- Modify: `app/src/api/index.ts` (add after the `setAliasMapping` function, around line 184)

- [ ] **Step 1: Add the bank-account types and functions**

In `app/src/api/index.ts`, after the `setAliasMapping` function (ends line 184), insert:

```ts
export interface BankAccount {
  displayName: string;
  account: string;
}
export interface BankAccountsResponse {
  accounts: Record<string, BankAccount>;
}

export async function fetchBankAccounts(): Promise<BankAccountsResponse> {
  const response = await fetch(`${API_BASE_URL}/bank-accounts`);
  return handleResponse<BankAccountsResponse>(response);
}

export async function setBankAccount(name: string, info: BankAccount): Promise<BankAccount & { name: string }> {
  const response = await fetch(`${API_BASE_URL}/bank-accounts/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(info),
  });
  return handleResponse<BankAccount & { name: string }>(response);
}

export async function deleteBankAccount(name: string): Promise<{ ok: true; name: string; deleted: number }> {
  const response = await fetch(`${API_BASE_URL}/bank-accounts/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
  return handleResponse<{ ok: true; name: string; deleted: number }>(response);
}
```

- [ ] **Step 2: Type-check**

Run: `cd app && npm run build`
Expected: build succeeds (no TS errors). This compiles the new exports; they are not yet used, which is fine.

- [ ] **Step 3: Commit**

```bash
git add app/src/api/index.ts
git commit -m "Frontend: API client for bank accounts"
```

---

## Task 7: Frontend — "💳 bank" button + BankAccountModal on Manage Players

**Files:**
- Modify: `app/src/pages/AliasMatcher.tsx`

- [ ] **Step 1: Extend the imports**

Change the api import block at the top of `AliasMatcher.tsx` (lines 3-11) to also import the bank functions and type:

```tsx
import {
  fetchAliasMappings,
  setAliasMapping,
  mergePlayers,
  deletePlayer,
  deleteAlias,
  deleteAllUnmappedAliases,
  fetchBankAccounts,
  setBankAccount,
  deleteBankAccount,
  type AliasMapping,
  type BankAccount,
} from '../api';
```

- [ ] **Step 2: Add bank state and a loader**

Inside `AliasMatcher`, after the existing `const [loading, setLoading] = useState(true);` line (line 29), add:

```tsx
  const [bankAccounts, setBankAccounts] = useState<Record<string, BankAccount>>({});
  const [bankTarget, setBankTarget] = useState<string | null>(null);

  async function loadBankAccounts() {
    try {
      const data = await fetchBankAccounts();
      setBankAccounts(data.accounts || {});
    } catch {
      // Bank details are secondary; don't block the page on a failure here.
    }
  }
```

- [ ] **Step 3: Load bank accounts on mount**

Inside the existing mount `useEffect` (lines 32-50), add a call to `loadBankAccounts()` right after `load();` (line 47):

```tsx
    load();
    loadBankAccounts();
```

- [ ] **Step 4: Add the save/remove handlers**

After the `handleMergeConfirm` function (ends line 196), add:

```tsx
  async function handleBankSave(name: string, info: BankAccount) {
    await setBankAccount(name, info);
    await loadBankAccounts();
    setBankTarget(null);
  }

  async function handleBankRemove(name: string) {
    await deleteBankAccount(name);
    await loadBankAccounts();
    setBankTarget(null);
  }
```

- [ ] **Step 5: Add the "💳 bank" button to each player row**

In the player-row button group, the existing `⤴ merge` button starts at line 361. Insert this button immediately before the `⤴ merge` button:

```tsx
                      <button
                        onClick={(e) => { e.stopPropagation(); setBankTarget(player); }}
                        className={`text-xs px-1.5 py-0.5 rounded hover:bg-bg-tertiary ${
                          bankAccounts[player] ? 'text-yellow-400' : 'text-text-secondary hover:text-yellow-400'
                        }`}
                        title={bankAccounts[player] ? `Edit bank details for "${player}"` : `Add bank details for "${player}"`}
                      >
                        💳 bank
                      </button>
```

- [ ] **Step 6: Render the modal**

After the `{deleteTarget && ( <DeleteModal ... /> )}` block (ends line 426), before the final closing `</div>` of the component, insert:

```tsx
      {bankTarget && (
        <BankAccountModal
          name={bankTarget}
          initial={bankAccounts[bankTarget] ?? null}
          onCancel={() => setBankTarget(null)}
          onSave={handleBankSave}
          onRemove={handleBankRemove}
        />
      )}
```

- [ ] **Step 7: Add the `BankAccountModal` component**

At the end of the file (after the `DeleteModal` component, line 563), add:

```tsx
function BankAccountModal({
  name, initial, onCancel, onSave, onRemove,
}: {
  name: string;
  initial: BankAccount | null;
  onCancel: () => void;
  onSave: (name: string, info: BankAccount) => Promise<void>;
  onRemove: (name: string) => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [account, setAccount] = useState(initial?.account ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = displayName.trim() !== '' || account.trim() !== '';

  async function handleSave() {
    if (!canSave || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(name, { displayName: displayName.trim(), account: account.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onRemove(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="bg-bg-secondary rounded-lg w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-bg-tertiary">
          <h2 className="font-semibold text-text-primary">
            Bank details — <span className="text-yellow-400">{name}</span>
          </h2>
          <p className="text-xs text-text-secondary mt-1">
            Shown in the bot's Discord settlement message when this player is owed money.
          </p>
        </div>
        <div className="p-4 space-y-3">
          <label className="block">
            <span className="text-xs text-text-secondary">Account name</span>
            <input
              autoFocus
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. George Lin"
              className="w-full mt-1 px-3 py-1.5 rounded bg-bg-primary border border-bg-tertiary text-text-primary text-sm focus:outline-none focus:border-yellow-400"
            />
          </label>
          <label className="block">
            <span className="text-xs text-text-secondary">Account number</span>
            <input
              type="text"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="e.g. 01-0170-0115185-00"
              className="w-full mt-1 px-3 py-1.5 rounded bg-bg-primary border border-bg-tertiary text-text-primary text-sm focus:outline-none focus:border-yellow-400"
            />
          </label>
          {error && <div className="text-red-300 text-xs">{error}</div>}
        </div>
        <div className="p-3 border-t border-bg-tertiary flex gap-2 justify-between">
          <div>
            {initial && (
              <button
                onClick={handleRemove}
                disabled={busy}
                className="px-3 py-1.5 rounded bg-red-500/80 text-white text-sm font-semibold hover:bg-red-600 disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              disabled={busy}
              className="px-3 py-1.5 rounded bg-bg-tertiary text-text-primary text-sm hover:bg-bg-primary disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave || busy}
              className="px-3 py-1.5 rounded bg-yellow-400 text-bg-primary text-sm font-semibold disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Type-check and build**

Run: `cd app && npm run build`
Expected: build succeeds, no TS errors.

- [ ] **Step 9: Commit**

```bash
git add app/src/pages/AliasMatcher.tsx
git commit -m "Frontend: edit player bank details from Manage Players page"
```

---

## Task 8: Migration script (one-time)

**Files:**
- Create: `bot/migrate-bank-accounts.js`

This reuses the tested `consolidateBankAccounts` from Task 4. It reads `bot/bank-accounts.json` (present on the VPS) and PUTs each row to the tracker API. It is run once during deploy (Task 9); the pure logic is already covered by `bot/bank.test.js`, so there is no separate test step here.

- [ ] **Step 1: Create the script**

Create `bot/migrate-bank-accounts.js`:

```js
// One-time migration: import bot/bank-accounts.json into the tracker's
// bank_accounts table via the API, folding Arya→Aarya. Safe to re-run (PUT is
// an upsert). After a successful run the JSON file can be deleted.
//
// Usage (on the VPS, from the bot dir):
//   TRACKER_API_BASE=http://127.0.0.1:5001/api node migrate-bank-accounts.js
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { consolidateBankAccounts } from './bank.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { TRACKER_API_BASE } = process.env;
if (!TRACKER_API_BASE) { console.error('Missing TRACKER_API_BASE'); process.exit(1); }

const raw = JSON.parse(await fs.readFile(path.join(__dirname, 'bank-accounts.json'), 'utf8'));
const rows = consolidateBankAccounts(raw);
console.log(`Importing ${rows.length} bank accounts to ${TRACKER_API_BASE} …`);

let ok = 0;
for (const row of rows) {
  const res = await fetch(`${TRACKER_API_BASE}/bank-accounts/${encodeURIComponent(row.name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: row.displayName, account: row.account }),
  });
  if (res.ok) { ok += 1; console.log(`  ✓ ${row.name}`); }
  else { console.error(`  ✗ ${row.name}: HTTP ${res.status} ${await res.text()}`); }
}
console.log(`Done: ${ok}/${rows.length} imported.`);
```

- [ ] **Step 2: Syntax check**

Run: `cd bot && node --check migrate-bank-accounts.js`
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add bot/migrate-bank-accounts.js
git commit -m "Bot: one-time bank-accounts.json → DB migration script"
```

---

## Task 9: Deploy, migrate, retire the JSON, verify

This task runs against the live VPS. SSH is via the ssh-agent loaded earlier (`source ~/.ssh/agent.env`). The backend on the VPS uses `TRACKER_API_BASE`-style local calls on port 5001; the bot's `.env` already defines `TRACKER_API_BASE`.

- [ ] **Step 1: Push all commits**

Run:
```bash
git push origin main
```

- [ ] **Step 2: Pull + build + restart backend & frontend on the VPS**

Run:
```bash
source ~/.ssh/agent.env && ssh root@76.13.182.206 "cd /root/.openclaw/workspace/poker-tracker && git pull --ff-only && bash deploy.sh"
```
Expected: deploy.sh ends with "Deployment complete!" and backend active. (deploy.sh rebuilds the frontend and restarts the backend; the new `bank_accounts` table is created on backend startup.)

- [ ] **Step 3: Restart the bot (deploy.sh does NOT restart it)**

Run:
```bash
source ~/.ssh/agent.env && ssh root@76.13.182.206 "systemctl restart tribe-poker-bot.service && sleep 3 && systemctl is-active tribe-poker-bot.service"
```
Expected: `active`. (The bot no longer reads bank-accounts.json, so it starts even though the file still exists.)

- [ ] **Step 4: Run the migration on the VPS**

Run:
```bash
source ~/.ssh/agent.env && ssh root@76.13.182.206 "cd /root/.openclaw/workspace/poker-tracker/bot && TRACKER_API_BASE=http://127.0.0.1:5001/api node migrate-bank-accounts.js"
```
Expected: `✓` lines for each player and `Done: N/N imported.` with **no** `Arya` line (folded into `Aarya`).

- [ ] **Step 5: Verify the data landed and Aarya exists (Arya does not)**

Run:
```bash
curl -s https://srv1346724.hstgr.cloud/api/bank-accounts | python -c "import sys,json; d=json.load(sys.stdin)['accounts']; print('count:',len(d)); print('Aarya' in d, 'Arya' in d)"
```
Expected: `count: 18` (the original 19 minus `_comment` and minus the folded `Arya` = 18 if Arya+Aarya both existed; otherwise count reflects unique players), then `True False`.

- [ ] **Step 6: Retire the JSON file on the VPS**

Run:
```bash
source ~/.ssh/agent.env && ssh root@76.13.182.206 "cd /root/.openclaw/workspace/poker-tracker/bot && mv bank-accounts.json bank-accounts.json.migrated-$(date +%Y%m%d) && ls bank-accounts.json* "
```
(Renamed rather than deleted, as a safety backup. It is gitignored and no longer read by the bot.)

- [ ] **Step 7: Spot-check the UI**

Open `https://srv1346724.hstgr.cloud/#/aliases`, confirm:
- Players with imported details show a yellow `💳 bank` button; others show a muted one.
- Clicking opens the modal pre-filled; editing + Save persists (re-open to confirm); Remove clears it.

No commit (this task is deploy/ops only).

---

## Self-Review

**Spec coverage:**
- §1 Data model → Task 1 ✓
- §2 Backend API (GET/PUT/DELETE) → Task 2 ✓; consistency hooks → Task 3 ✓
- §3 Frontend (button, modal, api.ts) → Tasks 6 + 7 ✓
- §4 Bot (drop JSON, fetch on demand, parameterize formatResultsMessage, both flows) → Task 5 ✓ (postResultsMessage is the single call site used by both online import and `/announce`)
- §5 Migration (consolidate Arya→Aarya, PUT 18, retire JSON) → Tasks 4 (pure fn + tests) + 8 (script) + 9 (run + retire) ✓
- §6 Notes (no auth; player-history merge out of scope) → no code; acknowledged ✓
- Testing + Deployment sections → Tasks 4/5 tests; Task 9 deploy ✓

**Placeholder scan:** none — every code step shows complete code; every command shows expected output.

**Type/name consistency:** `accountsMapFromResponse` and `consolidateBankAccounts` (Task 4) are the exact names imported in Tasks 5 and 8. `BankAccount` / `BankAccountsResponse` / `fetchBankAccounts` / `setBankAccount` / `deleteBankAccount` (Task 6) match their uses in Task 7. Endpoint shapes (`{ accounts: {...} }`, PUT body `{ displayName, account }`) match across backend (Task 2), bot (Tasks 4/5), and frontend (Tasks 6/7).
