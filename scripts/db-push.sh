#!/usr/bin/env bash
# `npm run db:push` entrypoint.
#
# Pushes pending migrations to the remote Supabase DB using SESSION mode
# (port 5432). Migrations require session mode — the transaction pooler (6543)
# rejects the prepared statements the migration tooling uses.
#
# The Supabase CLI can't read SUPABASE_DB_URL from .env on its own, so we load
# it here and pass it via --db-url. Extra args pass through, e.g.:
#   npm run db:push -- --dry-run
#   npm run db:push -- --include-all
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found." >&2
  exit 1
fi

DBURL=$(grep -E '^SUPABASE_DB_URL=' "$ENV_FILE" | cut -d= -f2- | sed "s/^['\"]//;s/['\"]\$//")
if [[ -z "${DBURL:-}" ]]; then
  echo "ERROR: SUPABASE_DB_URL not set in $ENV_FILE." >&2
  exit 1
fi

# Force session mode regardless of what's in .env (transaction pooler 6543 fails).
DBURL=$(echo "$DBURL" | sed 's#:6543/#:5432/#')

exec npx supabase db push --db-url "$DBURL" "$@"
