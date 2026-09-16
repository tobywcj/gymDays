#!/usr/bin/env bash
# Apply 0001_init.sql + run RLS tests.
#
# Default target: LOCAL Postgres cluster (.pgdata on /tmp:54329).
# To run against the CLOUD DB instead:
#   source env.sh && set -a && source .env && set +a
#   supabase/run-tests.sh --cloud
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ "${1:-}" == "--cloud" ]]; then
  if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
    echo "ERROR: SUPABASE_DB_URL not set. Source .env first."
    exit 1
  fi
  TARGET=(psql "$SUPABASE_DB_URL")
  echo "→ target: cloud ($SUPABASE_DB_URL)"
else
  TARGET=(psql -h "${PGHOST:-/tmp}" -p "${PGPORT:-54329}" -U "${PGUSER:-postgres}" -d "${PGDATABASE:-gymdays}")
  echo "→ target: local ($(printf '%s ' "${TARGET[@]}"))"
fi

echo "→ applying 0001_init.sql"
"${TARGET[@]}" -v ON_ERROR_STOP=1 -q -f "$DIR/migrations/0001_init.sql"

echo "→ running rls.sql"
"${TARGET[@]}" -v ON_ERROR_STOP=1 -f "$DIR/tests/rls.sql"
