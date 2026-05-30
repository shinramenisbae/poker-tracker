# Manage player bank accounts in the tracker

**Date:** 2026-05-31
**Status:** Approved (design)

## Problem

Player bank details (account holder name + account number) used in the bot's
Discord settlement messages live in `bot/bank-accounts.json`, a gitignored file
that exists only on the VPS. Editing it requires SSH access, the keys must match
canonical tracker player names exactly (a silent failure mode when they don't),
and it has already drifted (`Aarya` and `Arya` are the same person, with two
entries).

## Goal

Move bank accounts into the tracker database, manageable from the existing
**Manage Players** page (`/#/aliases`), and have the bot read them from the
tracker API instead of the JSON file.

## Approach

Add a dedicated `bank_accounts` table plus small REST endpoints, rather than
folding bank fields into the alias/players model. Bank info is a separate
concern keyed by canonical player name, changes rarely, and a clean
`{ name → { displayName, account } }` shape is a drop-in for the bot's current
`bankAccounts` object — minimal bot churn.

Rejected alternative: adding `displayName`/`account` columns to a players table.
There is no single players table — canonical names are derived at query time
from the alias seed, alias mappings, and session player rows
(`GET /api/alias-mappings`).

## 1. Data model

New table, created in `backend/database.js` alongside the others:

```sql
CREATE TABLE IF NOT EXISTS bank_accounts (
  name        TEXT PRIMARY KEY,   -- canonical player name (matches alias realName / session player name)
  displayName TEXT,               -- account holder, shown in Discord (e.g. "George Lin")
  account     TEXT,               -- account number/string
  updatedAt   TEXT NOT NULL
);
```

Keyed by exact canonical name — the same exact-match the bot uses today
(`bankAccounts[player.name]`).

## 2. Backend API (`backend/server.js`)

- `GET /api/bank-accounts` → `{ accounts: { "<name>": { displayName, account } } }`
  (object map, not array, so it is a drop-in for the bot).
- `PUT /api/bank-accounts/:name` → body `{ displayName, account }`. Upsert
  (`INSERT ... ON CONFLICT(name) DO UPDATE`), sets `updatedAt`. Rejects if both
  fields are blank (use DELETE to clear).
- `DELETE /api/bank-accounts/:name` → remove the row.

**Consistency hooks in existing endpoints:**

- `DELETE /api/players/:name` also runs `DELETE FROM bank_accounts WHERE name = ?`.
- `POST /api/players/merge` moves the bank row to the target if the target has
  none: `UPDATE bank_accounts SET name = :into WHERE name = :from AND NOT EXISTS
  (SELECT 1 FROM bank_accounts WHERE name = :into)`, then
  `DELETE FROM bank_accounts WHERE name = :from`.

## 3. Frontend (`app/src/pages/AliasMatcher.tsx`, `app/src/api`)

- A `💳` button on each canonical-player row (beside the existing merge/delete
  buttons). Highlighted (e.g. yellow) when details exist, muted when empty.
- `BankAccountModal` component, mirroring `MergeModal` / `DeleteModal`:
  - Fields: **Account name** (`displayName`) and **Account number** (`account`).
  - **Save** → `PUT /api/bank-accounts/:name`.
  - **Remove** → `DELETE /api/bank-accounts/:name` (shown only when a row exists).
  - **Cancel**.
  - Refetches bank accounts after a successful save/remove.
- `api.ts`: add `fetchBankAccounts()`, `setBankAccount(name, { displayName, account })`,
  `deleteBankAccount(name)`, and a `BankAccount` type.
- Bank accounts are fetched once on mount and re-fetched after each edit — they
  are NOT added to the existing 15-second alias poll (they change rarely).

## 4. Bot (`bot/index.js`)

- Remove the `bank-accounts.json` read (and the `delete bankAccounts._comment`
  line and the startup `Loaded N bank accounts` log tied to it).
- Add `fetchBankAccounts()` → `GET ${TRACKER_API_BASE}/bank-accounts`, returning
  the `accounts` map; returns `{}` on any failure.
- `postResultsMessage(thread, session)` fetches the map and passes it into
  `formatResultsMessage(session, results, bankAccounts)` (which currently reads
  a module-level global — change it to take the map as a parameter). On fetch
  failure the empty map triggers the existing "no account on file" fallback.
  This covers both flows that post results: online import (`processThread`) and
  in-person announce (`POST /announce/:sessionId`).

## 5. Migration (one-time)

A small script reads the VPS `bot/bank-accounts.json`, consolidates `Arya` into
a single `Aarya` entry, and PUTs each of the 18 players to
`PUT /api/bank-accounts/:name`. Run once on the VPS after the backend is
deployed. The JSON file is then retired (deleted on the VPS; already gitignored).

The pure consolidation step (read raw JSON object → list of `{name, displayName,
account}` rows with Arya folded into Aarya, `_comment` dropped) is extracted as
a testable function.

## 6. Out of scope / notes

- **No auth:** the tracker has no authentication, so `GET /api/bank-accounts`
  and the page expose account numbers to anyone with the URL. This is the same
  exposure as today (the bot already posts these numbers publicly in Discord).
  Not addressed here.
- **Player history merge:** this design consolidates only the *bank* entry to
  "Aarya". Merging Arya's session/stat history into Aarya is a separate action
  via the existing merge button, done only if explicitly requested.

## Testing

- Unit-test the pure migration consolidation function (Arya→Aarya, `_comment`
  dropped, fields preserved) and the bot's map-building/fallback.
- Verify the three endpoints with `curl` and the modal via the live UI after
  deploy. No frontend/backend test frameworks currently exist to extend; the bot
  uses Node's built-in `node:test`.

## Deployment

- Frontend + backend change → `git push`, then on VPS `git pull && bash deploy.sh`
  (rebuilds frontend, restarts backend).
- Bot change → also `systemctl restart tribe-poker-bot.service` (deploy.sh does
  not restart the bot).
- Run the migration script once after the backend is up; then delete
  `bot/bank-accounts.json` on the VPS.
