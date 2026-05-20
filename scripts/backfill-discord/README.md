# backfill-discord

One-shot script to backfill historical **online** poker sessions from a Discord channel into the poker-tracker.

## What it does

1. Connects to Discord using a bot token.
2. Walks every thread in the configured channel.
3. For each thread, downloads attached images and uses Claude vision to detect:
   - **White-background "Session Ledger" screenshot** → online session (will be parsed).
   - **Poker-tracker-style summary** → in-person session (skipped; already in tracker).
4. Extracts player rows from online ledgers (`name`, `buyIn`, `buyOut`, `stack`, `net`) and applies the alias mapping in `aliases.json`.
5. Skips any session whose `(date, playerCount)` matches an existing tracker session.
6. Writes `dry-run.json` — a structured preview for human review.
7. After review, `import.js` POSTs each approved session to the tracker API with `gameType: 'online'`.

## Setup

```bash
cd scripts/backfill-discord
npm install
cp .env.example .env
# fill in DISCORD_TOKEN, DISCORD_CHANNEL_ID, ANTHROPIC_API_KEY
```

Fill in `aliases.json` with the online-name → real-name mapping. Aliases without a mapping will be flagged in the dry-run; you can fix the file and re-run `parse.js`.

## Run

```bash
# Pass 1: parse everything, write dry-run.json
npm run parse

# Review dry-run.json. Set willImport=false on any session you want to skip.

# Pass 2: POST approved sessions to the tracker
npm run import
```

Both passes are safe to re-run. The import pass is idempotent — `parse.js` consults the tracker for existing sessions on every run, and `import.js` writes a `Imported from Discord (threadId=...)` marker into the session's `notes` field which `parse.js` recognizes on subsequent runs.

## Verify

After import:

- Open the tracker UI → online sessions should appear with the expected dates and rosters.
- Spot-check 2–3 sessions: net per player should match the original Discord screenshot.
- Re-run `npm run parse` — every previously-imported session should be skipped.
