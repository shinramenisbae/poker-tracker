# OpenClaw runbook — VPS setup steps

One-time / occasional operator steps that can't be done from CI (they touch the
VPS, Discord, or nginx). Run these on the box at
`/root/.openclaw/workspace/poker-tracker`. Always wait for the latest deploy to
finish first (it pulls merged PRs and restarts the services).

---

## 0. Confirm latest code is deployed

```bash
cd /root/.openclaw/workspace/poker-tracker
git fetch origin main && git log --oneline -1 origin/main
systemctl is-active tribe-poker-backend.service tribe-poker-bot.service
```

---

## 1. Bot env vars (`bot/.env`)

Get two IDs from Discord (Developer Mode on → right-click → Copy ID):
- **Poker role ID** — the role to ping on results posts.
- **Application ID** — Discord Developer Portal → your app → Application ID.

```bash
cd /root/.openclaw/workspace/poker-tracker/bot
cat >> .env <<'EOF'
DISCORD_POKER_ROLE_ID=<role id>
DISCORD_APP_ID=<application id>
PAYMENT_REMINDER_HOUR=10
PAYMENT_REMINDER_TZ=Pacific/Auckland
EOF
```

(If a key already exists in `.env`, edit it instead of appending a duplicate.)

---

## 2. Discord `applications.commands` scope

Required for the `/paid` slash command to register. If the bot was invited
bot-only, re-invite it with the scope (this does not remove it):

```
https://discord.com/api/oauth2/authorize?client_id=<APP_ID>&scope=bot+applications.commands&permissions=0
```

Also ensure the bot can mention the Poker role: either the role's
"Allow anyone to @mention this role" is on, or the bot has the
"Mention @everyone, @here, and All Roles" permission.

---

## 3. Restart the bot and verify

```bash
systemctl restart tribe-poker-bot.service
journalctl -u tribe-poker-bot.service -n 30 --no-pager
```

Expect log lines:
- `Registered /paid slash command.`
- `Next payment reminder in N.Nh (10:00 Pacific/Auckland).`

Global slash commands can take a few minutes to first appear in Discord.

---

## 4. Repost the most recent session (clean + cash split + role ping)

```bash
# newest session is first in the list:
curl -sS http://127.0.0.1:5001/api/sessions | head -c 1500
# then, with that id:
curl -sS -X POST "http://127.0.0.1:6300/repost/<sessionId>?clean=true"
```

Expect: `{"ok":true,"threadId":"...","reposted":true,"cleaned":1}`.
`?clean=true` deletes the bot's prior results post(s) first, so no duplicate.

---

## 5. Database backups (one-time install)

```bash
cd /root/.openclaw/workspace/poker-tracker
cp scripts/systemd/poker-backup.service /etc/systemd/system/
cp scripts/systemd/poker-backup.timer   /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now poker-backup.timer
systemctl start poker-backup.service        # run one now
systemctl status poker-backup.service --no-pager   # expect "Backup OK ... verified"
ls -lh /root/poker-backups
```

Off-box copies (recommended): see `docs/hardening.md`.

---

## 6. nginx upload limit (for >1MB hand logs)

Already applied if large hand-log uploads no longer 413. If not, see
`docs/ops-nginx-upload-limit.md` — add `client_max_body_size 20m;` to the
server block, then `nginx -t && systemctl reload nginx`.

---

## Daily usage reference (for players)

- In a session results thread, run `/paid` once you've sent your money.
  - First time: `/paid player:<your name>` so the bot links you. After that,
    bare `/paid` works.
  - The bank player can mark anyone: `/paid player:<name>`.
- Every day at 10am NZ time the bot pings anyone who still owes a bank transfer,
  one message per session thread, until everyone's marked paid.
