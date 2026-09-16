#!/usr/bin/env bash
# Run SQL RLS tests.
#
# Default target: LOCAL Postgres cluster (.pgdata on /tmp:54329) — applies
# 0001_init.sql then runs rls.sql (which TRUNCATEs trainers/clients).
#
# --cloud: runs only the rollback-safe suites against the source-of-truth DB.
# Any test file containing TRUNCATE is refused there — rls.sql and
# screening_rls.sql wipe trainers/clients and must never touch cloud.
#   supabase/run-tests.sh --cloud        (reads SUPABASE_DB_URL from .env)
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
PSQL="${PSQL:-$(command -v psql || echo /Users/toby/anaconda3/envs/gymDays/bin/psql)}"

if [[ "${1:-}" == "--cloud" ]]; then
  if [[ -z "${SUPABASE_DB_URL:-}" && -f "$DIR/../.env" ]]; then
    SUPABASE_DB_URL=$(grep -E '^SUPABASE_DB_URL=' "$DIR/../.env" | cut -d= -f2- | sed "s/^['\"]//;s/['\"]\$//")
  fi
  if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
    echo "ERROR: SUPABASE_DB_URL not set."
    exit 1
  fi
  # Session mode (5432); the transaction pooler breaks SET ROLE / session GUCs.
  TARGET=("$PSQL" "$(echo "$SUPABASE_DB_URL" | sed 's#:6543/#:5432/#')")
  echo "→ target: cloud (rollback-safe suites only)"
  for f in "$DIR"/tests/*.sql; do
    if grep -qi '^\s*truncate' "$f"; then
      echo "→ SKIP $(basename "$f") (truncates tables — local only)"
      continue
    fi
    echo "→ running $(basename "$f")"
    "${TARGET[@]}" -v ON_ERROR_STOP=1 -f "$f"
  done
  exit 0
fi

TARGET=("$PSQL" -h "${PGHOST:-/tmp}" -p "${PGPORT:-54329}" -U "${PGUSER:-postgres}" -d "${PGDATABASE:-gymdays}")
echo "→ target: local ($(printf '%s ' "${TARGET[@]}"))"

echo "→ applying 0001_init.sql"
"${TARGET[@]}" -v ON_ERROR_STOP=1 -q -f "$DIR/migrations/0001_init.sql"

echo "→ running rls.sql"
"${TARGET[@]}" -v ON_ERROR_STOP=1 -f "$DIR/tests/rls.sql"
