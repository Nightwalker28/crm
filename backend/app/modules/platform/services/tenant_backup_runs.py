from __future__ import annotations

import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy import inspect as sqlalchemy_inspect
from sqlalchemy.orm import Session

from app.core.pagination import Pagination
from app.core.uploads import UPLOADS_DIR
from app.modules.contracts.models import Contract
from app.modules.documents.models import Document, DocumentLink, DocumentVersion
from app.modules.documents.services.storage_backends import LocalDocumentStorage
from app.modules.documents.services.document_services import (
    DOCUMENT_PROVIDER_GOOGLE_DRIVE,
    DOCUMENT_PROVIDER_MICROSOFT_ONEDRIVE,
    upload_document_storage_artifact,
)
from app.modules.platform.models import TenantBackupRun, TenantBackupSettings
from app.modules.platform.services.activity_logs import safe_log_activity
from app.modules.platform.services.tenant_backup_settings import (
    _next_run_at,
    get_or_create_tenant_backup_settings,
)
from app.modules.sales.models import (
    SalesContact,
    SalesLead,
    SalesOpportunity,
    SalesOrder,
    SalesOrderItem,
    SalesOrganization,
    SalesQuote,
)
from app.modules.support.models import SupportCase
from app.modules.tasks.models import Task
from app.modules.user_management.models import Tenant, TenantModuleConfig, Module


TENANT_BACKUP_UPLOAD_DIR = UPLOADS_DIR / "tenant-backups"
TENANT_BACKUP_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

BACKUP_EXPORT_VERSION = "1"
RESTORE_COMPATIBILITY_VERSION = "1"
DESTINATION_PROVIDERS = {
    "google_drive": DOCUMENT_PROVIDER_GOOGLE_DRIVE,
    "onedrive": DOCUMENT_PROVIDER_MICROSOFT_ONEDRIVE,
}

SUPPORTED_MODULE_EXPORTS: dict[str, tuple[str, Any]] = {
    "sales_leads": ("sales_leads.json", SalesLead),
    "sales_contacts": ("sales_contacts.json", SalesContact),
    "sales_organizations": ("sales_organizations.json", SalesOrganization),
    "sales_opportunities": ("sales_opportunities.json", SalesOpportunity),
    "sales_quotes": ("sales_quotes.json", SalesQuote),
    "sales_orders": ("sales_orders.json", SalesOrder),
    "tasks": ("tasks.json", Task),
    "documents": ("documents.json", Document),
    "support_cases": ("support_cases.json", SupportCase),
    "contracts": ("contracts.json", Contract),
}

MODULE_CHILD_EXPORTS: dict[str, list[tuple[str, Any]]] = {
    "sales_orders": [("sales_order_items.json", SalesOrderItem)],
    "documents": [("document_versions.json", DocumentVersion), ("document_links.json", DocumentLink)],
}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _enabled_tenant_modules(db: Session, *, tenant_id: int) -> list[str]:
    rows = (
        db.query(Module.name)
        .join(TenantModuleConfig, TenantModuleConfig.module_id == Module.id)
        .filter(TenantModuleConfig.tenant_id == tenant_id, TenantModuleConfig.is_enabled == 1)
        .order_by(Module.name.asc())
        .all()
    )
    return [row.name for row in rows]


def _included_modules(db: Session, *, tenant_id: int, settings: TenantBackupSettings) -> list[str]:
    if settings.scope == "selected_modules":
        candidates = list(settings.selected_modules or [])
        unsupported = [module_key for module_key in candidates if module_key not in SUPPORTED_MODULE_EXPORTS]
        if unsupported:
            raise HTTPException(status_code=422, detail=f"Tenant backup export is not yet supported for module: {unsupported[0]}")
    else:
        candidates = _enabled_tenant_modules(db, tenant_id=tenant_id)
    return [module_key for module_key in candidates if module_key in SUPPORTED_MODULE_EXPORTS]


def _row_to_dict(row: Any) -> dict[str, Any]:
    data: dict[str, Any] = {}
    mapper = sqlalchemy_inspect(row.__class__)
    for column in mapper.columns:
        if getattr(column, "computed", None) is not None:
            continue
        data[column.key] = getattr(row, column.key)
    return jsonable_encoder(data)


def _export_model_rows(db: Session, *, tenant_id: int, model: Any) -> list[dict[str, Any]]:
    primary_keys = [column.key for column in sqlalchemy_inspect(model).primary_key]
    query = db.query(model).filter(model.tenant_id == tenant_id)
    for key in primary_keys:
        query = query.order_by(getattr(model, key).asc())
    return [_row_to_dict(row) for row in query.all()]


def _write_json(zipf: zipfile.ZipFile, name: str, payload: Any) -> None:
    zipf.writestr(name, json.dumps(jsonable_encoder(payload), indent=2, sort_keys=True) + "\n")


def _safe_document_zip_name(path: Path) -> str:
    return path.name.replace("/", "_").replace("\\", "_")


def _add_local_document_files(zipf: zipfile.ZipFile, *, db: Session, tenant_id: int) -> int:
    documents = (
        db.query(Document)
        .filter(Document.tenant_id == tenant_id, Document.storage_provider == "local", Document.deleted_at.is_(None))
        .order_by(Document.id.asc())
        .all()
    )
    added = 0
    storage = LocalDocumentStorage()
    for document in documents:
        try:
            path = storage.resolve_path(document.storage_path)
        except HTTPException:
            continue
        zipf.write(path, f"documents/files/{document.id}/{_safe_document_zip_name(path)}")
        added += 1
    return added


def _artifact_path(*, tenant_id: int, run_id: int) -> Path:
    directory = TENANT_BACKUP_UPLOAD_DIR / f"tenant-{tenant_id}" / str(run_id)
    directory.mkdir(parents=True, exist_ok=True)
    return directory / f"tenant-{tenant_id}-backup-{run_id}.zip"


def _delete_artifact(path_value: str | None) -> bool:
    if not path_value:
        return False
    path = Path(path_value).resolve()
    allowed_root = TENANT_BACKUP_UPLOAD_DIR.resolve()
    if allowed_root != path and allowed_root not in path.parents:
        return False
    try:
        if path.exists():
            path.unlink()
        parent = path.parent
        while parent != allowed_root and parent.exists():
            try:
                parent.rmdir()
            except OSError:
                break
            parent = parent.parent
        return True
    except OSError:
        return False


def _cleanup_retention(db: Session, *, tenant_id: int, retention_count: int) -> int:
    keep = max(int(retention_count), 1)
    old_runs = (
        db.query(TenantBackupRun.id, TenantBackupRun.file_path)
        .filter(
            TenantBackupRun.tenant_id == tenant_id,
            TenantBackupRun.backup_type == "tenant",
            TenantBackupRun.status == "completed",
            TenantBackupRun.file_path.isnot(None),
        )
        .order_by(TenantBackupRun.completed_at.desc(), TenantBackupRun.id.desc())
        .offset(keep)
        .all()
    )
    cleaned = 0
    for run in old_runs:
        if _delete_artifact(run.file_path):
            cleaned += 1
        (
            db.query(TenantBackupRun)
            .filter(TenantBackupRun.id == run.id, TenantBackupRun.tenant_id == tenant_id)
            .update(
                {
                    TenantBackupRun.file_path: None,
                    TenantBackupRun.storage_ref: None,
                    TenantBackupRun.destination_upload_status: "expired",
                },
                synchronize_session=False,
            )
        )
    if old_runs:
        db.commit()
    return cleaned


def _upload_destination_artifact(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int,
    destination: str,
    artifact_path: Path,
) -> dict[str, str] | None:
    provider = DESTINATION_PROVIDERS.get(destination)
    if not provider:
        return None
    return upload_document_storage_artifact(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        provider=provider,
        filename=artifact_path.name,
        content=artifact_path.read_bytes(),
    )


def serialize_tenant_backup_run(run: TenantBackupRun) -> dict[str, Any]:
    return {
        "id": run.id,
        "tenant_id": run.tenant_id,
        "requested_by_user_id": run.requested_by_user_id,
        "settings_id": run.settings_id,
        "backup_type": run.backup_type,
        "scope": run.scope,
        "modules_included": list(run.modules_included or []),
        "status": run.status,
        "started_at": run.started_at,
        "completed_at": run.completed_at,
        "storage_ref": run.storage_ref,
        "size_bytes": run.size_bytes,
        "error_message": run.error_message,
        "destination": run.destination,
        "destination_upload_status": run.destination_upload_status,
        "metadata_json": run.metadata_json or {},
        "created_at": run.created_at,
        "updated_at": run.updated_at,
    }


def list_tenant_backup_runs(
    db: Session,
    *,
    tenant_id: int,
    pagination: Pagination,
) -> tuple[list[TenantBackupRun], int]:
    query = db.query(TenantBackupRun).filter(TenantBackupRun.tenant_id == tenant_id, TenantBackupRun.backup_type == "tenant")
    total = query.count()
    items = (
        query
        .order_by(TenantBackupRun.created_at.desc(), TenantBackupRun.id.desc())
        .offset(pagination.offset)
        .limit(pagination.limit)
        .all()
    )
    return items, total


def get_tenant_backup_run_or_404(db: Session, *, tenant_id: int, run_id: int) -> TenantBackupRun:
    run = (
        db.query(TenantBackupRun)
        .filter(
            TenantBackupRun.id == run_id,
            TenantBackupRun.tenant_id == tenant_id,
            TenantBackupRun.backup_type == "tenant",
        )
        .first()
    )
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant backup run not found.")
    return run


def get_tenant_backup_artifact_path(run: TenantBackupRun) -> Path:
    if run.status != "completed" or not run.file_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant backup artifact is not available.")
    path = Path(run.file_path).resolve()
    allowed_root = TENANT_BACKUP_UPLOAD_DIR.resolve()
    if allowed_root != path and allowed_root not in path.parents:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant backup artifact is not available.")
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant backup artifact no longer exists.")
    return path


def delete_tenant_backup_artifact(db: Session, *, tenant_id: int, actor_user_id: int, run_id: int) -> TenantBackupRun:
    run = get_tenant_backup_run_or_404(db, tenant_id=tenant_id, run_id=run_id)
    before_state = serialize_tenant_backup_run(run)
    _delete_artifact(run.file_path)
    run.file_path = None
    run.storage_ref = None
    run.destination_upload_status = "expired"
    run.metadata_json = {
        **(run.metadata_json or {}),
        "artifact_deleted_at": _utc_now().isoformat(),
        "artifact_deleted_by_user_id": actor_user_id,
    }
    db.add(run)
    db.commit()
    db.refresh(run)
    safe_log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key="tenant_backups",
        entity_type="tenant_backup_run",
        entity_id=run.id,
        action="backup.deleted",
        description=f"Deleted tenant backup artifact for run #{run.id}",
        before_state=before_state,
        after_state=serialize_tenant_backup_run(run),
    )
    return run


def _create_pending_tenant_backup_run(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int,
    force_full_tenant: bool = False,
    destination_override: str | None = None,
) -> TenantBackupRun:
    settings = get_or_create_tenant_backup_settings(db, tenant_id=tenant_id, actor_user_id=actor_user_id)
    modules_included = (
        [module_key for module_key in _enabled_tenant_modules(db, tenant_id=tenant_id) if module_key in SUPPORTED_MODULE_EXPORTS]
        if force_full_tenant
        else _included_modules(db, tenant_id=tenant_id, settings=settings)
    )
    if not modules_included:
        raise HTTPException(status_code=422, detail="No supported enabled modules are available for tenant backup.")
    scope = "full_tenant" if force_full_tenant else settings.scope
    destination = destination_override or settings.destination
    run = TenantBackupRun(
        tenant_id=tenant_id,
        requested_by_user_id=actor_user_id,
        settings_id=settings.id,
        backup_type="tenant",
        scope=scope,
        modules_included=modules_included,
        status="pending",
        destination=destination,
        destination_upload_status="not_applicable" if destination == "local_download" else "pending",
        metadata_json={},
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def _execute_tenant_backup_run(db: Session, *, run: TenantBackupRun, skip_retention_cleanup: bool = False) -> TenantBackupRun:
    tenant_id = int(run.tenant_id)
    actor_user_id = int(run.requested_by_user_id) if run.requested_by_user_id is not None else None
    if actor_user_id is None:
        raise HTTPException(status_code=422, detail="Tenant backup run is missing an actor.")
    settings = run.settings or get_or_create_tenant_backup_settings(db, tenant_id=tenant_id, actor_user_id=actor_user_id)
    modules_included = list(run.modules_included or [])
    destination = run.destination
    safe_log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key="tenant_backups",
        entity_type="tenant_backup_run",
        entity_id=run.id,
        action="backup.run.started",
        description=f"Started tenant backup run #{run.id}",
        after_state=serialize_tenant_backup_run(run),
    )

    started_at = _utc_now()
    run.status = "running"
    run.started_at = started_at
    db.add(run)
    db.commit()
    db.refresh(run)

    try:
        tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
        artifact_path = _artifact_path(tenant_id=tenant_id, run_id=run.id)
        record_counts: dict[str, int] = {}
        with zipfile.ZipFile(artifact_path, mode="w", compression=zipfile.ZIP_DEFLATED) as zipf:
            for module_key in modules_included:
                filename, model = SUPPORTED_MODULE_EXPORTS[module_key]
                rows = _export_model_rows(db, tenant_id=tenant_id, model=model)
                record_counts[module_key] = len(rows)
                _write_json(zipf, f"modules/{filename}", rows)
                for child_filename, child_model in MODULE_CHILD_EXPORTS.get(module_key, []):
                    child_rows = _export_model_rows(db, tenant_id=tenant_id, model=child_model)
                    record_counts[child_filename.removesuffix(".json")] = len(child_rows)
                    _write_json(zipf, f"modules/{child_filename}", child_rows)

            local_document_files = 0
            if settings.include_documents and "documents" in modules_included:
                local_document_files = _add_local_document_files(zipf, db=db, tenant_id=tenant_id)

            metadata = {
                "backup_type": "tenant",
                "tenant_id": str(tenant_id),
                "tenant_name": tenant.name if tenant else str(tenant_id),
                "created_at": started_at.isoformat(),
                "export_version": BACKUP_EXPORT_VERSION,
                "app_version": None,
                "app_commit": None,
                "module_list": modules_included,
                "record_counts": record_counts,
                "include_documents": bool(settings.include_documents),
                "local_document_files": local_document_files,
                "restore_compatibility_version": RESTORE_COMPATIBILITY_VERSION,
            }
            _write_json(zipf, "metadata.json", metadata)

        completed_at = _utc_now()
        run.status = "completed"
        run.completed_at = completed_at
        run.file_path = str(artifact_path)
        run.storage_ref = f"tenant-backups/tenant-{tenant_id}/{run.id}/{artifact_path.name}"
        run.size_bytes = artifact_path.stat().st_size
        run.metadata_json = metadata
        if destination != "local_download":
            try:
                destination_result = _upload_destination_artifact(
                    db,
                    tenant_id=tenant_id,
                    actor_user_id=actor_user_id,
                    destination=destination,
                    artifact_path=artifact_path,
                )
                run.destination_upload_status = "uploaded"
                run.storage_ref = (
                    f"{destination}:{destination_result['storage_path']}"
                    if destination_result
                    else run.storage_ref
                )
                run.metadata_json = {
                    **metadata,
                    "destination": destination,
                    "destination_upload_status": "uploaded",
                    "destination_storage_ref": run.storage_ref,
                }
            except Exception as upload_exc:
                run.destination_upload_status = "failed"
                run.error_message = f"Backup artifact created locally, but upload failed: {str(upload_exc)[:900]}"
                run.metadata_json = {
                    **metadata,
                    "destination": destination,
                    "destination_upload_status": "failed",
                }
        settings.last_run_at = completed_at
        settings.next_run_at = _next_run_at(enabled=bool(settings.enabled), frequency=settings.frequency)
        db.commit()
        db.refresh(run)

        cleaned = 0 if skip_retention_cleanup else _cleanup_retention(db, tenant_id=tenant_id, retention_count=settings.retention_count)
        if cleaned:
            db.refresh(run)

        safe_log_activity(
            db,
            tenant_id=tenant_id,
            actor_user_id=actor_user_id,
            module_key="tenant_backups",
            entity_type="tenant_backup_run",
            entity_id=run.id,
            action="backup.run.completed",
            description=f"Completed tenant backup run #{run.id}",
            after_state=serialize_tenant_backup_run(run),
        )
        return run
    except Exception as exc:
        db.rollback()
        _delete_artifact(str(_artifact_path(tenant_id=tenant_id, run_id=run.id)))
        run = get_tenant_backup_run_or_404(db, tenant_id=tenant_id, run_id=run.id)
        run.status = "failed"
        run.completed_at = _utc_now()
        run.error_message = str(exc)[:1000]
        db.commit()
        db.refresh(run)
        safe_log_activity(
            db,
            tenant_id=tenant_id,
            actor_user_id=actor_user_id,
            module_key="tenant_backups",
            entity_type="tenant_backup_run",
            entity_id=run.id,
            action="backup.run.failed",
            description=f"Failed tenant backup run #{run.id}",
            after_state=serialize_tenant_backup_run(run),
        )
        return run


def process_tenant_backup_run(db: Session, *, run_id: int) -> TenantBackupRun:
    run = db.query(TenantBackupRun).filter(TenantBackupRun.id == run_id, TenantBackupRun.backup_type == "tenant").first()
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant backup run not found.")
    if run.status not in {"pending", "failed"}:
        return run
    return _execute_tenant_backup_run(db, run=run)


def enqueue_tenant_backup_run(run_id: int) -> None:
    from app.tasks.tenant_backup_tasks import process_tenant_backup_run_task

    process_tenant_backup_run_task.delay(run_id)


def create_queued_manual_tenant_backup_run(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int,
    force_full_tenant: bool = False,
    destination_override: str | None = None,
) -> TenantBackupRun:
    run = _create_pending_tenant_backup_run(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        force_full_tenant=force_full_tenant,
        destination_override=destination_override,
    )
    try:
        enqueue_tenant_backup_run(int(run.id))
    except Exception as exc:
        run.status = "failed"
        run.completed_at = _utc_now()
        run.error_message = f"Backup could not be queued: {str(exc)[:900]}"
        db.add(run)
        db.commit()
        db.refresh(run)
    return run


def create_manual_tenant_backup_run(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int,
    force_full_tenant: bool = False,
    destination_override: str | None = None,
    skip_retention_cleanup: bool = False,
) -> TenantBackupRun:
    run = _create_pending_tenant_backup_run(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        force_full_tenant=force_full_tenant,
        destination_override=destination_override,
    )
    return _execute_tenant_backup_run(db, run=run, skip_retention_cleanup=skip_retention_cleanup)


def create_safety_tenant_backup_run(db: Session, *, tenant_id: int, actor_user_id: int) -> TenantBackupRun:
    return create_manual_tenant_backup_run(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        force_full_tenant=True,
        destination_override="local_download",
        skip_retention_cleanup=True,
    )


def run_due_tenant_backup_schedules(db: Session, *, now: datetime | None = None, limit: int = 25) -> dict[str, int]:
    current = now or _utc_now()
    due_settings = (
        db.query(TenantBackupSettings)
        .filter(
            TenantBackupSettings.enabled.is_(True),
            TenantBackupSettings.frequency != "manual",
            TenantBackupSettings.next_run_at.isnot(None),
            TenantBackupSettings.next_run_at <= current,
        )
        .order_by(TenantBackupSettings.next_run_at.asc(), TenantBackupSettings.id.asc())
        .limit(max(int(limit), 1))
        .all()
    )
    result = {
        "scanned": len(due_settings),
        "started": 0,
        "completed": 0,
        "failed": 0,
        "skipped": 0,
    }
    for settings in due_settings:
        actor_user_id = settings.updated_by_id or settings.created_by_id
        if not actor_user_id:
            settings.next_run_at = _next_run_at(enabled=True, frequency=settings.frequency, now=current)
            db.add(settings)
            db.commit()
            result["skipped"] += 1
            continue
        result["started"] += 1
        try:
            run = create_manual_tenant_backup_run(db, tenant_id=settings.tenant_id, actor_user_id=actor_user_id)
            if run.status == "completed":
                result["completed"] += 1
            else:
                result["failed"] += 1
                settings = get_or_create_tenant_backup_settings(db, tenant_id=settings.tenant_id, actor_user_id=actor_user_id)
                settings.next_run_at = _next_run_at(enabled=bool(settings.enabled), frequency=settings.frequency, now=current)
                db.add(settings)
                db.commit()
        except Exception:
            db.rollback()
            settings = get_or_create_tenant_backup_settings(db, tenant_id=settings.tenant_id, actor_user_id=actor_user_id)
            settings.next_run_at = _next_run_at(enabled=bool(settings.enabled), frequency=settings.frequency, now=current)
            db.add(settings)
            db.commit()
            result["failed"] += 1
    return result
