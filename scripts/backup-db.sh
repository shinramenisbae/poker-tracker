#!/usr/bin/env bash
#
# Nightly SQLite backup for the poker tracker.
#
# Why this exists: backend/poker.db lives only on the VPS and is gitignored.
# It holds every session, hand log, EV row, alias mapping and bank account —
# years of imported history. A dead disk or a fat-fingered DELETE wipes all of
# it with no recovery. This takes a consistent snapshot, compresses it, verifies
# it, and prunes old copies.
#
# Uses sqlite3's online `.backup`, which is safe to run while the backend is
# actively writing (unlike `cp`, which can capture a torn file mid-write).
#
# Install as a systemd timer (see scripts/systemd/) or a cron entry:
#   0 4 * * *  /root/.openclaw/workspace/poker-tracker/scripts/backup-db.sh >> /var/log/poker-backup.log 2>&1
#
# Env overrides:
#   POKER_DB                  path to the live DB   (default: repo backend/poker.db)
#   POKER_BACKUP_DIR          where snapshots land  (default: /root/poker-backups)
#   POKER_BACKUP_RETENTION_DAYS  prune older than N days (default: 30)
#   POKER_BACKUP_RCLONE_REMOTE   if set, `rclone copy` the snapshot off-box too
#                                (e.g. "gdrive:poker-backups") — this is what
#                                actually protects against full disk loss.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB="${POKER_DB:-$SCRIPT_DIR/../backend/poker.db}"
DEST="${POKER_BACKUP_DIR:-/root/poker-backups}"
RETENTION_DAYS="${POKER_BACKUP_RETENTION_DAYS:-30}"

if [ ! -f "$DB" ]; then
  echo "ERROR: database not found at $DB" >&2
  exit 1
fi

mkdir -p "$DEST"
stamp="$(date +%Y%m%d-%H%M%S)"
snapshot="$DEST/poker-$stamp.db"

# Consistent online snapshot, then compress.
sqlite3 "$DB" ".backup '$snapshot'"
gzip -f "$snapshot"
archive="$snapshot.gz"

# Verify the snapshot is a healthy DB before we trust it (decompress to a temp
# file and run integrity_check). A backup that doesn't restore is worse than
# none because it hides the problem.
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
gunzip -c "$archive" > "$tmp"
if [ "$(sqlite3 "$tmp" 'PRAGMA integrity_check;')" != "ok" ]; then
  echo "ERROR: integrity check FAILED for $archive — leaving it for inspection" >&2
  exit 1
fi

# Optional off-box copy. Local snapshots survive accidental deletes/corruption;
# only an off-box copy survives the VPS itself dying.
if [ -n "${POKER_BACKUP_RCLONE_REMOTE:-}" ]; then
  if command -v rclone >/dev/null 2>&1; then
    rclone copy "$archive" "$POKER_BACKUP_RCLONE_REMOTE" && echo "Copied off-box to $POKER_BACKUP_RCLONE_REMOTE"
  else
    echo "WARN: POKER_BACKUP_RCLONE_REMOTE set but rclone not installed; skipping off-box copy" >&2
  fi
fi

# Prune old local snapshots.
find "$DEST" -maxdepth 1 -name 'poker-*.db.gz' -mtime "+$RETENTION_DAYS" -delete

echo "Backup OK: $archive ($(du -h "$archive" | cut -f1)) — verified, retention ${RETENTION_DAYS}d"
