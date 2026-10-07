#!/bin/sh
# Backend container entrypoint:
#   1. derive DATABASE_URL from POSTGRES_* variables when not given explicitly
#   2. apply pending database migrations (safe to run on every start)
#   3. exec the API server
set -eu

log() { echo "[entrypoint] $*"; }

if [ -z "${DATABASE_URL:-}" ]; then
  DATABASE_URL="$(node dist/scripts/database-url.js)"
  export DATABASE_URL
fi

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  log "applying database migrations"
  # Prisma lives in the (hoisted) workspace node_modules; resolve it like Node does.
  PRISMA_CLI="$(node -p "require.resolve('prisma/build/index.js')")"
  attempt=1
  until node "$PRISMA_CLI" migrate deploy; do
    if [ "$attempt" -ge 10 ]; then
      log "migrations failed after $attempt attempts — giving up"
      exit 1
    fi
    log "migration attempt $attempt failed (database may still be starting); retrying in 5s"
    attempt=$((attempt + 1))
    sleep 5
  done
  log "database schema is up to date"
else
  log "RUN_MIGRATIONS=false — skipping migrations"
fi

exec "$@"
