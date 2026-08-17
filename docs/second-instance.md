# Adding another poker group

One bot, one box, several Discord servers — each with **its own tracker and its
own database**, so no group can see another's sessions, stats or bank accounts.

You do **not** need a second Discord application or a second bot process. The
existing bot is invited to the new server, and a registry entry tells it which
tracker that server belongs to.

## Why data isn't shared

The tracker has no per-guild scoping: one player list, one session history, one
stats page, one luck leaderboard, one set of bank accounts. So isolation is
physical — each group gets its own backend process and its own SQLite file. The
bot routes per server.

(The alternative, one multi-tenant database with `guildId` on every table and
every query scoped, is a large change with migration risk on a live DB — and one
missed scope leaks data between groups. Not worth it at this size.)

## How routing works

`GUILD_TRACKERS` on the bot maps each Discord server to its tracker:

```json
[
  {"guildId":"111...","apiBase":"https://poker.example.com/api","label":"Tribe A"},
  {"guildId":"222...","apiBase":"https://poker-b.example.com/api","label":"Tribe B"}
]
```

**This is deliberately operator-controlled and cannot be set from Discord.** If a
server owner could name their own tracker URL, any owner could point their guild
at another group's tracker and read it. A server that isn't listed resolves to no
tracker, and the bot ignores it.

With `GUILD_TRACKERS` unset the bot falls back to the single `TRACKER_API_BASE`
pair — the original single-server behaviour, unchanged.

## Adding a group

### 1. Backend + database (on the box)

```bash
mkdir -p /srv/poker-b
cp scripts/systemd/poker-backend-b.service /etc/systemd/system/tribe-poker-backend-b.service
$EDITOR /etc/systemd/system/tribe-poker-backend-b.service   # PORT, POKER_DB, CORS_ORIGINS, GUILD_ID
systemctl daemon-reload && systemctl enable --now tribe-poker-backend-b.service
```

`GUILD_ID` is that Discord server's id — one bot serves every server, so the
backend has to say which one it speaks for when it forwards a request.

### 2. nginx

The frontend calls `/api` **relative** to whatever host serves it, so there's no
separate build — just its own server block:

```nginx
server {
    server_name poker-b.example.com;
    client_max_body_size 20m;              # hand logs
    root /var/www/poker-tracker-b;         # its own copy of the built frontend
    location /api/ { proxy_pass http://127.0.0.1:5002; }
}
```

### 3. Register the server with the bot

Add the entry to `GUILD_TRACKERS` in the bot's env, then restart it:

```bash
$EDITOR /root/.openclaw/workspace/poker-tracker/bot/.env
systemctl restart tribe-poker-bot.service
```

Expect a startup line listing every tracker:
`Trackers: Tribe A→https://…/api, Tribe B→https://…/api.`

### 4. Invite the bot and hand over

Invite the **existing** bot to their server with `bot applications.commands`,
plus Manage Roles and Manage Threads. Then their own admin runs:

```
/setup channel:#poker-sessions poker_role:@Poker hot_role:@Running Hot cold_role:@Running Cold
```

Native channel and role pickers — no IDs, no Developer Mode, no access to your
box. `/setup` needs Manage Server; `/settings` shows the current config. Until a
channel is set that server's bot stays idle and says so in the logs.

## Deploying

CI deploys the first group only. `deploy.sh` takes overrides, so the others are
one extra command each (`SKIP_BUILD=1` reuses the build CI just made — every
group runs identical frontend code):

```bash
cd /root/.openclaw/workspace/poker-tracker
WEB_ROOT=/var/www/poker-tracker-b \
BACKEND_SERVICE=tribe-poker-backend-b.service \
SKIP_BUILD=1 \
  bash deploy.sh
```

The bot is shared, so CI's existing restart covers it for everyone.

## Backups

`scripts/backup-db.sh` honours `POKER_DB`, so each group gets its own timer with
`Environment=POKER_DB=/srv/poker-b/poker.db` and a distinct `POKER_BACKUP_DIR`.

## Checklist

- [ ] Backend service running with its own `PORT`, `POKER_DB`, `CORS_ORIGINS`, `GUILD_ID`
- [ ] nginx server block for the new hostname + TLS cert
- [ ] `GUILD_TRACKERS` entry added and bot restarted; startup log lists both trackers
- [ ] Existing bot invited to the new server (`applications.commands`, Manage Roles, Manage Threads)
- [ ] Their admin ran `/setup`, and `/settings` shows what they expect
- [ ] Backup timer for the new DB
- [ ] **Isolation check:** `curl -s localhost:5002/api/sessions` returns `[]` —
      an empty database, *not* the first group's sessions
