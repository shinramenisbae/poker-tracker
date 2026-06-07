# /paid tracking + daily reminders

Lets players mark their debts paid via a `/paid` slash command, and pings whoever
still owes at a configured time each day (default 10am NZ time).

## How it works

- **`/paid`** (slash command, used inside a session results thread):
  - `/paid` with no argument marks **you** as paid for that session. Requires the
    bot to know who you are (see linking below).
  - `/paid player:<name>` marks a named player paid (the bank player uses this to
    mark others). If you run it with your *own* name the first time, the bot
    **remembers** you (links your Discord user → that player) so future bare
    `/paid` works and reminders can @mention you.
  - Only players who owe a **bank transfer** can be marked — pure cash-on-table
    losers have nothing to chase, mirroring the Results-page settlement.
  - The bot replies in-thread with who's marked and who's still outstanding.

- **Daily reminder** (`PAYMENT_REMINDER_HOUR` in `PAYMENT_REMINDER_TZ`, default
  10:00 `Pacific/Auckland`): scans every session with unpaid debtors and posts
  one reminder per thread, @mentioning the linked Discord users (falling back to
  plain names when a player isn't linked yet). DST is handled automatically.

## State (backend tables)

The bot has no DB of its own; state lives in the tracker DB via new endpoints:

- `discord_links (discordUserId → playerName)` — who is who.
- `session_payments (sessionId, playerName, paidAt, paidBy)` — absence of a row
  means unpaid. Survives bot restarts and the daily job.

Endpoints: `GET/PUT/DELETE /api/discord-links/:id`,
`GET /api/sessions/:id/payments`, `PUT/DELETE /api/sessions/:id/payments/:name`.

## Setup (on the VPS)

1. Set in the bot's `.env`:
   ```
   DISCORD_APP_ID=<your Discord application id>     # required for /paid
   PAYMENT_REMINDER_HOUR=10                         # optional (default)
   PAYMENT_REMINDER_TZ=Pacific/Auckland             # optional (default)
   ```
2. The bot registers `/paid` globally on startup (can take a few minutes to
   appear the first time). The bot must have the `applications.commands` scope —
   if it doesn't, re-invite it with that scope:
   `https://discord.com/api/oauth2/authorize?client_id=<APP_ID>&scope=bot+applications.commands&permissions=...`
3. Restart the bot: `systemctl restart tribe-poker-bot.service`.

## Notes

- Linking is per Discord user; one user maps to one player name. A player can be
  re-linked by running `/paid player:<name>` again from a different account only
  if not already linked — to move a link, clear it via
  `DELETE /api/discord-links/:id`.
- The reminder pings across **all** sessions that still have outstanding bank
  transfers. Mark everyone paid (or settle) to stop a thread being pinged.
