#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_BACKUP_DIR="/var/backups/maad-crm"
BACKUP_ROOT="${PLATFORM_BACKUP_DIR:-$DEFAULT_BACKUP_DIR}"
PLATFORM_ROOT="$BACKUP_ROOT/platform"
RESTORE_ROOT="$PLATFORM_ROOT/restores"
SOURCE="${1:-}"
CONFIRM_FLAG="${2:-}"
CONFIRM_VALUE="${3:-}"

usage() {
  cat <<'USAGE'
Usage:
  scripts/platform-restore.sh <backup_id_or_db_dump_path> --confirm-restore <backup_id_or_restore>

The restore script is operator-only. It creates a fresh safety platform backup
before replacing the database, stops app containers, restores with pg_restore,
checks Alembic state, starts the app containers, and runs a health check.
USAGE
}

die() {
  echo "platform-restore: $*" >&2
  exit 1
}

utc_now() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

timestamp_id() {
  date -u +"%Y%m%d%H%M%S"
}

compose_exec_backend() {
  docker compose exec -T backend "$@"
}

compose_backend_sh() {
  compose_exec_backend sh -lc "$1"
}

wait_for_backend_health() {
  for _attempt in {1..60}; do
    if compose_backend_sh 'python3 - <<'"'"'PY'"'"'
import json
import urllib.request

with urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=5) as response:
    print(json.dumps(json.loads(response.read().decode()), sort_keys=True))
PY' >/tmp/platform-restore-health.out 2>/dev/null; then
      cat /tmp/platform-restore-health.out
      rm -f /tmp/platform-restore-health.out
      return 0
    fi
    sleep 2
  done
  rm -f /tmp/platform-restore-health.out
  return 1
}

resolve_dump_path() {
  local source="$1"
  if [[ "$source" =~ ^platform-[A-Za-z0-9._-]+-[0-9]{14}$ ]]; then
    local match
    match="$(find "$PLATFORM_ROOT" -mindepth 2 -maxdepth 2 -type d -name "$source" -print -quit)"
    [[ -n "$match" ]] || die "backup id not found: $source"
    printf '%s/db.dump\n' "$match"
    return 0
  fi

  local resolved
  resolved="$(realpath "$source")"
  [[ "$resolved" == "$PLATFORM_ROOT"/* ]] || die "restore path must be inside $PLATFORM_ROOT"
  [[ "$(basename "$resolved")" == "db.dump" ]] || die "restore path must point to a db.dump file"
  printf '%s\n' "$resolved"
}

source_backup_id() {
  local dump_path="$1"
  local metadata_path
  metadata_path="$(dirname "$dump_path")/metadata.json"
  if [[ -f "$metadata_path" ]]; then
    python3 - "$metadata_path" <<'PY'
import json
import sys
print(json.loads(open(sys.argv[1]).read()).get("backup_id", "unknown"))
PY
  else
    printf "unknown\n"
  fi
}

write_restore_metadata() {
  local restore_id="$1"
  local source_id="$2"
  local source_path="$3"
  local started_at="$4"
  local completed_at="$5"
  local status="$6"
  local safety_backup_id="$7"
  local error_message="$8"
  mkdir -p "$RESTORE_ROOT"
  RESTORE_ID="$restore_id" \
  SOURCE_BACKUP_ID="$source_id" \
  SOURCE_PATH="$source_path" \
  STARTED_AT="$started_at" \
  COMPLETED_AT="$completed_at" \
  STATUS="$status" \
  SAFETY_BACKUP_ID="$safety_backup_id" \
  ERROR_MESSAGE="$error_message" \
  RESTORE_ROOT="$RESTORE_ROOT" \
  python3 - <<'PY'
import json
import os
from pathlib import Path

metadata = {
    "restore_id": os.environ["RESTORE_ID"],
    "restore_type": "platform",
    "source_backup_id": os.environ["SOURCE_BACKUP_ID"],
    "source_path": os.environ["SOURCE_PATH"],
    "started_at": os.environ["STARTED_AT"],
    "completed_at": os.environ["COMPLETED_AT"] or None,
    "status": os.environ["STATUS"],
    "event_name": {
        "running": "platform_restore.started",
        "completed": "platform_restore.completed",
        "failed": "platform_restore.failed",
    }.get(os.environ["STATUS"]),
    "safety_backup_id": os.environ["SAFETY_BACKUP_ID"] or None,
    "operator": "service_provider",
    "error_message": os.environ["ERROR_MESSAGE"] or None,
    "notes": "Database rollback restore",
}
restore_path = Path(os.environ["RESTORE_ROOT"]) / f'{metadata["restore_id"]}.json'
restore_path.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n")
print(json.dumps(metadata, sort_keys=True))
PY
}

if [[ "$SOURCE" == "-h" || "$SOURCE" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -z "$SOURCE" ]]; then
  usage
  exit 1
fi

DUMP_PATH="$(resolve_dump_path "$SOURCE")"
[[ -f "$DUMP_PATH" ]] || die "dump file not found: $DUMP_PATH"

SOURCE_ID="$(source_backup_id "$DUMP_PATH")"
EXPECTED_CONFIRM="$SOURCE_ID"
if [[ "$EXPECTED_CONFIRM" == "unknown" ]]; then
  EXPECTED_CONFIRM="restore"
fi
[[ "$CONFIRM_FLAG" == "--confirm-restore" && "$CONFIRM_VALUE" == "$EXPECTED_CONFIRM" ]] || die "restore requires --confirm-restore $EXPECTED_CONFIRM"

RESTORE_ID="platform-restore-$(timestamp_id)"
STARTED_AT="$(utc_now)"
SAFETY_BACKUP_ID=""
write_restore_metadata "$RESTORE_ID" "$SOURCE_ID" "$DUMP_PATH" "$STARTED_AT" "" "running" "" ""
RESTORE_TRAP_ACTIVE=1

on_restore_error() {
  local exit_code="$1"
  if (( RESTORE_TRAP_ACTIVE )); then
    RESTORE_TRAP_ACTIVE=0
    write_restore_metadata "$RESTORE_ID" "$SOURCE_ID" "$DUMP_PATH" "$STARTED_AT" "$(utc_now)" "failed" "$SAFETY_BACKUP_ID" "restore failed with exit code $exit_code" >/dev/null || true
  fi
  exit "$exit_code"
}

trap 'on_restore_error $?' ERR

echo "Creating safety backup before platform restore"
SAFETY_OUTPUT="$("$ROOT_DIR/scripts/platform-backup.sh" create manual)"
SAFETY_BACKUP_ID="$(printf '%s\n' "$SAFETY_OUTPUT" | grep -E '^Created platform backup ' | awk '{print $4}' | tail -n 1)"
[[ -n "$SAFETY_BACKUP_ID" ]] || die "safety backup did not return a backup id"

echo "Stopping app containers before restore"
docker compose stop backend celery-worker celery-beat frontend

set +e
cat "$DUMP_PATH" | docker compose run --rm -T --no-deps backend sh -lc '
set -eu
python3 - <<'"'"'PY'"'"' > /tmp/restore_db.env
import os
import shlex
from urllib.parse import urlparse

url = os.environ["DATABASE_URL"]
parsed = urlparse(url)
values = {
    "PGHOST": parsed.hostname or "localhost",
    "PGPORT": str(parsed.port or 5432),
    "PGUSER": parsed.username or "",
    "PGPASSWORD": parsed.password or "",
    "PGDATABASE": parsed.path.lstrip("/"),
}
for key, value in values.items():
    print(f"{key}={shlex.quote(value)}")
PY
. /tmp/restore_db.env
export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE
psql --dbname postgres --set=restore_db="$PGDATABASE" --command "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = :'restore_db' AND pid <> pg_backend_pid();" >/dev/null
dropdb --if-exists "$PGDATABASE"
createdb "$PGDATABASE"
pg_restore --clean --if-exists --no-owner --no-privileges --dbname "$PGDATABASE"
'
RESTORE_STATUS=$?
set -e

if (( RESTORE_STATUS != 0 )); then
  RESTORE_TRAP_ACTIVE=0
  write_restore_metadata "$RESTORE_ID" "$SOURCE_ID" "$DUMP_PATH" "$STARTED_AT" "$(utc_now)" "failed" "$SAFETY_BACKUP_ID" "pg_restore failed with exit code $RESTORE_STATUS" >/dev/null
  echo "Restore failed. Starting app containers so the operator can inspect/recover." >&2
  docker compose start backend celery-worker celery-beat frontend >/dev/null || true
  exit "$RESTORE_STATUS"
fi

echo "Starting app containers after restore"
docker compose start backend celery-worker celery-beat frontend

echo "Checking Alembic migration state"
compose_backend_sh 'alembic current'

echo "Checking backend health"
wait_for_backend_health

RESTORE_TRAP_ACTIVE=0
trap - ERR
write_restore_metadata "$RESTORE_ID" "$SOURCE_ID" "$DUMP_PATH" "$STARTED_AT" "$(utc_now)" "completed" "$SAFETY_BACKUP_ID" "" >/dev/null
echo "Completed platform restore $RESTORE_ID from $SOURCE_ID"
