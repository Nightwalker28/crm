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
#   scripts/e2e.sh --keep-db ...                                   # keep the test database
#   scripts/e2e.sh --shared-db ...                                 # old way: the dev database
#   scripts/e2e.sh                                                 # every spec (release)
#
# --routes sets E2E_ROUTES: the route guards then walk only routes equal to or under those
# prefixes (canary and global checks still run). Without it they walk every route.
#
# Each run gets its own database (13a H29): `lynk_e2e_<time>` is created on the DATABASE_URL
# server, migrated, given the bootstrap tenant and admin plus the demo data, and served by
# `backend-e2e` and `worker-e2e` (Redis DB 1, own uploads volume). It is dropped afterwards
# unless --keep-db. Nothing a spec creates reaches the dev database.
#
# The CPU ceiling holds: the dev server, backend and worker are stopped while the e2e
# services run in their place with the same caps, and are started again afterwards.
# Playwright always runs one worker.
set -euo pipefail
cd "$(dirname "$0")/.."

ROUTES=""
REBUILD=0
SHARED_DB=0
KEEP_DB=0
ARGS=()
while (($#)); do
  case "$1" in
    --routes) ROUTES="${2:?--routes needs a comma-separated list}"; shift 2 ;;
    --routes=*) ROUTES="${1#--routes=}"; shift ;;
    --rebuild) REBUILD=1; shift ;;
    --shared-db) SHARED_DB=1; shift ;;
    --keep-db) KEEP_DB=1; shift ;;
    -h|--help) sed -n '2,29p' "$0"; exit 0 ;;
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

is_running() { [[ -n "$(docker compose ps --status running -q "$1" 2>/dev/null)" ]]; }

dev_was_running=0
is_running frontend && dev_was_running=1
# The dev backend and worker the e2e pair replaces (disposable-database runs only).
stopped_services=()

export LYNK_E2E_DATABASE=""
E2E_BACKEND_PORT="${LYNK_E2E_BACKEND_PORT:-8043}"
export LYNK_E2E_BACKEND_PORT="$E2E_BACKEND_PORT"

RUN_NAME="crm-e2e-sh-$$"
cleanup() {
  docker rm -f "$RUN_NAME" >/dev/null 2>&1 || true
  docker compose --profile e2e stop frontend-serve >/dev/null 2>&1 || true
  docker compose --profile e2e rm -f frontend-serve >/dev/null 2>&1 || true
  if [[ -n "$LYNK_E2E_DATABASE" ]]; then
    docker compose --profile e2e stop backend-e2e worker-e2e >/dev/null 2>&1 || true
    docker compose --profile e2e rm -f backend-e2e worker-e2e >/dev/null 2>&1 || true
    docker volume rm -f "$(basename "$PWD")_e2e_uploads" >/dev/null 2>&1 || true
    docker compose exec -T redis redis-cli -n 1 FLUSHDB >/dev/null 2>&1 || true
    if ((KEEP_DB)); then
      echo "== Kept $LYNK_E2E_DATABASE (drop it: docker compose run --rm --no-deps -T backend python -m scripts.provision_database drop $LYNK_E2E_DATABASE) =="
    else
      echo "== Dropping $LYNK_E2E_DATABASE =="
      docker compose run --rm --no-deps -T backend python -m scripts.provision_database drop "$LYNK_E2E_DATABASE" >/dev/null 2>&1 \
        || echo "Could not drop $LYNK_E2E_DATABASE; drop it with scripts.provision_database." >&2
    fi
  fi
  for service in "${stopped_services[@]+"${stopped_services[@]}"}"; do
    echo "== Restarting $service =="
    docker compose start "$service" >/dev/null || true
  done
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

if ((SHARED_DB)); then
  echo "== Shared dev database (--shared-db): specs write into it =="
else
  LYNK_E2E_DATABASE="lynk_e2e_$(date -u +%Y%m%d%H%M%S)_$$"
  if ss -ltn 2>/dev/null | grep -q ":$E2E_BACKEND_PORT "; then
    echo "Port $E2E_BACKEND_PORT is taken; set LYNK_E2E_BACKEND_PORT to a free one." >&2
    LYNK_E2E_DATABASE=""
    exit 4
  fi
  for service in backend celery-worker; do
    if is_running "$service"; then
      docker compose stop "$service" >/dev/null
      stopped_services+=("$service")
    fi
  done
  is_running redis || docker compose up -d --no-deps redis >/dev/null
  echo "== Creating the test database $LYNK_E2E_DATABASE (migrate, bootstrap, demo data) =="
  docker compose run --rm --no-deps -T backend python -m scripts.provision_database create "$LYNK_E2E_DATABASE" --seed demo
  docker compose --profile e2e up -d --no-deps backend-e2e worker-e2e >/dev/null
  for _ in $(seq 1 60); do
    code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://localhost:$E2E_BACKEND_PORT/health" || true)"
    [[ "$code" == 200 ]] && break
    sleep 2
  done
  [[ "$code" == 200 ]] || { echo "backend-e2e did not answer on :$E2E_BACKEND_PORT." >&2; docker compose --profile e2e logs --tail 40 backend-e2e >&2; exit 4; }
  export LYNK_E2E_API_BASE_URL="http://localhost:$E2E_BACKEND_PORT/api/v1"
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
