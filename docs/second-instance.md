# Running a second, isolated instance (a different poker group)

## Short version

**Don't share the tracker.** Share the *VPS*.

The tracker has no notion of which Discord server a session came from — one
player list, one session history, one stats page, one luck leaderboard, one
streak calculation, one set of bank accounts. Pointing a second group's bot at
the same backend merges the two groups' money and stats into one pile.

Instead run a second instance beside the first on the same box: separate DB,
separate backend port, separate bot, separate hostname. Same hardware, same
codebase, zero shared data.

(The alternative — real multi-tenancy, a `guildId` column on every table and
scoping every query, endpoint and chart — is a large change with migration risk
on a live DB holding years of history. Not worth it for two groups.)

## Why the bot can't simply be invited to the second server

Each running bot process watches exactly **one** channel. Ledger auto-import,
`/paid`, `/unpaid`, results posts, Fix & repost and the daily reminders are all
gated on it, and `/setup` sets that one channel — so pointing it at the second
server would just stop it working in the first. A second *process* is what makes
two servers possible; `/setup` is what makes configuring each of them easy.

## What each instance needs

Only **bootstrap** config lives in files — the values the bot needs before it
can read its own database. Everything Discord-side is set by the second group's
own server owner with `/setup`, so you never edit their config for them.

| Setting | Instance A (existing) | Instance B (new) |
|---|---|---|
| `PORT` (backend) | unset → `5001` | `5002` |
| `POKER_DB` | unset → `backend/poker.db` | `/srv/poker-b/poker.db` |
| `CORS_ORIGINS` | unset → current allow-list | `https://poker-b.example.com` |
| `BOT_BASE` (backend → bot) | unset → `127.0.0.1:6300` | `http://127.0.0.1:6301` |
| `BOT_ENV_FILE` | unset → `bot/.env` | `/srv/poker-b/bot.env` |
| `BOT_HTTP_PORT` | `6300` | `6301` |
| `TRACKER_API_BASE` / `TRACKER_UI_BASE` | instance A's host | instance B's host |
| `DISCORD_TOKEN` / `DISCORD_APP_ID` | app A | **a second Discord application** |
| `GEMINI_API_KEY` | shared | shared |

Set from Discord with `/setup`, not in any file: the watched **channel**, the
**ping / hot / cold roles**, the **reminder hour + timezone**, and the
**chip divisor**. (The old env vars still work as a fallback, so instance A is
unaffected — but `/setup` takes precedence and is the supported path.)

## Handover: what the other group's owner does

Once their bot is running, they run this in their own server — no IDs to copy,
no Developer Mode, no access to your box:

```
/setup channel:#poker-sessions poker_role:@Poker hot_role:@Running Hot cold_role:@Running Cold
```

Discord shows native channel and role pickers for those options. `/setup` is
restricted to **Manage Server**, every option is optional (so it doubles as
"change one thing later"), and `/settings` prints the current config. Until a
channel is set the bot stays idle and says so in its logs.

### Why a second Discord *application*, not just a second server invite

Two processes running the same bot token both hold a gateway connection and both
receive every event — you'd get duplicate imports and double replies. Create a
new application in the Developer Portal with its own token and Application ID.

## ⚠️ The one that will bite you: `BOT_ENV_FILE`

Instance B runs from the **same checkout** as instance A, and `dotenv` fills any
variable the environment doesn't already define from `bot/.env` — instance A's
config. Omit one value from B's config and it silently inherits A's. If that
value is `DISCORD_TOKEN`, you get two processes on one bot token: duplicate
imports and double replies, with nothing in the logs saying why.

So instance B sets `BOT_ENV_FILE=/srv/poker-b/bot.env`, which makes dotenv load
**only** that file. It must therefore be complete — start from
`scripts/poker-b.env.example`, which lists every variable.

## Setup

```bash
cd /root/.openclaw/workspace/poker-tracker

# 1. Data dir + bot config for instance B
mkdir -p /srv/poker-b
cp scripts/poker-b.env.example /srv/poker-b/bot.env
chmod 600 /srv/poker-b/bot.env          # contains a bot token
$EDITOR /srv/poker-b/bot.env            # fill in every value

# 2. Services (edit the placeholder hostname/paths in both first)
cp scripts/systemd/poker-backend-b.service /etc/systemd/system/tribe-poker-backend-b.service
cp scripts/systemd/poker-bot-b.service     /etc/systemd/system/tribe-poker-bot-b.service
$EDITOR /etc/systemd/system/tribe-poker-backend-b.service   # CORS_ORIGINS, paths

systemctl daemon-reload
systemctl enable --now tribe-poker-backend-b.service tribe-poker-bot-b.service
systemctl status tribe-poker-backend-b.service tribe-poker-bot-b.service --no-pager
```

Expected in `journalctl -u tribe-poker-bot-b.service`:
`Registered /paid, /unpaid, /link, /setup and /settings slash commands.` and
`Next payment reminder in N.Nh (10:00 Pacific/Auckland).` — plus, until
`/setup` has been run, a line telling the owner to run it.

### nginx

The frontend calls `/api` **relative** to whatever host serves it, so instance B
needs no rebuild — just its own server block:

```nginx
server {
    server_name poker-b.example.com;
    client_max_body_size 20m;              # hand logs, same as instance A
    root /var/www/poker-tracker-b;         # its own copy of the built frontend
    location /api/ { proxy_pass http://127.0.0.1:5002; }
}
```

### Backups

`scripts/backup-db.sh` already honours `POKER_DB`, so instance B gets its own
timer with `Environment=POKER_DB=/srv/poker-b/poker.db` and a distinct
`POKER_BACKUP_DIR`.

## Deploying instance B

CI deploys instance A only. `deploy.sh` now takes overrides, so instance B is
one extra command after each deploy (`SKIP_BUILD=1` reuses the build CI just
produced — both instances run identical frontend code):

```bash
cd /root/.openclaw/workspace/poker-tracker
WEB_ROOT=/var/www/poker-tracker-b \
BACKEND_SERVICE=tribe-poker-backend-b.service \
BOT_SERVICE=tribe-poker-bot-b.service \
SKIP_BUILD=1 \
  bash deploy.sh
```

Worth wiring into the CI deploy step once instance B is proven; left manual for
now so a second-instance problem can't fail instance A's deploy.

## Checklist

- [ ] Second Discord application created (own token + Application ID)
- [ ] Invited to the second server with `bot applications.commands`, and
      Manage Roles + Manage Threads
- [ ] `/srv/poker-b/bot.env` complete (from `scripts/poker-b.env.example`), `chmod 600`
- [ ] Both systemd units installed, hostname/paths edited, enabled and active
- [ ] nginx server block for the new hostname + TLS cert
- [ ] Backup timer for `/srv/poker-b/poker.db`
- [ ] Sanity check: `curl -s localhost:5002/api/sessions` returns `[]`
      (a fresh, empty DB — **not** instance A's sessions)
- [ ] Handed over: their owner ran `/setup channel:#… poker_role:@… …`
      and `/settings` shows what they expect
