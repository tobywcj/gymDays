#!/usr/bin/env bash
# Rebuild the README showcase assets in docs/media/.
#
#   npm run showcase                  # seed the demo roster, then capture
#   npm run showcase -- --no-clips    # screenshots only (no LLM calls)
#   npm run showcase -- --skip-seed --only=dashboard,knowledge
#
# Needs the web app on :3000 (SHOWCASE_BASE_URL to point elsewhere) and, for the
# agent clips, the AI service on :8001. Both read the root .env, which must set
# SEED_DEMO_PASSWORD (or SEED_TEST_PASSWORD) — the seed creates the showcase
# accounts with it and the capture signs in with it.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

set -a
# shellcheck disable=SC1091
[ -f .env ] && . ./.env
set +a

skip_seed=0
args=()
for a in "$@"; do
  case "$a" in
    --skip-seed) skip_seed=1 ;;
    *) args+=("$a") ;;
  esac
done

base="${SHOWCASE_BASE_URL:-http://localhost:3000}"
if ! curl -fsS -o /dev/null --max-time 10 "$base/login"; then
  echo "The web app is not answering at $base — start it with: cd web && npm run dev" >&2
  exit 1
fi

if [ "$skip_seed" -eq 0 ]; then
  echo "── seeding the demo roster ─────────────────────────────"
  (cd web && node scripts/seed-demo.mjs)
  echo
fi

echo "── capturing ───────────────────────────────────────────"
cd web && node scripts/capture-showcase.mjs ${args[@]+"${args[@]}"}
