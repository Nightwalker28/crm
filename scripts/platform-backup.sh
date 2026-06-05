#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_BACKUP_DIR="/var/backups/maad-crm"

COMMAND="${1:-help}"
shift || true

BACKUP_ROOT="${PLATFORM_BACKUP_DIR:-$DEFAULT_BACKUP_DIR}"
APP_ENVIRONMENT="${APP_ENVIRONMENT:-${ENVIRONMENT:-production}}"
APP_VERSION="${APP_VERSION:-}"
COMPRESSION="${PLATFORM_BACKUP_COMPRESSION:-gzip}"
INCLUDE_UPLOADS="${PLATFORM_BACKUP_INCLUDE_UPLOADS:-true}"
RETENTION_DAILY="${PLATFORM_BACKUP_RETENTION_DAILY:-7}"
RETENTION_WEEKLY="${PLATFORM_BACKUP_RETENTION_WEEKLY:-4}"
RETENTION_MONTHLY="${PLATFORM_BACKUP_RETENTION_MONTHLY:-3}"
PLATFORM_ROOT="$BACKUP_ROOT/platform"
HISTORY_FILE="$PLATFORM_ROOT/history.jsonl"

usage() {
  cat <<'USAGE'
Usage:
  scripts/platform-backup.sh create [manual|daily|weekly|monthly]
  scripts/platform-backup.sh list
  scripts/platform-backup.sh delete <backup_id> --confirm <backup_id>

Environment:
  PLATFORM_BACKUP_DIR=/var/backups/maad-crm
  PLATFORM_BACKUP_INCLUDE_UPLOADS=true
  PLATFORM_BACKUP_RETENTION_DAILY=7
  PLATFORM_BACKUP_RETENTION_WEEKLY=4
  PLATFORM_BACKUP_RETENTION_MONTHLY=3
  PLATFORM_BACKUP_COMPRESSION=gzip

Platform backups are operator-only artifacts. Do not expose this directory
through tenant APIs, tenant UI, public static files, or shared downloads.
USAGE
}

die() {
  echo "platform-backup: $*" >&2
  exit 1
}

env_truthy() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

utc_now() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

timestamp_id() {
  date -u +"%Y%m%d%H%M%S"
}

ensure_platform_dirs() {
  mkdir -p "$PLATFORM_ROOT/manual" "$PLATFORM_ROOT/daily" "$PLATFORM_ROOT/weekly" "$PLATFORM_ROOT/monthly"
  touch "$HISTORY_FILE"
}

compose_exec_backend() {
  docker compose exec -T backend "$@"
}

compose_backend_sh() {
  compose_exec_backend sh -lc "$1"
}

app_commit() {
  git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || true
}

database_name() {
  compose_backend_sh 'python3 - <<'"'"'PY'"'"'
import os
from urllib.parse import urlparse

url = os.environ.get("DATABASE_URL", "")
parsed = urlparse(url)
print((parsed.path or "").lstrip("/") or "unknown")
PY' 2>/dev/null || printf "unknown\n"
}

alembic_revision() {
  compose_backend_sh 'alembic current 2>/dev/null | head -n 1' 2>/dev/null || true
}

dir_size_bytes() {
  du -sb "$1" | awk '{print $1}'
}

write_metadata() {
  local path="$1"
  local status="$2"
  local category="$3"
  local backup_id="$4"
  local created_at="$5"
  local completed_at="$6"
  local size_bytes="$7"
  local error_message="$8"
  local included_components="$9"
  local included_paths="${10}"
  local db_checksum="${11}"

  BACKUP_PATH="$path" \
  STATUS="$status" \
  RETENTION_CATEGORY="$category" \
  BACKUP_ID="$backup_id" \
  CREATED_AT="$created_at" \
  COMPLETED_AT="$completed_at" \
  SIZE_BYTES="$size_bytes" \
  ERROR_MESSAGE="$error_message" \
  INCLUDED_COMPONENTS="$included_components" \
  INCLUDED_PATHS="$included_paths" \
  DB_CHECKSUM="$db_checksum" \
  APP_ENVIRONMENT="$APP_ENVIRONMENT" \
  APP_COMMIT="$(app_commit)" \
  APP_VERSION="$APP_VERSION" \
  ALEMBIC_REVISION="$(alembic_revision)" \
  DATABASE_NAME="$(database_name)" \
  COMPRESSION="$COMPRESSION" \
  python3 - <<'PY'
import json
import os
from pathlib import Path

backup_path = Path(os.environ["BACKUP_PATH"])
metadata = {
    "backup_id": os.environ["BACKUP_ID"],
    "backup_type": "platform",
    "tenant_scope": "none",
    "owner": "service_provider",
    "created_at": os.environ["CREATED_AT"],
    "completed_at": os.environ["COMPLETED_AT"] or None,
    "status": os.environ["STATUS"],
    "retention_category": os.environ["RETENTION_CATEGORY"],
    "app_environment": os.environ["APP_ENVIRONMENT"],
    "app_commit": os.environ["APP_COMMIT"] or None,
    "app_version": os.environ["APP_VERSION"] or None,
    "alembic_revision": os.environ["ALEMBIC_REVISION"] or None,
    "database_name": os.environ["DATABASE_NAME"],
    "included_components": [value for value in os.environ["INCLUDED_COMPONENTS"].split(",") if value],
    "included_paths": [value for value in os.environ["INCLUDED_PATHS"].split(",") if value],
    "included_tables": "all",
    "compression": os.environ["COMPRESSION"],
    "checksum": os.environ["DB_CHECKSUM"] or None,
    "size_bytes": int(os.environ["SIZE_BYTES"] or "0"),
    "error_message": os.environ["ERROR_MESSAGE"] or None,
    "backup_path": str(backup_path),
    "restore_notes": "Platform-level restore only. Not tenant-scoped.",
}
backup_path.mkdir(parents=True, exist_ok=True)
(backup_path / "metadata.json").write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n")
print(json.dumps(metadata, sort_keys=True))
PY
}

append_history() {
  local metadata_json="$1"
  mkdir -p "$PLATFORM_ROOT"
  printf '%s\n' "$metadata_json" >> "$HISTORY_FILE"
}

cleanup_retention() {
  local category="$1"
  local keep_count

  case "$category" in
    daily) keep_count="$RETENTION_DAILY" ;;
    weekly) keep_count="$RETENTION_WEEKLY" ;;
    monthly) keep_count="$RETENTION_MONTHLY" ;;
    manual) return 0 ;;
    *) die "invalid retention category: $category" ;;
  esac

  [[ "$keep_count" =~ ^[0-9]+$ ]] || die "retention for $category must be a number"
  local category_dir="$PLATFORM_ROOT/$category"
  mapfile -t backups < <(find "$category_dir" -mindepth 1 -maxdepth 1 -type d -name 'platform-*' | sort)
  local remove_count=$(( ${#backups[@]} - keep_count ))
  if (( remove_count <= 0 )); then
    return 0
  fi

  for old_path in "${backups[@]:0:$remove_count}"; do
    echo "Removing old $category platform backup: $(basename "$old_path")"
    rm -rf -- "$old_path"
  done
}

create_backup() {
  local category="${1:-manual}"
  case "$category" in
    manual|daily|weekly|monthly) ;;
    *) die "category must be manual, daily, weekly, or monthly" ;;
  esac

  if ! env_truthy "${PLATFORM_BACKUPS_ENABLED:-true}"; then
    die "PLATFORM_BACKUPS_ENABLED is not true"
  fi

  ensure_platform_dirs

  local created_at
  created_at="$(utc_now)"
  local backup_id="platform-${APP_ENVIRONMENT}-$(timestamp_id)"
  local backup_path="$PLATFORM_ROOT/$category/$backup_id"
  local metadata_json
  local included_components="postgresql"
  local included_paths=""
  local error_message=""
  local status="running"
  local trap_active=1

  on_create_error() {
    local exit_code="$1"
    if (( trap_active )); then
      trap_active=0
      error_message="backup failed with exit code $exit_code"
      metadata_json="$(write_metadata "$backup_path" "failed" "$category" "$backup_id" "$created_at" "$(utc_now)" "$(dir_size_bytes "$backup_path")" "$error_message" "$included_components" "$included_paths" "")"
      append_history "$metadata_json"
    fi
    exit "$exit_code"
  }

  mkdir -p "$backup_path"
  metadata_json="$(write_metadata "$backup_path" "$status" "$category" "$backup_id" "$created_at" "" "0" "" "$included_components" "$included_paths" "")"
  append_history "$metadata_json"
  trap 'on_create_error $?' ERR

  echo "Creating platform backup $backup_id in $backup_path"
  set +e
  compose_backend_sh 'pg_dump -Fc "$(python3 - <<'"'"'PY'"'"'
import os
from urllib.parse import urlparse, urlunparse

url = os.environ["DATABASE_URL"]
parsed = urlparse(url)
scheme = "postgresql" if parsed.scheme.startswith("postgresql+") else parsed.scheme
print(urlunparse((scheme, parsed.netloc, parsed.path, parsed.params, parsed.query, parsed.fragment)))
PY
)"' > "$backup_path/db.dump"
  local dump_status=$?
  set -e
  if (( dump_status != 0 )); then
    error_message="pg_dump failed with exit code $dump_status"
    trap_active=0
    metadata_json="$(write_metadata "$backup_path" "failed" "$category" "$backup_id" "$created_at" "$(utc_now)" "$(dir_size_bytes "$backup_path")" "$error_message" "$included_components" "$included_paths" "")"
    append_history "$metadata_json"
    die "$error_message"
  fi

  if env_truthy "$INCLUDE_UPLOADS" && [[ -d "$ROOT_DIR/backend/uploads" ]]; then
    tar -czf "$backup_path/uploads.tar.gz" -C "$ROOT_DIR/backend" uploads
    included_components="postgresql,uploads"
    included_paths="backend/uploads"
  fi

  (
    cd "$backup_path"
    checksum_files=(db.dump)
    if [[ -f uploads.tar.gz ]]; then
      checksum_files+=(uploads.tar.gz)
    fi
    sha256sum "${checksum_files[@]}" > checksums.txt
  )
  local db_checksum
  db_checksum="$(sha256sum "$backup_path/db.dump" | awk '{print $1}')"

  metadata_json="$(write_metadata "$backup_path" "completed" "$category" "$backup_id" "$created_at" "$(utc_now)" "$(dir_size_bytes "$backup_path")" "" "$included_components" "$included_paths" "$db_checksum")"
  append_history "$metadata_json"
  trap_active=0
  trap - ERR
  cleanup_retention "$category"

  echo "Created platform backup $backup_id"
  echo "$backup_path"
}

list_backups() {
  ensure_platform_dirs
  PLATFORM_ROOT="$PLATFORM_ROOT" python3 - <<'PY'
import json
import os
from pathlib import Path

root = Path(os.environ["PLATFORM_ROOT"])
rows = []
for metadata_path in root.glob("*/platform-*/metadata.json"):
    try:
        metadata = json.loads(metadata_path.read_text())
    except Exception as exc:
        metadata = {
            "backup_id": metadata_path.parent.name,
            "backup_type": "platform",
            "created_at": "",
            "status": "metadata_error",
            "size_bytes": 0,
            "included_components": [],
            "retention_category": metadata_path.parent.parent.name,
            "backup_path": str(metadata_path.parent),
            "checksum": None,
            "error_message": str(exc),
        }
    rows.append(metadata)

rows.sort(key=lambda item: item.get("created_at") or "", reverse=True)
print("backup_id\tbackup_type\tcreated_at\tstatus\tsize_bytes\tincluded\tcategory\tchecksum\tpath\terror")
for item in rows:
    print(
        "\t".join(
            [
                str(item.get("backup_id") or ""),
                str(item.get("backup_type") or "platform"),
                str(item.get("created_at") or ""),
                str(item.get("status") or ""),
                str(item.get("size_bytes") or 0),
                ",".join(item.get("included_components") or []),
                str(item.get("retention_category") or ""),
                str(item.get("checksum") or ""),
                str(item.get("backup_path") or ""),
                str(item.get("error_message") or ""),
            ]
        )
    )
PY
}

find_backup_path() {
  local backup_id="$1"
  [[ "$backup_id" =~ ^platform-[A-Za-z0-9._-]+-[0-9]{14}$ ]] || die "invalid backup id: $backup_id"
  find "$PLATFORM_ROOT" -mindepth 2 -maxdepth 2 -type d -name "$backup_id" -print -quit
}

delete_backup() {
  local backup_id="${1:-}"
  local confirm_flag="${2:-}"
  local confirm_value="${3:-}"
  [[ -n "$backup_id" ]] || die "delete requires a backup id"
  [[ "$confirm_flag" == "--confirm" && "$confirm_value" == "$backup_id" ]] || die "delete requires --confirm $backup_id"

  ensure_platform_dirs
  local backup_path
  backup_path="$(find_backup_path "$backup_id")"
  [[ -n "$backup_path" ]] || die "backup not found: $backup_id"

  local metadata_json
  metadata_json="$(BACKUP_ID="$backup_id" BACKUP_PATH="$backup_path" DELETED_AT="$(utc_now)" python3 - <<'PY'
import json
import os
from pathlib import Path

metadata_path = Path(os.environ["BACKUP_PATH"]) / "metadata.json"
metadata = json.loads(metadata_path.read_text()) if metadata_path.exists() else {}
metadata.update(
    {
        "backup_id": os.environ["BACKUP_ID"],
        "backup_type": "platform",
        "tenant_scope": "none",
        "owner": "service_provider",
        "status": "deleted",
        "deleted_at": os.environ["DELETED_AT"],
        "backup_path": os.environ["BACKUP_PATH"],
    }
)
print(json.dumps(metadata, sort_keys=True))
PY
)"
  rm -rf -- "$backup_path"
  append_history "$metadata_json"
  echo "Deleted platform backup $backup_id"
}

case "$COMMAND" in
  create) create_backup "${1:-manual}" ;;
  list) list_backups ;;
  delete) delete_backup "$@" ;;
  help|-h|--help) usage ;;
  *) usage; exit 1 ;;
esac
