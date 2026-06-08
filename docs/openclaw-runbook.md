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
- `Registered /paid and /unpaid slash commands.`
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

## 7. Deploy recovery — when the GitHub auto-deploy fails

The GitHub Actions "Deploy to VPS" step SSHes into the box. If a run shows
**CI passed but Deploy failed** with something like
`dial tcp 76.13.182.206:22: i/o timeout`, the merged code is on `main` but was
never copied onto the VPS. Two parts: deploy it now (locally), then fix SSH so
future merges auto-deploy.

### 7a. Deploy the latest code now (no SSH-from-GitHub needed)

```bash
cd /root/.openclaw/workspace/poker-tracker
git fetch origin main
git checkout main
git pull --ff-only
git log --oneline -1            # confirm this matches the latest commit on GitHub
bash deploy.sh                  # builds frontend, restarts backend
# deploy.sh does NOT restart the bot; if bot/ changed, restart it:
systemctl restart tribe-poker-bot.service
systemctl is-active tribe-poker-backend.service tribe-poker-bot.service
```

Verify the newest feature is actually live (PR #11 — `/paid ... user:` linking):
```bash
grep -c "addUserOption" bot/index.js     # expect >= 1
grep -c "getUser('user')" bot/index.js   # expect >= 1
journalctl -u tribe-poker-bot.service -n 20 --no-pager
```

### 7b. Fix SSH so auto-deploy works again

The timeout means the runner couldn't reach port 22. On the VPS:

```bash
systemctl is-active ssh                 # sshd running?
ss -tlnp | grep ':22'                   # listening on 22?
ufw status verbose                      # is 22/tcp allowed? (firewall is the #1 suspect
                                        #  if it broke right after on-box changes)
```

If `ufw` is blocking inbound SSH, re-allow it:
```bash
ufw allow 22/tcp
ufw reload
```

Also confirm the host/IP still matches the GitHub secret `VPS_HOST`
(`76.13.182.206`) and that the provider firewall/security group (Hostinger panel)
allows inbound 22. Once SSH is reachable again, re-run the failed deploy from the
GitHub Actions page (Re-run jobs) or just push a new commit.

> Tip: a quick external reachability check from any other machine —
> `nc -vz 76.13.182.206 22` (or `ssh -v`). A timeout = blocked before reaching
> sshd (firewall); "connection refused" = reached the host but sshd isn't
> listening.

---

## Daily usage reference (for players)

- In a session results thread, run `/paid` once you've sent your money.
  - First time: `/paid player:<your name>` so the bot links you. After that,
    bare `/paid` works.
  - The bank player can mark anyone: `/paid player:<name>`.
- Every day at 10am NZ time the bot pings anyone who still owes a bank transfer,
  one message per session thread, until everyone's marked paid.
