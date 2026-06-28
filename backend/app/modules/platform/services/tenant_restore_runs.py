from __future__ import annotations

import json
import zipfile
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import inspect as sqlalchemy_inspect
from sqlalchemy.orm import Session
from sqlalchemy.sql.sqltypes import Date, DateTime, Numeric

from app.modules.platform.models import TenantBackupRun, TenantRestoreRun
from app.modules.platform.services.activity_logs import safe_log_activity
from app.modules.platform.services.tenant_backup_runs import (
    RESTORE_COMPATIBILITY_VERSION,
    SUPPORTED_MODULE_EXPORTS,
    create_safety_tenant_backup_run,
    get_tenant_backup_artifact_path,
    get_tenant_backup_run_or_404,
)
from app.modules.user_management.models import Module, TenantModuleConfig


RESTORE_MODES = {"create_missing", "update_existing", "skip_duplicates", "replace_module_data"}
WHOLE_TENANT_RESTORE_MODE = "replace_tenant_data"
DESTRUCTIVE_RESTORE_MODES = {"replace_module_data"}
RESTORABLE_MODULES = set(SUPPORTED_MODULE_EXPORTS)
UNPROCESSABLE_STATUS = getattr(status, "HTTP_422_UNPROCESSABLE_CONTENT", 422)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _read_json(zipf: zipfile.ZipFile, name: str) -> Any:
    try:
        return json.loads(zipf.read(name))
    except KeyError as exc:
        raise HTTPException(status_code=UNPROCESSABLE_STATUS, detail=f"Backup archive is missing {name}.") from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=UNPROCESSABLE_STATUS, detail=f"Backup archive contains invalid JSON: {name}.") from exc


def _artifact_from_run(db: Session, *, tenant_id: int, source_backup_run_id: int) -> tuple[TenantBackupRun, Path]:
    run = get_tenant_backup_run_or_404(db, tenant_id=tenant_id, run_id=source_backup_run_id)
    return run, get_tenant_backup_artifact_path(run)


def _validate_metadata(metadata: dict[str, Any], *, tenant_id: int, module_key: str | None = None) -> None:
    if metadata.get("backup_type") != "tenant":
        raise HTTPException(status_code=UNPROCESSABLE_STATUS, detail="Only tenant backup artifacts can be restored.")
    if str(metadata.get("tenant_id")) != str(tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Backup artifact does not belong to this tenant.")
    if str(metadata.get("restore_compatibility_version")) != RESTORE_COMPATIBILITY_VERSION:
        raise HTTPException(status_code=UNPROCESSABLE_STATUS, detail="Backup artifact is not restore-compatible with this version.")
    if module_key and module_key not in (metadata.get("module_list") or []):
        raise HTTPException(status_code=UNPROCESSABLE_STATUS, detail="Selected module is not present in this backup artifact.")


def _validate_module_enabled(db: Session, *, tenant_id: int, module_key: str) -> None:
    exists = (
        db.query(Module.id)
        .join(TenantModuleConfig, TenantModuleConfig.module_id == Module.id)
        .filter(TenantModuleConfig.tenant_id == tenant_id, TenantModuleConfig.is_enabled == 1, Module.name == module_key)
        .first()
    )
    if not exists:
        raise HTTPException(status_code=UNPROCESSABLE_STATUS, detail="Selected module is not enabled for this tenant.")


def _module_payload(zipf: zipfile.ZipFile, *, tenant_id: int, module_key: str) -> tuple[dict[str, Any], list[dict[str, Any]], Any]:
    if module_key not in RESTORABLE_MODULES:
        raise HTTPException(status_code=UNPROCESSABLE_STATUS, detail="Restore is not supported for this module yet.")
    filename, model = SUPPORTED_MODULE_EXPORTS[module_key]
    metadata = _read_json(zipf, "metadata.json")
    if not isinstance(metadata, dict):
        raise HTTPException(status_code=UNPROCESSABLE_STATUS, detail="Backup metadata is invalid.")
    _validate_metadata(metadata, tenant_id=tenant_id, module_key=module_key)
    rows = _read_json(zipf, f"modules/{filename}")
    if not isinstance(rows, list):
        raise HTTPException(status_code=UNPROCESSABLE_STATUS, detail="Module backup payload is invalid.")
    if any(not isinstance(row, dict) for row in rows):
        raise HTTPException(status_code=UNPROCESSABLE_STATUS, detail="Module backup rows are invalid.")
    if any(str(row.get("tenant_id")) != str(tenant_id) for row in rows):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Backup module payload contains rows from another tenant.")
    return metadata, rows, model


def _backup_metadata(zipf: zipfile.ZipFile, *, tenant_id: int) -> dict[str, Any]:
    metadata = _read_json(zipf, "metadata.json")
    if not isinstance(metadata, dict):
        raise HTTPException(status_code=UNPROCESSABLE_STATUS, detail="Backup metadata is invalid.")
    _validate_metadata(metadata, tenant_id=tenant_id)
    return metadata


def _primary_key_name(model: Any) -> str:
    primary_keys = [column.key for column in sqlalchemy_inspect(model).primary_key]
    if len(primary_keys) != 1:
        raise HTTPException(status_code=UNPROCESSABLE_STATUS, detail="Restore is not supported for this module primary key shape.")
    return primary_keys[0]


def _restore_summary(db: Session, *, tenant_id: int, model: Any, rows: list[dict[str, Any]]) -> dict[str, Any]:
    pk_name = _primary_key_name(model)
    incoming_ids = [row.get(pk_name) for row in rows if row.get(pk_name) is not None]
    existing_count = 0
    if incoming_ids:
        existing_count = (
            db.query(model)
            .filter(model.tenant_id == tenant_id, getattr(model, pk_name).in_(incoming_ids))
            .count()
        )
    return {
        "total_rows": len(rows),
        "existing_matches": existing_count,
        "missing_rows": max(len(incoming_ids) - existing_count, 0),
        "invalid_rows": len(rows) - len(incoming_ids),
        "primary_key": pk_name,
    }


def _coerce_column_value(column: Any, value: Any) -> Any:
    if value is None:
        return None
    if isinstance(column.type, DateTime) and isinstance(value, str):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    if isinstance(column.type, Date) and not isinstance(column.type, DateTime) and isinstance(value, str):
        return date.fromisoformat(value)
    if isinstance(column.type, Numeric) and not isinstance(value, Decimal):
        return Decimal(str(value))
    return value


def _assign_row_values(instance: Any, row: dict[str, Any], *, tenant_id: int) -> None:
    mapper = sqlalchemy_inspect(instance.__class__)
    for column in mapper.columns:
        if getattr(column, "computed", None) is not None:
            continue
        key = column.key
        if key == "tenant_id":
            setattr(instance, key, tenant_id)
            continue
        if key in row:
            setattr(instance, key, _coerce_column_value(column, row[key]))


def _apply_restore_rows(
    db: Session,
    *,
    tenant_id: int,
    model: Any,
    rows: list[dict[str, Any]],
    mode: str,
) -> dict[str, int]:
    pk_name = _primary_key_name(model)
    pk_column = getattr(model, pk_name)
    created = 0
    updated = 0
    skipped = 0
    soft_deleted = 0
    incoming_ids: set[Any] = set()

    if mode == "replace_module_data" and hasattr(model, "deleted_at"):
        incoming_ids = {row.get(pk_name) for row in rows if row.get(pk_name) is not None}
        stale_rows = db.query(model).filter(model.tenant_id == tenant_id, ~pk_column.in_(incoming_ids)).all()
        now = _utc_now()
        for stale in stale_rows:
            if getattr(stale, "deleted_at", None) is None:
                stale.deleted_at = now
                soft_deleted += 1

    for row in rows:
        pk_value = row.get(pk_name)
        if pk_value is None:
            skipped += 1
            continue
        existing = db.query(model).filter(model.tenant_id == tenant_id, pk_column == pk_value).first()
        if existing:
            if mode in {"update_existing", "replace_module_data"}:
                _assign_row_values(existing, row, tenant_id=tenant_id)
                updated += 1
            else:
                skipped += 1
            continue
        if mode in {"create_missing", "skip_duplicates", "replace_module_data"}:
            instance = model()
            _assign_row_values(instance, row, tenant_id=tenant_id)
            db.add(instance)
            created += 1
        else:
            skipped += 1

    return {"created": created, "updated": updated, "skipped": skipped, "soft_deleted": soft_deleted}


def _serialize_restore_run(run: TenantRestoreRun) -> dict[str, Any]:
    return {
        "id": run.id,
        "tenant_id": run.tenant_id,
        "actor_user_id": run.actor_user_id,
        "source_backup_run_id": run.source_backup_run_id,
        "restore_type": run.restore_type,
        "module_key": run.module_key,
        "mode": run.mode,
        "status": run.status,
        "summary": run.summary or {},
        "error_message": run.error_message,
        "started_at": run.started_at,
        "completed_at": run.completed_at,
        "created_at": run.created_at,
        "updated_at": run.updated_at,
    }


def _safe_metadata(metadata: dict[str, Any]) -> dict[str, Any]:
    return {
        "backup_type": metadata.get("backup_type"),
        "tenant_id": metadata.get("tenant_id"),
        "created_at": metadata.get("created_at"),
        "export_version": metadata.get("export_version"),
        "restore_compatibility_version": metadata.get("restore_compatibility_version"),
        "module_list": metadata.get("module_list") or [],
        "record_counts": metadata.get("record_counts") or {},
    }


def preview_tenant_module_restore(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int,
    source_backup_run_id: int,
    module_key: str,
) -> dict[str, Any]:
    _validate_module_enabled(db, tenant_id=tenant_id, module_key=module_key)
    source_run, artifact_path = _artifact_from_run(db, tenant_id=tenant_id, source_backup_run_id=source_backup_run_id)
    with zipfile.ZipFile(artifact_path) as zipf:
        metadata, rows, model = _module_payload(zipf, tenant_id=tenant_id, module_key=module_key)
    summary = _restore_summary(db, tenant_id=tenant_id, model=model, rows=rows)
    run = TenantRestoreRun(
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        source_backup_run_id=source_run.id,
        restore_type="tenant_module",
        module_key=module_key,
        mode="preview_only",
        status="previewed",
        summary=summary,
        completed_at=_utc_now(),
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    safe_log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key="tenant_backups",
        entity_type="tenant_restore_run",
        entity_id=run.id,
        action="restore.previewed",
        description=f"Previewed restore for {module_key}",
        after_state=_serialize_restore_run(run),
    )
    return {"run": run, "metadata": _safe_metadata(metadata), "summary": summary}


def execute_tenant_module_restore(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int,
    source_backup_run_id: int,
    module_key: str,
    mode: str,
    confirmation: str | None = None,
) -> TenantRestoreRun:
    if mode not in RESTORE_MODES:
        raise HTTPException(status_code=UNPROCESSABLE_STATUS, detail="Unsupported restore mode.")
    if mode in DESTRUCTIVE_RESTORE_MODES and confirmation != f"REPLACE {module_key}":
        raise HTTPException(status_code=UNPROCESSABLE_STATUS, detail=f"Type REPLACE {module_key} to confirm destructive restore.")
    _validate_module_enabled(db, tenant_id=tenant_id, module_key=module_key)
    source_run, artifact_path = _artifact_from_run(db, tenant_id=tenant_id, source_backup_run_id=source_backup_run_id)

    run = TenantRestoreRun(
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        source_backup_run_id=source_run.id,
        restore_type="tenant_module",
        module_key=module_key,
        mode=mode,
        status="running",
        summary={},
        started_at=_utc_now(),
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    safe_log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key="tenant_backups",
        entity_type="tenant_restore_run",
        entity_id=run.id,
        action="restore.started",
        description=f"Started restore for {module_key}",
        after_state=_serialize_restore_run(run),
    )

    try:
        with zipfile.ZipFile(artifact_path) as zipf:
            _metadata, rows, model = _module_payload(zipf, tenant_id=tenant_id, module_key=module_key)
        preview_summary = _restore_summary(db, tenant_id=tenant_id, model=model, rows=rows)
        with db.begin_nested():
            result = _apply_restore_rows(db, tenant_id=tenant_id, model=model, rows=rows, mode=mode)
            db.flush()
        summary = {**preview_summary, **result}
        run.status = "completed"
        run.summary = summary
        run.completed_at = _utc_now()
        run.error_message = None
        db.commit()
        db.refresh(run)
        safe_log_activity(
            db,
            tenant_id=tenant_id,
            actor_user_id=actor_user_id,
            module_key="tenant_backups",
            entity_type="tenant_restore_run",
            entity_id=run.id,
            action="restore.completed",
            description=f"Completed restore for {module_key}",
            after_state=_serialize_restore_run(run),
        )
        return run
    except Exception as exc:
        db.rollback()
        run = db.query(TenantRestoreRun).filter(TenantRestoreRun.id == run.id, TenantRestoreRun.tenant_id == tenant_id).first() or run
        run.status = "failed"
        run.error_message = str(exc)[:1000]
        run.completed_at = _utc_now()
        db.add(run)
        db.commit()
        db.refresh(run)
        safe_log_activity(
            db,
            tenant_id=tenant_id,
            actor_user_id=actor_user_id,
            module_key="tenant_backups",
            entity_type="tenant_restore_run",
            entity_id=run.id,
            action="restore.failed",
            description=f"Failed restore for {module_key}",
            after_state=_serialize_restore_run(run),
        )
        return run


def preview_whole_tenant_restore(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int,
    source_backup_run_id: int,
) -> dict[str, Any]:
    source_run, artifact_path = _artifact_from_run(db, tenant_id=tenant_id, source_backup_run_id=source_backup_run_id)
    if source_run.scope != "full_tenant":
        raise HTTPException(status_code=UNPROCESSABLE_STATUS, detail="Whole-tenant restore requires a full-tenant backup.")
    module_summaries: dict[str, Any] = {}
    total_rows = 0
    with zipfile.ZipFile(artifact_path) as zipf:
        metadata = _backup_metadata(zipf, tenant_id=tenant_id)
        for module_key in metadata.get("module_list") or []:
            if module_key not in RESTORABLE_MODULES:
                continue
            _validate_module_enabled(db, tenant_id=tenant_id, module_key=module_key)
            _module_metadata, rows, model = _module_payload(zipf, tenant_id=tenant_id, module_key=module_key)
            summary = _restore_summary(db, tenant_id=tenant_id, model=model, rows=rows)
            module_summaries[module_key] = summary
            total_rows += int(summary["total_rows"])
    summary = {"total_modules": len(module_summaries), "total_rows": total_rows, "modules": module_summaries}
    run = TenantRestoreRun(
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        source_backup_run_id=source_run.id,
        restore_type="tenant_whole",
        module_key="*",
        mode="preview_only",
        status="previewed",
        summary=summary,
        completed_at=_utc_now(),
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    safe_log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key="tenant_backups",
        entity_type="tenant_restore_run",
        entity_id=run.id,
        action="restore.previewed",
        description="Previewed whole-tenant restore",
        after_state=_serialize_restore_run(run),
    )
    return {"run": run, "metadata": _safe_metadata(metadata), "summary": summary}


def execute_whole_tenant_restore(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int,
    source_backup_run_id: int,
    confirmation: str | None = None,
) -> TenantRestoreRun:
    required_confirmation = f"RESTORE TENANT {tenant_id}"
    if confirmation != required_confirmation:
        raise HTTPException(status_code=UNPROCESSABLE_STATUS, detail=f"Type {required_confirmation} to confirm whole-tenant restore.")
    source_run, artifact_path = _artifact_from_run(db, tenant_id=tenant_id, source_backup_run_id=source_backup_run_id)
    if source_run.scope != "full_tenant":
        raise HTTPException(status_code=UNPROCESSABLE_STATUS, detail="Whole-tenant restore requires a full-tenant backup.")
    with zipfile.ZipFile(artifact_path) as zipf:
        metadata = _backup_metadata(zipf, tenant_id=tenant_id)

    safety_run = create_safety_tenant_backup_run(db, tenant_id=tenant_id, actor_user_id=actor_user_id)
    run = TenantRestoreRun(
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        source_backup_run_id=source_run.id,
        restore_type="tenant_whole",
        module_key="*",
        mode=WHOLE_TENANT_RESTORE_MODE,
        status="running",
        summary={"safety_backup_run_id": safety_run.id},
        started_at=_utc_now(),
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    safe_log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key="tenant_backups",
        entity_type="tenant_restore_run",
        entity_id=run.id,
        action="restore.started",
        description="Started whole-tenant restore",
        after_state=_serialize_restore_run(run),
    )

    try:
        module_summaries: dict[str, Any] = {}
        total_rows = 0
        total_created = 0
        total_updated = 0
        total_skipped = 0
        total_soft_deleted = 0
        with zipfile.ZipFile(artifact_path) as zipf:
            for module_key in metadata.get("module_list") or []:
                if module_key not in RESTORABLE_MODULES:
                    continue
                _validate_module_enabled(db, tenant_id=tenant_id, module_key=module_key)
                _module_metadata, rows, model = _module_payload(zipf, tenant_id=tenant_id, module_key=module_key)
                preview_summary = _restore_summary(db, tenant_id=tenant_id, model=model, rows=rows)
                with db.begin_nested():
                    result = _apply_restore_rows(db, tenant_id=tenant_id, model=model, rows=rows, mode="replace_module_data")
                    db.flush()
                module_summary = {**preview_summary, **result}
                module_summaries[module_key] = module_summary
                total_rows += int(preview_summary["total_rows"])
                total_created += int(result["created"])
                total_updated += int(result["updated"])
                total_skipped += int(result["skipped"])
                total_soft_deleted += int(result["soft_deleted"])
        run.status = "completed"
        run.summary = {
            "safety_backup_run_id": safety_run.id,
            "source_backup_run_id": source_run.id,
            "total_modules": len(module_summaries),
            "total_rows": total_rows,
            "created": total_created,
            "updated": total_updated,
            "skipped": total_skipped,
            "soft_deleted": total_soft_deleted,
            "modules": module_summaries,
        }
        run.completed_at = _utc_now()
        run.error_message = None
        db.commit()
        db.refresh(run)
        safe_log_activity(
            db,
            tenant_id=tenant_id,
            actor_user_id=actor_user_id,
            module_key="tenant_backups",
            entity_type="tenant_restore_run",
            entity_id=run.id,
            action="restore.completed",
            description="Completed whole-tenant restore",
            after_state=_serialize_restore_run(run),
        )
        return run
    except Exception as exc:
        db.rollback()
        run = db.query(TenantRestoreRun).filter(TenantRestoreRun.id == run.id, TenantRestoreRun.tenant_id == tenant_id).first() or run
        run.status = "failed"
        run.error_message = str(exc)[:1000]
        run.completed_at = _utc_now()
        run.summary = {**(run.summary or {}), "safety_backup_run_id": safety_run.id}
        db.add(run)
        db.commit()
        db.refresh(run)
        safe_log_activity(
            db,
            tenant_id=tenant_id,
            actor_user_id=actor_user_id,
            module_key="tenant_backups",
            entity_type="tenant_restore_run",
            entity_id=run.id,
            action="restore.failed",
            description="Failed whole-tenant restore",
            after_state=_serialize_restore_run(run),
        )
        return run
