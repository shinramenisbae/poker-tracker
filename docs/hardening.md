# Hardening: backups and tests

Two robustness features that protect the tracker's data and the EV engine.
**Off-box backups are opt-in**; nothing here changes runtime behaviour, so
merging/deploying this is safe.

---

## 1. Database backups

`backend/poker.db` lives only on the VPS and is gitignored. It holds every
session, hand log, EV row, alias mapping and bank account. `scripts/backup-db.sh`
takes a consistent online snapshot (safe while the backend is writing),
gzips it, runs `PRAGMA integrity_check` on the result, and prunes copies older
than 30 days.

### Install the nightly timer (on the VPS, one time)

```bash
cd /root/.openclaw/workspace/poker-tracker
cp scripts/systemd/poker-backup.service /etc/systemd/system/
cp scripts/systemd/poker-backup.timer   /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now poker-backup.timer

# Verify
systemctl start poker-backup.service   # run once now
systemctl status poker-backup.service  # should show "verified"
ls -lh /root/poker-backups             # poker-YYYYMMDD-HHMMSS.db.gz
systemctl list-timers poker-backup.timer
```

### Off-box copies (recommended)

Local snapshots survive accidental `DELETE`s and corruption, but **not the VPS
itself dying**. To also push each snapshot off-box, install `rclone`, configure a
remote, then:

```bash
systemctl edit poker-backup.service
# add:
#   [Service]
#   Environment=POKER_BACKUP_RCLONE_REMOTE=gdrive:poker-backups
```

### Restore

```bash
gunzip -c /root/poker-backups/poker-YYYYMMDD-HHMMSS.db.gz > restored.db
sqlite3 restored.db 'PRAGMA integrity_check;'   # expect: ok
systemctl stop tribe-poker-backend.service
cp restored.db /root/.openclaw/workspace/poker-tracker/backend/poker.db
systemctl start tribe-poker-backend.service
```

---

## 2. Tests

The EV / equity / parser engine — the most complex, math-heavy code in the
repo — now has unit tests (`backend/handlog/*.test.js`), alongside the existing
bot tests. Both run in CI on every push and PR (`ci` job, before deploy).

```bash
cd backend && npm test   # parser + EV + equity + stats
cd bot && npm test        # bank / serialize / triage
```

Equity tests deliberately use deterministic scenarios (drawing-dead, exact
boards) plus one wide-tolerance Monte-Carlo sanity check, so they don't flake.
