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

Everything except `/link` is gated on the single `DISCORD_CHANNEL_ID`:
ledger auto-import, `/paid`, `/unpaid`, results posts, Fix & repost and the
daily reminders. And Discord role IDs are per-server, so the @poker ping and the
🔥/🧊 streak roles don't exist in the other server. An invited bot would show its
slash commands and do essentially nothing.

## What each instance needs

Everything is env-configurable. Instance A keeps working untouched — all the
env vars below default to its current values.

| Setting | Instance A (existing) | Instance B (new) |
|---|---|---|
| `PORT` (backend) | unset → `5001` | `5002` |
| `POKER_DB` | unset → `backend/poker.db` | `/srv/poker-b/poker.db` |
| `CORS_ORIGINS` | unset → current allow-list | `https://poker-b.example.com` |
| `BOT_HTTP_PORT` | `6300` | `6301` |
| `TRACKER_API_BASE` | `https://srv1346724…/api` | `https://poker-b.example.com/api` |
| `TRACKER_UI_BASE` | `https://srv1346724…` | `https://poker-b.example.com` |
| `DISCORD_TOKEN` / `DISCORD_APP_ID` | app A | **a second Discord application** |
| `DISCORD_CHANNEL_ID` | A's channel | B's channel |
| `DISCORD_*_ROLE_ID` | A's roles | B's roles |
| `BOT_BASE` (backend → bot) | unset → `127.0.0.1:6300` | `http://127.0.0.1:6301` |

### Why a second Discord *application*, not just a second server invite

Two processes running the same bot token both hold a gateway connection and both
receive every event — you'd get duplicate imports and double replies. Create a
new application in the Developer Portal with its own token and Application ID.

## Setup

```bash
# 1. Data dir for instance B
mkdir -p /srv/poker-b

# 2. Backend service (copy the existing unit, add env + a distinct name)
#    systemctl edit --force --full tribe-poker-backend-b.service
#    [Service]
#    Environment=PORT=5002
#    Environment=POKER_DB=/srv/poker-b/poker.db
#    Environment=CORS_ORIGINS=https://poker-b.example.com
#    WorkingDirectory=/root/.openclaw/workspace/poker-tracker/backend
#    ExecStart=/usr/bin/node server.js

# 3. Bot service — same code, its own env file
#    cp bot/.env bot/.env.b   # then edit every value in the table above
#    systemctl edit --force --full tribe-poker-bot-b.service
#    (ExecStart with an EnvironmentFile pointing at bot/.env.b)

systemctl daemon-reload
systemctl enable --now tribe-poker-backend-b.service tribe-poker-bot-b.service
```

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

## Known gap: CI only deploys instance A

`deploy.sh` hardcodes instance A's paths and restarts
`tribe-poker-backend.service`, so a merge to `main` will **not** update instance
B. Until that's parameterised, after each deploy run:

```bash
cd /root/.openclaw/workspace/poker-tracker
cp -r app/dist/* /var/www/poker-tracker-b/
systemctl restart tribe-poker-backend-b.service tribe-poker-bot-b.service
```
