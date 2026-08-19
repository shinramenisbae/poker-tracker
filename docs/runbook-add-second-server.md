# Runbook — add a second Discord server (box-side setup)

**Audience:** an agent or operator with shell access to the VPS, starting fresh
with no prior context. Everything needed is here.

**Goal:** let a *different* poker group use this bot, with their own sessions,
players, stats and bank accounts, and no access to the existing group's data.

**Shape:** ONE bot process serves every Discord server. Each server is mapped to
its own backend + SQLite database. Isolation is physical — separate databases,
not row filtering.

> **You do NOT need a second Discord application, bot token, or bot process.**
> Earlier versions did; the current code does not.

---

## Names used below

Replace these with the real values as you go.

| Placeholder | Meaning | Example |
|---|---|---|
| `<GUILD_A>` | existing group's Discord server id | `1511…` |
| `<GUILD_B>` | new group's Discord server id | `1520…` |
| `<HOST_B>` | new group's hostname | `poker-b.example.com` |

Existing (group A) values, for reference:
- repo: `/root/.openclaw/workspace/poker-tracker`
- backend: `tribe-poker-backend.service`, port **5001**, DB `backend/poker.db`
- bot: `tribe-poker-bot.service`, HTTP port **6300**
- web root: `/var/www/poker-tracker`, host `srv1346724.hstgr.cloud`

---

## Phase 0 — regression check (do this FIRST, before any changes)

The bot was recently refactored to support multiple servers. Group A now runs in
"legacy mode" and must behave exactly as before. Confirm that before adding
anything.

```bash
cd /root/.openclaw/workspace/poker-tracker
git fetch origin main && git log --oneline -1 origin/main   # expect 5e19565 or newer
systemctl is-active tribe-poker-backend.service tribe-poker-bot.service
journalctl -u tribe-poker-bot.service -n 40 --no-pager
```

Expected log lines (exact strings):
- `Tracker: single (https://srv1346724.hstgr.cloud/api).`
- `Registered /paid, /unpaid, /link, /setup and /settings slash commands.`
- `[default] Next payment reminder in N.Nh (10:00 Pacific/Auckland).`

Then, in group A's Discord:
- Run **`/settings`** — it should print the current channel/roles.
- Run **`/unpaid`** in an existing session thread (read-only).

### 🛑 STOP conditions

Do not proceed; report back instead.

| Symptom | Meaning |
|---|---|
| `/settings` replies `No guild context: a tracker call was made outside withGuild()` | An entry point was missed in the refactor. Bug, needs a code fix. |
| `No tracker configured. Set GUILD_TRACKERS, or TRACKER_API_BASE…` and the bot exits | Bot env lost `TRACKER_API_BASE`. |
| `Tracker registry misconfigured: …` and the bot exits | `GUILD_TRACKERS` is malformed. The message names the problem. |
| Bot not `active` / crash-looping | Check `journalctl -u tribe-poker-bot.service -n 100`. |

---

## Phase 1 — stand up group B's backend

Nothing here touches group A.

```bash
mkdir -p /srv/poker-b

cp /root/.openclaw/workspace/poker-tracker/scripts/systemd/poker-backend-b.service \
   /etc/systemd/system/tribe-poker-backend-b.service
$EDITOR /etc/systemd/system/tribe-poker-backend-b.service
```

Set in that unit:

```ini
Environment=PORT=5002
Environment=POKER_DB=/srv/poker-b/poker.db
Environment=CORS_ORIGINS=https://<HOST_B>
Environment=GUILD_ID=<GUILD_B>
Environment=SEED_ALIASES=0
```

`SEED_ALIASES=0` matters: `backend/aliases-seed.json` holds the *first* group's
roster — real names and the PokerNow nicknames they play under — and a fresh
database is seeded with it unless this is set. Group B would open their alias
screen to 45 strangers.

`GUILD_ID` matters: all backends call the same shared bot, so this is how the
bot knows which server a forwarded request belongs to.

```bash
systemctl daemon-reload
systemctl enable --now tribe-poker-backend-b.service
systemctl is-active tribe-poker-backend-b.service
curl -s localhost:5002/api/sessions          # expect: []
```

**`[]` is the isolation check.** If it returns group A's sessions, `POKER_DB`
didn't take effect — stop and fix before going further.

---

## Phase 2 — nginx + frontend for group B

The frontend calls `/api` *relative* to its host, so there is no separate build.

```bash
mkdir -p /var/www/poker-tracker-b
cd /root/.openclaw/workspace/poker-tracker
WEB_ROOT=/var/www/poker-tracker-b \
BACKEND_SERVICE=tribe-poker-backend-b.service \
SKIP_BUILD=1 \
  bash deploy.sh
```

nginx server block:

```nginx
server {
    server_name <HOST_B>;
    client_max_body_size 20m;          # hand logs; without this uploads 413
    root /var/www/poker-tracker-b;
    index index.html;
    location /api/ { proxy_pass http://127.0.0.1:5002; }
    location / { try_files $uri $uri/ /index.html; }   # SPA routing
}
```

```bash
nginx -t && systemctl reload nginx
# then add TLS, e.g.: certbot --nginx -d <HOST_B>
curl -s https://<HOST_B>/api/sessions   # expect: []
```

---

## Phase 3 — register group B with the bot

```bash
$EDITOR /root/.openclaw/workspace/poker-tracker/bot/.env
```

Add one line (single line, valid JSON — **both** servers must be listed, because
`GUILD_TRACKERS` replaces legacy mode entirely):

```
GUILD_TRACKERS=[{"guildId":"<GUILD_A>","apiBase":"https://srv1346724.hstgr.cloud/api","uiBase":"https://srv1346724.hstgr.cloud","label":"Tribe A"},{"guildId":"<GUILD_B>","apiBase":"https://<HOST_B>/api","uiBase":"https://<HOST_B>","label":"Tribe B"}]
```

⚠️ **Omitting group A here would leave the existing group unserved.** Legacy
mode applies only when `GUILD_TRACKERS` is unset.

Then add a second line naming which server the rest of `bot/.env` describes:

```
DISCORD_GUILD_ID=<GUILD_A>
```

And give **group A's backend** its guild id too — in legacy mode it never needed
one, but every backend calling a multi-server bot must say which guild it is,
and the first `/announce` from group A after this cutover otherwise fails with
`Bot returned 400 … guildId required`:

```bash
$EDITOR /etc/systemd/system/tribe-poker-backend.service   # add under [Service]:
# Environment=GUILD_ID=<GUILD_A>
systemctl daemon-reload && systemctl restart tribe-poker-backend.service
```

⚠️ **Required.** `DISCORD_CHANNEL_ID` and the role IDs in that file are group
A's. Without this line every guild inherits them, so group B — which hasn't run
`/setup` yet — watches *group A's channel* and scans it into group B's tracker.
The bot warns at startup if `GUILD_TRACKERS` names several servers and this is
unset.

Validate the JSON before restarting:
```bash
grep '^GUILD_TRACKERS=' bot/.env | cut -d= -f2- | python3 -m json.tool
systemctl restart tribe-poker-bot.service
journalctl -u tribe-poker-bot.service -n 30 --no-pager
```

Expect **both** trackers on one line:
`Trackers: Tribe A→https://srv1346724.hstgr.cloud/api, Tribe B→https://<HOST_B>/api.`

If you instead see `Tracker: single (…)`, the variable isn't being read — check
for a duplicate `GUILD_TRACKERS=` line later in the file.

---

## Phase 4 — invite the bot and hand over

Invite the **existing** bot (not a new app) to group B's server:

```
https://discord.com/api/oauth2/authorize?client_id=<DISCORD_APP_ID>&scope=bot+applications.commands&permissions=0
```
`<DISCORD_APP_ID>` is in `bot/.env`. In group B's server the bot's role needs
**Manage Roles** (streak roles) and **Manage Threads** (Fix & repost), and its
role must sit **above** any roles it assigns.

Then their own admin (needs **Manage Server**) runs, in their server:

```
/setup channel:#their-poker-channel poker_role:@Poker hot_role:@Running Hot cold_role:@Running Cold
```

All options are optional and use native pickers — no IDs to copy. Optional
extras: `reminder_hour:10 timezone:Pacific/Auckland chip_divisor:100`.
`/settings` shows the current config.

---

## Phase 5 — verify isolation (the part that matters)

```bash
# B is empty and independent
curl -s localhost:5002/api/sessions           # []
curl -s localhost:5002/api/bank-accounts      # {"accounts":{}}

# Player identities too — this is the check that used to be missing. Group A's
# roster reaching B is not visible in sessions or bank accounts.
curl -s localhost:5002/api/alias-mappings     # {"aliases":[], "canonicalPlayers":[]}

# A is untouched
curl -s localhost:5001/api/sessions | head -c 200      # A's real sessions
curl -s localhost:5001/api/bot-settings                # A's channel unchanged
```

In Discord:
- `/settings` in **A** → A's channel. `/settings` in **B** → B's channel.
- `/settings` in a server that is **not** in `GUILD_TRACKERS` → should reply
  *"This server isn't set up with a poker tracker yet"* and change nothing.
- Run a throwaway session end-to-end in B, then re-check A's session count is
  unchanged.

---

## Phase 6 — backups for group B

```bash
cp /root/.openclaw/workspace/poker-tracker/scripts/systemd/poker-backup.service \
   /etc/systemd/system/poker-backup-b.service
cp /root/.openclaw/workspace/poker-tracker/scripts/systemd/poker-backup.timer \
   /etc/systemd/system/poker-backup-b.timer
```
Add to `poker-backup-b.service` under `[Service]`:
```ini
Environment=POKER_DB=/srv/poker-b/poker.db
Environment=POKER_BACKUP_DIR=/root/poker-backups-b
```
```bash
systemctl daemon-reload
systemctl enable --now poker-backup-b.timer
systemctl start poker-backup-b.service
systemctl status poker-backup-b.service --no-pager   # expect "Backup OK ... verified"
```

---

## Ongoing: deploys

CI deploys group A and restarts the shared bot automatically. Group B's frontend
and backend need one extra command after each deploy:

```bash
cd /root/.openclaw/workspace/poker-tracker
WEB_ROOT=/var/www/poker-tracker-b \
BACKEND_SERVICE=tribe-poker-backend-b.service \
SKIP_BUILD=1 \
  bash deploy.sh
```

---

## Rollback

Nothing here migrates or mutates group A's data, so backing out is clean:

```bash
# 1. Return the bot to serving group A only
$EDITOR /root/.openclaw/workspace/poker-tracker/bot/.env    # comment out GUILD_TRACKERS
systemctl restart tribe-poker-bot.service
journalctl -u tribe-poker-bot.service -n 20 --no-pager      # expect "Tracker: single (…)"

# 2. Optionally stop group B
systemctl disable --now tribe-poker-backend-b.service poker-backup-b.timer
```
Group B's database at `/srv/poker-b/poker.db` is untouched by this and can be
re-enabled later.

---

## Reference

- `docs/second-instance.md` — architecture and rationale
- `docs/openclaw-runbook.md` — general VPS operations, deploy recovery
- `docs/paid-tracking.md` — `/paid`, `/unpaid`, `/link`, reminders
- `docs/hardening.md` — backups and restore
