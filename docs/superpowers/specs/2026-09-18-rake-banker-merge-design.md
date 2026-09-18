# Rake tracking, banker override, and merging a player who comes back

**Date:** 2026-09-18
**Status:** awaiting review, then implementation plan

Three features that all land on the same moment — a session ending — so they
share one design, and ship as three PRs in the order below.

## Problem

1. **Rake** is recorded by inventing a player called `Rake` and cashing it out
   with the night's rake: 22 Group A rows, $2,535.50 since 15 March 2026 —
   20 spelled `Rake`/`rake`, plus `rale` ($130 on 6 September) and an empty
   `stephen rake?` row.
   Because it looks like a player it appears as a winner in results and in the
   player stats, and the settlement has the bank paying "Rake". Nothing tracks
   who is physically holding the money, what has been spent, or the running
   total — that lives in a #rake channel maintained by hand.
2. **The banker** is always the biggest winner. Sometimes that is someone new
   to the group and the money should sit with a regular instead. There is no way
   to say so.
3. **A player who cashes out and comes back** is added as a second row. The
   16 September session has Leo down $21 on one row and up $4 on another, when
   he was down $17 on the night. The bot's results post, the stats, and who gets
   picked as banker all read those rows as two people.

## Goals

- Rake recorded as money, not as a fake player, with a running total and a
  per-person record of who holds it, posted automatically to #rake.
- The banker changeable by hand after a session, everywhere it matters —
  including the already-posted Discord results.
- One row per person per session, without changing how the game is run.

## Non-goals

- A rake page in the tracker. Rake movements are recorded with Discord
  commands; the tracker only records each session's rake and holder.
- Per-winner payout tracking, splitting rake between several holders in one
  session, or a rake percentage/automatic calculation. The amount is typed in.
- Touching Group B's data. Group B has never recorded rake and gets the features
  without any backfill; its rake channel is unset until someone runs `/setup`.
- Any change to how sessions are created, or to the online import.

## Decisions taken with the user (2026-09-17)

| Question | Answer |
|---|---|
| How rake is entered | A dedicated field when ending a session, not a player |
| Holder | Defaults to the banker, changeable; may be anyone in the group |
| Rake payment | Bank transfer from banker to holder (table cash all goes to winners) |
| Spending / hand-overs | Both happen, so a ledger is needed |
| Recorded where | Discord commands; holder or admin |
| Past `Rake` players | Converted to the new field |
| #rake posts | One per session, as the bot itself, channel set with `/setup` |
| Opening total | Given by hand (below), already includes the 16 Sep session |
| Banker override | Button on the tracker's results page |
| Override allowed until | The first payment is marked, then locked |
| Discord on override | Edit the results post, plus a short note in the thread |
| Merging | Automatic at End Session, same name ignoring case and spacing |
| Past duplicates | Cleaned up once, after the user reviews the list |

Opening balances, effective after the 16 September 2026 session:

| Holder | Balance |
|---|---|
| Stephen | $372.50 |
| Jordan | $329.00 |
| Jeremy | $40.00 |
| **Total** | **$741.50** |

Amoon handed her rake to Jeremy, who has since spent part of it on communal
snacks and drinks, so only what Jeremy holds today is carried in: $40. The
opening entries record balances as they stand, not the history behind them.

All three are existing canonical players. The figure is lower than the
$2,535.50 the tracker has recorded because rake has been spent over time; the
user's number is authoritative and the converted history contributes nothing to
it (see *Historical conversion*).

---

# Part A — ending a session moves to the server (PR 1)

Today `SessionDetail.tsx` computes the banker in the browser and PUTs
`{status: 'completed', bankPlayerId}`. Merging, rake conversion and banker
selection have to happen together and in a fixed order, so they move to one
endpoint, in one transaction.

```
POST /api/sessions/:id/end
body: { rakeAmount?: number, rakeHolder?: string|null }   // rake fields land in PR 3
→ 200 { session, merges: [{name, keptPlayerId, entries, totalBuyIn, totalCashOut}],
        rake?: { amount, holder, convertedFromPlayer } }
→ 409 if the session is already completed
```

Order inside the transaction:

1. Convert a leftover `Rake` player (PR 3).
2. Merge duplicate names.
3. Pick the banker: biggest profit **after** merging.
4. Store rake and holder (PR 3), set `status = 'completed'`.

Step 3 after step 2 is the point: Leo's two rows must be one before anyone asks
who won the most.

## Merging rules

Two entries are the same player when their names match after trimming,
collapsing runs of whitespace, and ignoring case. `Daniel` and `Daniel H` are
different people and stay separate.

The **earliest** entry is kept — earliest first buy-in, falling back to
insertion order for a row with no buy-ins — along with its spelling and its
place in the list:

- Buy-ins of the later entries are re-pointed to the kept player, keeping their
  own timestamps, so the buy-in list still reads chronologically.
- Cash-out amounts are summed; the cash-out time becomes the latest of them.
  If no entry in a group has cashed out, the merged player has none. (End
  Session already requires everyone to be cashed out, so this is defensive.)
- `paymentMethod` stays that of the kept entry.
- The other player rows are deleted.

Leo, 16 September: $100 + $500 in, $79 + $504 out — one Leo, $600 in, $583 out,
down $17.

Nothing else keys off these row ids: `hand_evs`, `player_session_stats` and
`session_payments` are all keyed by player *name*. `sessions.bankPlayerId` does
reference a row id, which is why the history script repoints it (below).

## What the user sees

The results page shows a note after ending a session — "Merged Leo's 2 entries
— $600 in, $583 out" — passed through navigation state, not stored. Nothing
changes during the game: re-adding a name still creates a second row.

## Historical cleanup

`scripts/merge-duplicate-players.js`, dry-run by default:

- Prints every session with a duplicate, the entries, and the merged result.
- `--apply` backs the database up first (`scripts/backup-db.sh`) and runs in one
  transaction, repointing `bankPlayerId` when it pointed at a merged-away row.
- `POKER_DB` selects the database, so it runs for both groups.

Group A: 36 sessions merge, 74 rows, mostly online imports from before the bot
started aggregating by canonical name, plus the in-person rejoins (Leo on
16 September, Xavian and Jeremy on 19 April, George on 17 March). Group B has
none.

**One case the script refuses**, found while dry-running it against the real
data (2026-09-18): 42 groups are the same ledger imported twice, not a player
coming back. On 8 April 2026 Jordan has two rows of $70 in and $764.71 out,
Paul two of $956.95, Nick four. Adding those together would double that
player's night and bury the evidence that the import ran twice, so the script
lists them as re-imports and leaves them alone; deleting the repeats is the
fix and a separate job. Matching ignores buy-in timestamps, because an import
stamps each row as it writes it — those two Jordan rows are 1.3 seconds apart.

The live endpoint keeps the simple rule: a session ending today comes from the
in-person flow, where every buy-in carries the moment it was tapped in, so two
rows are never copies of each other.

## Tests (written first)

Pure module `backend/merge-players.js`: grouping by normalised name, keeping the
earliest, summing cash-outs, latest cash-out time, single entries untouched, a
group where nobody cashed out, `Daniel` vs `Daniel H` left alone. Frontend: End
Session calls the new endpoint and shows the note.

---

# Part B — changing the banker (PR 2)

```
PUT /api/sessions/:id/banker   body: { playerId }
→ 200 { session }
→ 409 session still active / already settled / a payment is already recorded
→ 400 player is not in this session
```

The results page gains a **Change banker** button listing that session's players
with their results, current banker marked. It is disabled, with the reason
shown, once anyone is marked paid or the books are closed; the server enforces
the same rule, because the tracker has no login and the button cannot be the
only guard.

## The bug this fixes

`formatResultsMessage` (`bot/index.js:768`) names `winners[0]` as bank player,
ignoring `session.bankPlayerId`, while `settlement.js`, `settle.js`, `unpaid.js`
and the reminders all honour it. The results post must use the stored banker,
falling back to the biggest winner exactly as now — otherwise an override leaves
Discord naming the wrong person.

## Discord

The backend forwards to the bot (the `forwardToBot` pattern, carrying `guildId`)
when `discordThreadId` is set:

1. **Edit the results message.** Find the bot's own message in the thread whose
   text starts with the results heading, rebuild the results portion with the
   new banker and bank details, and keep everything from `📈 **Streak watch**`
   onward verbatim, plus the role-mention prefix. Streaks are deliberately not
   recomputed: they were true when posted, and recomputing an old session's
   streak lines would rewrite history.
2. **Post a note**: "🏦 Banker changed to **Stephen** (was Daniel H) — pay
   Stephen instead", with Stephen's bank account when one is on file. No
   mentions: the daily reminder already chases people and now names the new
   banker by itself.

Reminders, `/unpaid`, `/finish` and the debt board need no changes.

## Tests (written first)

Pure `canChangeBanker` module: active session, already settled, payment
recorded, player not in session, happy path. Bot: `formatResultsMessage`
honours `bankPlayerId`; the message rebuild preserves the streak tail. Frontend:
disabled state with reason, and the request it sends.

---

# Part C — rake (PR 3)

## Storage

```sql
ALTER TABLE sessions ADD COLUMN rakeAmount REAL NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN rakeHolder TEXT;   -- player name; NULL = follows the banker

CREATE TABLE IF NOT EXISTS rake_entries (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL,     -- 'session' | 'spend' | 'give' | 'adjust'
  amount           REAL NOT NULL,     -- always positive; kind and columns give direction
  fromName         TEXT,              -- debited:  spend, give, negative adjust
  toName           TEXT,              -- credited: session, give, positive adjust
  sessionId        TEXT,              -- 'session' entries
  note             TEXT,
  createdAt        TEXT NOT NULL,
  createdBy        TEXT,              -- Discord username, or 'tracker'
  discordMessageId TEXT,              -- the #rake post, so corrections can edit it
  FOREIGN KEY (sessionId) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rake_session ON rake_entries(sessionId) WHERE kind = 'session';
```

A person's balance is the sum of what they were credited minus what they were
debited; the pile is every credit minus every spend (hand-overs net to zero).
Nothing is stored as a running balance, so a wrong entry can be traced and
reversed rather than overwriting a number.

`rakeHolder` is a name, not a player id, because the holder need not have played
that session. NULL means "the banker", so the holder follows a banker change on
its own; a holder picked by hand stays put.

## Ending a session with rake

The End Session screen gains an optional rake amount (defaults to $0) and a
"held by" picker defaulting to the banker and listing every player the tracker
knows (the canonical names from `/api/alias-mappings` plus every name that has
played), so someone who sat out can hold it. `POST /api/sessions/:id/end` then:

- **Converts a leftover `Rake` player**: `rake = its cash-out − its buy-ins`,
  then the row is deleted. If the rake field was also filled in, the typed
  amount wins and the response says the `Rake` player was discarded, so the
  amount can never be counted twice.
- Stores `rakeAmount` and `rakeHolder`.
- Writes one `session` ledger entry crediting the resolved holder. **$0 rake
  writes no entry and posts nothing.**

## What rake does to the money

- The pot balances as **buy-ins = cash-outs + rake**; `getSessionTotals` and its
  "pot is off by" warning are updated to match.
- Settlement treats rake as a **bank transfer from banker to holder**: all table
  cash still goes to the winners, and the holder is owed the rake on top of
  their own result. Holder is the banker → nothing moves.
- `bankTransfersOut` includes it, and the results page and Discord post show
  `Rake $133 → Stephen`.
- Mirrored in `bot/settlement.js`, which the results post uses.

Rake amount and holder stay editable from the results page with no lock — a
typo should not be permanent. An edit updates the ledger entry and the #rake
post.

## Historical conversion

`scripts/convert-rake-players.js`, dry-run by default, `--apply` with a backup:
each rake row becomes its session's `rakeAmount` (cash-out − buy-ins, which
gives $40 for the 27 May session where Rake had a $40 buy-in and an $80
cash-out) and the row is deleted. `rakeHolder` is left NULL. A $0 row — the one
`stephen rake?` — is deleted without setting any rake.

Rows are matched against an explicit list of names, trimmed and lower-cased:
`rake`, `rale`, `stephen rake?`. A list, not a pattern, so a future player
called something like "Drake" can never be swallowed. 22 rows in Group A, none
in Group B.

These sessions get **no ledger entries** — that money is already inside the
opening balances. Visible effects: `Rake` stops appearing as a winner on old
results and leaves the player stats, where it currently sits near the top.

The aliases UI builds its canonical list from the seed file, alias targets and
distinct session-player names. None of these three is in the seed file and none
is an alias target, so deleting the rows is what removes the names — no
`removed_canonicals` entry is needed.

The opening balances go in as three `adjust` entries dated at the cut-off, noted
"opening balance".

## Discord

`/setup rake_channel:#rake` adds `rakeChannelId` to `bot_settings`, resolved by
`settings.js` with the same DB-over-env precedence as every other field and
shown by `/settings`. Unset → the ledger still records, nothing is posted.

Per-session post, sent when a session ends with rake:

```
🧾 Wednesday sesh — 23 Sep
Rake $133 → held by Daniel H
Pile: $874.50 · Stephen $372.50 · Jordan $329.00 · Daniel H $133.00 · Jeremy $40.00
```

(The first session after the cut-off, on top of the $741.50 opening balances.)

Its message id is stored on the ledger entry. A later correction edits that post
and adds a line — "✏️ Rake for Wednesday sesh corrected: $133 → $143. Pile now
$934.81" — rather than silently rewriting it. Older posts keep the totals that
were true when written; the newest always carries the current pile.

Commands, usable anywhere in the server, replying only to the caller, with the
public record always posted in #rake:

| Command | Effect |
|---|---|
| `/rake spend amount note` | Debits the caller's balance; money leaves the pile |
| `/rake give to amount` | Moves rake from the caller to another player |
| `/rake balance` | The pile and who holds what |
| `/rake adjust player amount note` | Admin only; corrections and opening balances |

Spending and hand-overs come out of the caller's own balance, so the caller must
be linked (`/link`, the same mapping `/paid` uses). Manage Server can act for
anyone. An entry that would take a person below zero is refused, showing their
real balance; an admin fixes it with `/rake adjust`.

If Discord is unreachable — no channel set, missing permission — the rake is
still saved and the ledger is still right; the results page shows the same kind
of warning "Post to Discord" gives today.

## Tests (written first)

Pure modules only, as the bot's existing suite does: balances from a list of
entries (credits, debits, hand-overs netting to zero, opening balances), the
conversion rule including the buy-in case, settlement with rake (frontend and
bot, same fixtures), message formatting for each entry kind, and every refusal
path (unlinked caller, non-admin adjusting, overspending).

---

## Deployment notes

- No new npm dependencies, so `deploy.sh` not running `npm install` is not a
  problem.
- New columns and tables are created by `backend/database.js` on start, as with
  every previous migration; deploying is the migration.
- Group B needs its usual extra `deploy.sh` invocation after each PR.
- The two backfill scripts are run by hand, per database, after review.
- The Discord webhook the user pasted is not used; it should be deleted, as its
  URL is in a chat transcript.

## Risks

| Risk | Handling |
|---|---|
| Two different people with the same name get merged | The group already uses "Daniel H"/"Daniel Y"; the results note names every merge; the history script is reviewed before it runs |
| History cleanup doubles a night that was imported twice | The script detects copied rows by their money rather than their timestamps, and refuses to merge them |
| Banker changed after money has moved | Locked once any payment is marked, server-side |
| Rake ledger drifts from the money in someone's pocket | Every change is an auditable row; `/rake balance` and the #rake posts read from it; admin adjustments correct it |
| An old results post is edited long after the fact | Only the results portion is rebuilt; the streak tail is preserved verbatim |
