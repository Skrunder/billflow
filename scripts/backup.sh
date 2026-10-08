#!/usr/bin/env sh
# ─────────────────────────────────────────────────────────────────────────────
# BillFlow — on-demand backup
#
# Creates, in ./backups (or $BACKUP_PATH):
#   billcalendar-<timestamp>.dump      PostgreSQL custom-format dump (all data)
#   appdata-<timestamp>.tar.gz         app data volume (generated secrets, uploads)
#
# Usage:  ./scripts/backup.sh            (run from the project directory)
# Safe to run while the app is running (pg_dump takes a consistent snapshot).
# ─────────────────────────────────────────────────────────────────────────────
set -eu

cd "$(dirname "$0")/.."
# Read a single KEY=value from .env without executing it as shell code.
envval() {
  [ -f .env ] || return 0
  grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- | sed -e "s/^[\"']//" -e "s/[\"']\$//"
}

COMPOSE="${COMPOSE:-docker compose}"
OUT="${BACKUP_PATH:-$(envval BACKUP_PATH)}"
OUT="${OUT:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DB_USER="${POSTGRES_USER:-$(envval POSTGRES_USER)}"
DB_USER="${DB_USER:-billcalendar}"
DB_NAME="${POSTGRES_DB:-$(envval POSTGRES_DB)}"
DB_NAME="${DB_NAME:-billcalendar}"

mkdir -p "$OUT"

echo "→ Dumping database '$DB_NAME'…"
$COMPOSE exec -T db pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom > "$OUT/billcalendar-$STAMP.dump.partial"
mv "$OUT/billcalendar-$STAMP.dump.partial" "$OUT/billcalendar-$STAMP.dump"
echo "  $OUT/billcalendar-$STAMP.dump ($(du -h "$OUT/billcalendar-$STAMP.dump" | cut -f1))"

echo "→ Archiving app data volume…"
$COMPOSE exec -T app tar -C /app/data -czf - . > "$OUT/appdata-$STAMP.tar.gz"
echo "  $OUT/appdata-$STAMP.tar.gz"

echo "✓ Backup complete. Copy $OUT somewhere off this machine (NAS share, cloud, USB)."
