# `/finish` — closing the books on a session

**Date:** 2026-08-17
**Status:** approved, ready for implementation plan

## Problem

Money moves in two legs after a session:

| Leg | Tracked today |
|---|---|
| Losers → bank player (`bankOwed`) | Yes — `/paid` records it, `unpaidDebtors` drives the daily reminders |
| Bank player → winners (their profit) | **Not at all** |

Nothing records whether the bank player actually paid the winners out. Once the
last debtor is marked paid the session simply falls out of the reminder loop and
goes quiet, whether or not the winners ever saw their money. There is no way to
answer "did we ever settle that night?" — which is exactly the question that
comes up weeks later.

## Goals

- Record the second leg, so a session can be shown as genuinely settled.
- Refuse to record it while anyone still owes, so "settled" means one thing.
- Make it visible where people look: in the thread and in the tracker.
- Be undoable, since a misclick otherwise needs database surgery.

## Non-goals

- Changing when reminders stop. They already stop when the last debtor is marked
  paid; `/finish` is a record, not a mute button.
- Tracking *individual* winner payouts. One flag per session, not per winner.
  Splitting it per winner is a bigger model change and nobody has asked for it.
- Touching `status`. See below.

## Storage

Two new columns on `sessions`, added with the `ALTER TABLE … ADD COLUMN` pattern
already used for `gameType` and `discordThreadId` (`backend/database.js`):

```sql
ALTER TABLE sessions ADD COLUMN settledAt TEXT;   -- ISO timestamp, NULL = books open
ALTER TABLE sessions ADD COLUMN settledBy TEXT;   -- tracker player name, else Discord username
```

**Not** `status`. That column is `'active' | 'completed'` and means *the game*
finished — everyone cashed out. `SessionCard.tsx` and the Home page's
active-session filter both key off it. A session is routinely `completed` for a
week while the bank chases transfers, so overloading it would conflate two
independent ideas and break both readings.

## API

Two routes on the existing session resource:

- `POST /api/sessions/:id/settle` with `{ settledBy }` → sets `settledAt` to now.
  `settledBy` is the caller's linked tracker player name when there is one, and
  their Discord username otherwise — an admin closing a session on someone
  else's behalf may not be a player at all.
- `DELETE /api/sessions/:id/settle` → clears both columns. The undo.

`GET /api/sessions` already returns whole session rows, so the new fields reach
the bot and the frontend without further work.

## The command

`/finish`, run inside a session results thread, with one option:

| Option | Type | Meaning |
|---|---|---|
| `reopen` | boolean, optional | Reverses a previous `/finish` |

An explicit flag rather than a second command or a re-run that silently flips
state — `/finish` on its own must never do something surprising.

### Flow

1. **Sync guard.** Must be in a thread under the watched channel. Instant
   ephemeral reply, no network call, so it cannot hit Discord's 3s window.
2. **Defer**, then resolve the session from the thread id.
3. **Permission.** The caller must be linked to that session's bank player, or
   hold Manage Server. The bank player is `session.bankPlayerId`, falling back to
   `identifyBankPlayer()`; the link comes from `/link` or a previous `/paid`. A
   refusal names both routes, so an unlinked bank player is told to run `/link`
   rather than left guessing.
4. **The gate.** Two checks, in order:
   - The session must be `completed`. An in-progress session has no cash-outs,
     so it has no debtors and `hasOutstanding` is vacuously false — without this
     check `/finish` would cheerfully settle a game still being played.
   - If any debtor is still unpaid, refuse and list them with amounts. Reuses
     `hasOutstanding` rather than reimplementing the money model.
5. **Record**, and post a **public** confirmation in the thread.

### Visibility

The success message is public: the group wants to know the books are closed.
Because Discord fixes visibility when an interaction is deferred, the refusals in
steps 3–5 are public too. For step 4 that is a feature — naming who still owes
nudges them. It is a deliberate trade, not an oversight.

## Frontend

A `Settled` badge on `SessionCard`, rendered only when `settledAt` is set, beside
the existing Active/Completed badge rather than replacing it. The two answer
different questions and both matter.

## Error handling

| Condition | Behaviour |
|---|---|
| Not in a session thread | Ephemeral nudge, before any network call |
| No session for this thread | Reported; nothing written |
| Session still `active` | Refused — the game isn't over, so there is nothing to settle |
| Caller is neither bank player nor admin | Refused, naming both routes |
| Debtors still outstanding | Refused, listing names and amounts |
| Already settled, `reopen` not passed | Says when and by whom, suggests `reopen:true` |
| `reopen:true` on a session that was never settled | Says so; no write |
| Tracker write fails | Reported as failed. No "closed the books" claim on a failed write |

## Testing

The decision logic goes in a new `bot/settle.js` as one pure function, tested
first in the style of `bot/roles.test.js`:

```js
canFinish({ session, callerPlayerName, isAdmin, paidNames, alreadySettled, reopen })
// -> { ok: true } | { ok: false, reason: string }
```

Cases: bank player allowed; admin allowed; a random player refused; an `active`
session refused even though it has no debtors; outstanding
debtors refused and named; already-settled refused without `reopen`; `reopen` on
an unsettled session refused; bank player identified from `bankPlayerId` and from
the biggest-winner fallback.

The route, the column migration and the badge are thin and verified live — a
real `/finish` in group B's throwaway session, then the badge in the web UI.
