#!/usr/bin/env bash
# Rebuilds the dTBM schema and loads demo data. DESTRUCTIVE: schema.sql drops the dtbm schema.
# Refuses to touch a non-local database unless ALLOW_RESET=1.
#   Local:   npm run db:reset
#   Hosted:  ALLOW_RESET=1 DATABASE_SSL=true DEMO_PASSWORD='choose-one' npm run db:deploy
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL first}"

host=$(printf '%s' "$DATABASE_URL" | sed -E 's#^[a-z]+://([^@]*@)?([^:/?]+).*#\2#')
case "$host" in
  localhost|127.0.0.1|::1|"[::1]") ;;
  *)
    if [ "${ALLOW_RESET:-}" != "1" ]; then
      echo "Refusing to reset '$host': this deletes all dTBM data there." >&2
      echo "If that is what you want, rerun with ALLOW_RESET=1." >&2
      exit 1
    fi ;;
esac

# Hosted Postgres needs TLS; psql reads this.
if [ "${DATABASE_SSL:-}" = "true" ]; then export PGSSLMODE=require; fi

cd "$(dirname "$0")/.."
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -v demo_password="${DEMO_PASSWORD:-demo1234}" \
  -f db/schema.sql -f db/seed.sql
echo "dTBM database ready on '$host'."
