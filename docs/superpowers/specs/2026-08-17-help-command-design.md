# `/help` — what to do, not what exists

**Date:** 2026-08-17
**Status:** approved, ready for implementation plan
**Ships with:** `2026-08-17-finish-command-design.md` — `/help` must document `/finish` from day one.

## Problem

Eight commands after `/finish` lands, across two audiences that barely overlap:
players use four, admins use three and mostly once.

But the gap is not "what commands exist" — Discord's native picker already
answers that, and answers it well: every command and option carries a real
description, so typing `/` yields *Mark a player as having paid their debt for
this session*. A help command that lists commands would duplicate that and rot.

The gaps are:

1. **Sequence.** Nobody is confused about what `/paid` does. They are confused
   about the order: play → upload the ledger CSV → bot posts results → losers
   `/paid` → bank `/finish`. That is written down nowhere.
2. **Location.** A decent player guide exists at the bottom of
   `docs/openclaw-runbook.md`, under VPS backups and nginx config, in a GitHub
   repo no player will open.
3. **Generic answers to specific questions.** "When do reminders fire?" has a
   real answer per server — 10:00 Pacific/Auckland here — that static docs
   cannot give.

## Goals

- Answer "what do I do now", ordered by when it happens.
- Give *this* server's answers, from its own `/setup` config.
- Separate the two audiences so neither reads the other's material.

## Non-goals

- Listing every command and option. The picker does that; duplicating it means
  two places to update and one of them silently going stale.
- Replacing `docs/`. Operator documentation stays where it is.
- A permission gate. Anyone may read either topic; the admin text describes
  commands Discord already hides from non-admins.

## The command

`/help`, no permission gate, one optional option:

| Option | Type | Choices | Default |
|---|---|---|---|
| `topic` | string | `player`, `admin` | `player` |

Ephemeral — help is noise to everyone else in the channel.

No deferral. Everything it needs is in memory: `settings()` is the cached
`/setup` config and `currentTracker().uiBase` is the guild's tracker URL, so the
reply is immediate and cannot hit Discord's 3s window.

## Content

Written as a sequence, not a table of commands. Real values substituted from the
current guild's settings, shown as *not configured* when unset rather than
printed as a blank.

**`player`** — after a session: drop the PokerNow `ledger_*.csv` into the
watched channel and the bot creates the session and posts results in a thread;
`poker_now_log_*.csv` adds hand history and all-in EV. Link yourself once with
`/link`. Run `/paid` in the results thread once you have sent your money. Check
`/unpaid` to see who is still outstanding. State when reminders fire, using the
configured hour and timezone. Note that the bank player runs `/finish` to close
the books. Link to the tracker for full stats.

**`admin`** — `/setup` to point the bot at a channel, `/setup-roles` to create
and hand out the roles, `/settings` to show the current config. The permissions
the bot needs (Manage Roles, Manage Threads) and the one thing that silently
fails without it: its role must sit above the streak roles. Reminder hour,
timezone and chip divisor are `/setup` options.

## Discoverability

A help command nobody runs is worth nothing, so:

- `/settings` already points at `/setup-roles` when roles are unset. Same
  pattern: where a command refuses for a fixable reason, name the fix.
- The results post footer gains a single line: *New here? Run `/help`.*

## Structure

Composing the text is pure and gets its own module, `bot/help.js`:

```js
helpText({ topic, settings, uiBase }) // -> string
```

Keeping it out of `index.js` matters here — `index.js` is already ~1900 lines,
and prose is exactly the kind of content that bloats a file without adding
behaviour.

## Testing

Tested first, against behaviour rather than wording:

- `player` topic names the configured channel; `admin` topic does not.
- An unconfigured channel renders as *not configured*, never as an empty mention.
- The configured reminder hour and timezone appear in the player text, so a
  server on a different schedule gets its own answer.
- `admin` topic covers `/setup`, `/setup-roles` and `/settings`.
- An unknown or missing topic falls back to `player` rather than erroring.
- Output stays within Discord's 2000-character message limit for both topics.

That last one is a real constraint, not a formality: prose grows, and the failure
mode is the whole reply vanishing at runtime.
