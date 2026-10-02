from __future__ import annotations

import json
import zipfile
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import inspect as sqlalchemy_inspect, text
from sqlalchemy.orm import Session
from sqlalchemy.sql.sqltypes import Date, DateTime, Numeric

from app.modules.platform.models import TenantBackupRun, TenantRestoreRun
from app.modules.catalog.models import CatalogProduct
from app.modules.inventory.models import InventoryStockLevel, InventoryStockMove, InventoryWarehouse
from app.modules.inventory.services.stock_ledger import rebuild_reservations
from app.modules.platform.services.activity_logs import safe_log_activity
from app.modules.platform.services.tenant_backup_runs import (
    MODULE_CHILD_EXPORTS,
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


# Inventory files added after backups were first taken (E3 deliveries and returns). A backup
# made before them simply has none, which restores as none.
OPTIONAL_INVENTORY_FILES = {"inventory_deliveries.json", "inventory_delivery_lines.json", "inventory_returns.json", "inventory_return_lines.json"}


def _read_inventory_rows(zipf: zipfile.ZipFile, filename: str) -> Any:
    if filename in OPTIONAL_INVENTORY_FILES and f"modules/{filename}" not in zipf.namelist():
        return []
    return _read_json(zipf, f"modules/{filename}")


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


def _restore_inventory_bundle(db: Session, zipf: zipfile.ZipFile, *, tenant_id: int, mode: str, warehouse_rows: list[dict[str, Any]]) -> dict[str, int]:
    """Restore an inventory snapshot without mutating append-only movements.

    Missing movements are inserted, then balances and product caches are rebuilt from
    the complete ledger. A destructive replacement cannot discard later movements.
    """
    if mode == "update_existing":
        raise HTTPException(status_code=409, detail="Append-only inventory cannot use update existing; choose create missing or replace")
    children: dict[str, list[dict[str, Any]]] = {}
    for filename, _model in MODULE_CHILD_EXPORTS["inventory_stock"]:
        rows = _read_inventory_rows(zipf, filename)
        if not isinstance(rows, list) or any(not isinstance(row, dict) or str(row.get("tenant_id")) != str(tenant_id) for row in rows):
            raise HTTPException(status_code=UNPROCESSABLE_STATUS, detail=f"Inventory backup rows are invalid: {filename}")
        children[filename] = rows
    incoming_moves = children["inventory_stock_moves.json"]
    incoming_ids = {int(row["id"]) for row in incoming_moves}
    if mode in {"replace_module_data", WHOLE_TENANT_RESTORE_MODE}:
        current_ids = {row[0] for row in db.query(InventoryStockMove.id).filter(InventoryStockMove.tenant_id == tenant_id).all()}
        if current_ids - incoming_ids:
            raise HTTPException(status_code=409, detail="Inventory has movements newer than this backup; append-only history cannot be replaced")
    for row in incoming_moves:
        existing = db.query(InventoryStockMove).filter(InventoryStockMove.tenant_id == tenant_id, InventoryStockMove.id == row["id"]).first()
        if existing:
            for key in ("product_id", "warehouse_id", "quantity", "on_hand_after", "move_type", "source_type", "source_id", "reverses_move_id"):
                if str(getattr(existing, key)) != str(_coerce_column_value(InventoryStockMove.__table__.columns[key], row.get(key))):
                    raise HTTPException(status_code=409, detail=f"Movement {row['id']} differs from the immutable backup")

    created = updated = skipped = soft_deleted = 0
    bundles = [("inventory_warehouses.json", InventoryWarehouse, warehouse_rows)] + [
        (name, model, children[name]) for name, model in MODULE_CHILD_EXPORTS["inventory_stock"] if model is not InventoryStockLevel
    ]
    for _name, model, rows in bundles:
        row_mode = "create_missing" if model is InventoryStockMove or mode in {"create_missing", "skip_duplicates"} else "replace_module_data"
        result = _apply_restore_rows(db, tenant_id=tenant_id, model=model, rows=rows, mode=row_mode)
        created += result["created"]
        updated += result["updated"]
        skipped += result["skipped"]
        soft_deleted += result["soft_deleted"]
        db.flush()

    products = {row.id: row for row in db.query(CatalogProduct).filter(CatalogProduct.tenant_id == tenant_id, CatalogProduct.track_inventory == 1).order_by(CatalogProduct.id).with_for_update().all()}
    balances: dict[tuple[int, int], Decimal] = {}
    for move in db.query(InventoryStockMove).filter(InventoryStockMove.tenant_id == tenant_id).order_by(InventoryStockMove.id).all():
        if move.product_id not in products:
            raise HTTPException(status_code=409, detail="Inventory backup has movements for a product that no longer tracks inventory; turn tracking back on before restoring")
        key = (move.product_id, move.warehouse_id)
        balances[key] = balances.get(key, Decimal(0)) + Decimal(move.quantity)
        if balances[key] < 0 or balances[key] != Decimal(move.on_hand_after):
            raise HTTPException(status_code=409, detail=f"Movement {move.id} does not match the restored ledger balance")
    levels = {(row.product_id, row.warehouse_id): row for row in db.query(InventoryStockLevel).filter(InventoryStockLevel.tenant_id == tenant_id).with_for_update().all()}
    backup_levels = {(int(row["product_id"]), int(row["warehouse_id"])): row for row in children["inventory_stock_levels.json"]}
    # `reserved` is not taken from the backup: holds are derived from confirmed orders and
    # re-validated against the restored stock by `rebuild_reservations` below.
    for key in set(levels) | set(balances) | set(backup_levels):
        level = levels.get(key)
        if level is None:
            level = InventoryStockLevel(tenant_id=tenant_id, product_id=key[0], warehouse_id=key[1], reserved=Decimal(0))
            db.add(level)
        level.on_hand = balances.get(key, Decimal(0))
    for product_id, product in products.items():
        total = sum((quantity for (pid, _), quantity in balances.items() if pid == product_id), Decimal(0))
        product.stock_quantity = total
        product.stock_status = "in_stock" if total > 0 else "out_of_stock"
    db.flush()
    rebuild_reservations(db, tenant_id=tenant_id)
    if db.get_bind().dialect.name == "postgresql":
        for _name, model, _rows in bundles:
            table = model.__tablename__
            db.execute(text(f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM {table}), 1))"))
    return {"created": created, "updated": updated, "skipped": skipped, "soft_deleted": soft_deleted}


def _inventory_preview_count(zipf: zipfile.ZipFile, *, tenant_id: int, warehouse_rows: list[dict[str, Any]]) -> int:
    total = len(warehouse_rows)
    for filename, _model in MODULE_CHILD_EXPORTS["inventory_stock"]:
        rows = _read_inventory_rows(zipf, filename)
        if not isinstance(rows, list) or any(not isinstance(row, dict) or str(row.get("tenant_id")) != str(tenant_id) for row in rows):
            raise HTTPException(status_code=UNPROCESSABLE_STATUS, detail=f"Inventory backup rows are invalid: {filename}")
        total += len(rows)
    return total


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
        inventory_total = _inventory_preview_count(zipf, tenant_id=tenant_id, warehouse_rows=rows) if module_key == "inventory_stock" else None
    summary = _restore_summary(db, tenant_id=tenant_id, model=model, rows=rows)
    if inventory_total is not None:
        summary["total_rows"] = inventory_total
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
            if module_key == "inventory_stock":
                preview_summary["total_rows"] = _inventory_preview_count(zipf, tenant_id=tenant_id, warehouse_rows=rows)
            with db.begin_nested():
                result = _restore_inventory_bundle(db, zipf, tenant_id=tenant_id, mode=mode, warehouse_rows=rows) if module_key == "inventory_stock" else _apply_restore_rows(db, tenant_id=tenant_id, model=model, rows=rows, mode=mode)
                db.flush()
                if module_key == "sales_orders":
                    # Restored statuses decide which orders may hold stock.
                    rebuild_reservations(db, tenant_id=tenant_id)
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
            if module_key == "inventory_stock":
                summary["total_rows"] = _inventory_preview_count(zipf, tenant_id=tenant_id, warehouse_rows=rows)
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
                if module_key == "inventory_stock":
                    preview_summary["total_rows"] = _inventory_preview_count(zipf, tenant_id=tenant_id, warehouse_rows=rows)
                with db.begin_nested():
                    result = _restore_inventory_bundle(db, zipf, tenant_id=tenant_id, mode=WHOLE_TENANT_RESTORE_MODE, warehouse_rows=rows) if module_key == "inventory_stock" else _apply_restore_rows(db, tenant_id=tenant_id, model=model, rows=rows, mode="replace_module_data")
                    db.flush()
                if module_key == "sales_orders":
                    with db.begin_nested():
                        rebuild_reservations(db, tenant_id=tenant_id)
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
