#!/usr/bin/env bash
# Browser tests against the production build (`next start`) instead of the dev server.
#
# The dev server compiles every route on first visit and grows until it is OOM-killed on
# long walks; a production server serves pre-built pages, so the same specs run several
# times faster and the full design walk fits in memory. See "Browser tests" in AGENTS.md.
#
#   scripts/e2e.sh inventory-phase2.spec.ts                       # specs, one worker
#   scripts/e2e.sh --routes /dashboard/inventory,/dashboard/settings/recycle-bin \
#       design-rules.spec.ts scroll-containers.spec.ts            # guards, scoped to a slice
#   scripts/e2e.sh --rebuild ...                                   # force a fresh build
#   scripts/e2e.sh                                                 # every spec (release)
#
# --routes sets E2E_ROUTES: the route guards then walk only routes equal to or under those
# prefixes (canary and global checks still run). Without it they walk every route.
#
# The CPU ceiling holds: the dev server is stopped while `frontend-serve` runs in its place
# with the same cap, and is started again afterwards. Playwright always runs one worker.
set -euo pipefail
cd "$(dirname "$0")/.."

ROUTES=""
REBUILD=0
ARGS=()
while (($#)); do
  case "$1" in
    --routes) ROUTES="${2:?--routes needs a comma-separated list}"; shift 2 ;;
    --routes=*) ROUTES="${1#--routes=}"; shift ;;
    --rebuild) REBUILD=1; shift ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done

# These specs drive the test-only /e2e/* harness routes, which proxy.ts blocks in production.
HARNESS_SPECS="contract-transport.spec.ts record-layout-runtime.spec.ts quick-create-surface.spec.ts"
SPECS=()
OPTIONS=()
# Playwright options that take a separate value (`--grep "Lead journey"`).
VALUE_OPTIONS=" --grep -g --grep-invert --timeout --project --retries --repeat-each --reporter --max-failures "
take_value=0
for arg in "${ARGS[@]+"${ARGS[@]}"}"; do
  if ((take_value)); then OPTIONS+=("$arg"); take_value=0; continue; fi
  if [[ "$arg" == -* ]]; then
    OPTIONS+=("$arg")
    [[ "$VALUE_OPTIONS" == *" $arg "* ]] && take_value=1
    continue
  fi
  if [[ " $HARNESS_SPECS " == *" $(basename "$arg") "* ]]; then
    echo "$arg drives /e2e/* harness routes, which only the dev server serves. Run it with:" >&2
    echo "  docker compose run --rm frontend-e2e npm run test:e2e -- $arg --workers=1" >&2
    exit 2
  fi
  SPECS+=("$arg")
done
if ((${#SPECS[@]} == 0)); then
  for path in frontend/tests/e2e/*.spec.ts; do
    name="$(basename "$path")"
    [[ " $HARNESS_SPECS " == *" $name "* ]] || SPECS+=("$name")
  done
  echo "No spec named: running all ${#SPECS[@]} specs except the dev-only harness specs."
fi
for option in "${OPTIONS[@]+"${OPTIONS[@]}"}"; do
  [[ "$option" == --workers* || "$option" == -j* ]] && { echo "Workers are fixed at 1 (CPU ceiling)." >&2; exit 2; }
done

echo "== Host load =="
uptime
free -h | sed -n '1,2p'
load="$(cut -d' ' -f1 /proc/loadavg)"
cores="$(nproc)"
if awk -v l="$load" -v c="$cores" 'BEGIN { exit !(l > c * 0.65) }'; then
  echo "Load $load is above 65% of $cores cores; not adding a browser run. Wait and retry." >&2
  exit 3
fi

dev_was_running=0
[[ -n "$(docker compose ps --status running -q frontend 2>/dev/null)" ]] && dev_was_running=1

RUN_NAME="crm-e2e-sh-$$"
cleanup() {
  docker rm -f "$RUN_NAME" >/dev/null 2>&1 || true
  docker compose --profile e2e stop frontend-serve >/dev/null 2>&1 || true
  docker compose --profile e2e rm -f frontend-serve >/dev/null 2>&1 || true
  if ((dev_was_running)); then
    echo "== Restarting the dev server =="
    docker compose start frontend >/dev/null
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# The dev server is stopped first: it holds ~2-3 GB and two CPUs, and the build and the
# production server need both.
if ((dev_was_running)); then
  echo "== Stopping the dev server for the run =="
  docker compose stop frontend >/dev/null
fi

# A production build is reused while no source is newer than it. `codex-check.sh` leaves
# one behind, so a check followed by this script does not build twice.
build_id="frontend/.next/BUILD_ID"
stale=""
if [[ ! -f "$build_id" ]]; then
  stale="no production build"
else
  newer="$(find frontend/app frontend/components frontend/hooks frontend/lib frontend/contracts \
    frontend/types frontend/public frontend/proxy.ts frontend/next.config.ts frontend/package.json \
    frontend/package-lock.json -newer "$build_id" -type f -print -quit 2>/dev/null || true)"
  [[ -n "$newer" ]] && stale="$newer is newer than the build"
fi
if ((REBUILD)) || [[ -n "$stale" ]]; then
  echo "== Building (${stale:-forced}) =="
  docker compose --profile e2e run --rm --no-deps frontend-serve npm run build
fi

if ss -ltn 2>/dev/null | grep -q ':3000 '; then
  echo "Port 3000 is still taken after stopping the dev server; not starting the production server." >&2
  exit 4
fi
echo "== Starting the production server on :3000 =="
docker compose --profile e2e up -d --no-deps frontend-serve >/dev/null
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' http://localhost:3000/auth/login || true)"
  [[ "$code" =~ ^[23] ]] && break
  sleep 2
done
[[ "$code" =~ ^[23] ]] || { echo "The production server did not answer on :3000." >&2; docker compose --profile e2e logs --tail 40 frontend-serve >&2; exit 4; }

echo "== Playwright: ${SPECS[*]}${ROUTES:+ (routes: $ROUTES)} =="
docker compose run --rm --no-deps --name "$RUN_NAME" \
  -e PLAYWRIGHT_BASE_URL=http://localhost:3000 \
  -e E2E_ROUTES="$ROUTES" \
  frontend-e2e npm run test:e2e -- "${SPECS[@]}" "${OPTIONS[@]+"${OPTIONS[@]}"}" --workers=1
