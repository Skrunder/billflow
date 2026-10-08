#!/usr/bin/env sh
# ─────────────────────────────────────────────────────────────────────────────
# BillFlow — restore a database dump
#
# Usage:  ./scripts/restore.sh backups/billcalendar-20261007T120000Z.dump [appdata.tar.gz]
#
# What it does:
#   1. stops the frontend and backend (database keeps running)
#   2. drops and recreates the database, then restores the dump into it
#   3. optionally restores the backend data volume archive
#   4. starts everything again (pending migrations are applied automatically)
#
# THIS REPLACES ALL CURRENT DATA. Take a fresh backup first if unsure.
# ─────────────────────────────────────────────────────────────────────────────
set -eu

DUMP="${1:-}"
APPDATA="${2:-}"
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "Usage: $0 <billcalendar-*.dump> [appdata-*.tar.gz]" >&2
  exit 1
fi
DUMP="$(cd "$(dirname "$DUMP")" && pwd)/$(basename "$DUMP")"
[ -n "$APPDATA" ] && APPDATA="$(cd "$(dirname "$APPDATA")" && pwd)/$(basename "$APPDATA")"

cd "$(dirname "$0")/.."
# Read a single KEY=value from .env without executing it as shell code.
envval() {
  [ -f .env ] || return 0
  grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- | sed -e "s/^[\"']//" -e "s/[\"']\$//"
}

COMPOSE="${COMPOSE:-docker compose}"
DB_USER="${POSTGRES_USER:-$(envval POSTGRES_USER)}"
DB_USER="${DB_USER:-billcalendar}"
DB_NAME="${POSTGRES_DB:-$(envval POSTGRES_DB)}"
DB_NAME="${DB_NAME:-billcalendar}"

if [ "${FORCE:-}" != "1" ]; then
  printf "This will REPLACE all data in database '%s'. Type 'restore' to continue: " "$DB_NAME"
  read -r answer
  [ "$answer" = "restore" ] || { echo "Aborted."; exit 1; }
fi

echo "→ Stopping app containers…"
$COMPOSE stop frontend backend

echo "→ Ensuring the database container is running…"
$COMPOSE up -d db
until $COMPOSE exec -T db pg_isready -U "$DB_USER" -d postgres >/dev/null 2>&1; do sleep 2; done

echo "→ Recreating database '$DB_NAME'…"
$COMPOSE exec -T db psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();" \
  -c "DROP DATABASE IF EXISTS \"$DB_NAME\";" \
  -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\";"

echo "→ Restoring dump…"
$COMPOSE exec -T db pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner --role="$DB_USER" --exit-on-error < "$DUMP"

if [ -n "$APPDATA" ]; then
  echo "→ Restoring backend data volume…"
  $COMPOSE run --rm --no-deps -T --entrypoint sh backend -c 'find /app/data -mindepth 1 -delete && tar -C /app/data -xzf -' < "$APPDATA"
fi

echo "→ Starting the application…"
$COMPOSE up -d

echo "✓ Restore complete."
