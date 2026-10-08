from __future__ import annotations

import json
import zipfile
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, inspect as sqlalchemy_inspect, text
from sqlalchemy.orm import Session
from sqlalchemy.sql.sqltypes import Date, DateTime, Numeric

from app.modules.platform.models import FieldDefinition, FieldValue, Picklist, PicklistDependency, PicklistValue, TenantBackupRun, TenantRestoreRun
from app.modules.catalog.models import CatalogProduct
from app.modules.inventory.models import InventoryRevaluation, InventoryStockLevel, InventoryStockMove, InventoryWarehouse
from app.modules.inventory.services.stock_ledger import rebuild_reservations
from app.modules.documents.models import Document, DocumentLink, DocumentVersion
from app.modules.platform.services.activity_logs import safe_log_activity
from app.modules.platform.services.tenant_backup_runs import (
    MODULE_CHILD_EXPORTS,
    RESTORE_COMPATIBILITY_VERSION,
    SUPPORTED_MODULE_EXPORTS,
    create_safety_tenant_backup_run,
    get_tenant_backup_artifact_path,
    get_tenant_backup_run_or_404,
)
from app.modules.sales.models import (
    SalesContact,
    SalesOpportunity,
    SalesOpportunityContact,
    SalesOrder,
    SalesOrderItem,
    SalesPipeline,
    SalesPipelineStage,
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
OPTIONAL_INVENTORY_FILES = {
    "inventory_deliveries.json", "inventory_delivery_lines.json", "inventory_returns.json", "inventory_return_lines.json",
    "purchase_orders.json", "purchase_order_lines.json", "purchase_receipts.json", "purchase_receipt_lines.json",
    "purchase_bills.json", "purchase_bill_lines.json", "inventory_revaluations.json",
    # 13c §3.6–3.7.
    "purchase_vendor_returns.json", "purchase_vendor_return_lines.json", "purchase_vendor_credits.json",
    "purchase_vendor_credit_lines.json", "purchase_vendor_credit_allocations.json",
}


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


def _sync_id_sequences(db: Session, models: list[Any]) -> None:
    """Move each table's id sequence past the ids a restore wrote explicitly."""
    if db.get_bind().dialect.name != "postgresql":
        return
    for table in dict.fromkeys(model.__tablename__ for model in models):
        db.execute(text(f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM {table}), 1))"))


def _child_rows(zipf: zipfile.ZipFile, *, tenant_id: int, filename: str) -> list[dict[str, Any]]:
    """A child file of a set; a backup taken before the file existed restores none."""
    name = f"modules/{filename}"
    rows = _read_json(zipf, name) if name in zipf.namelist() else []
    if not isinstance(rows, list) or any(not isinstance(row, dict) or str(row.get("tenant_id")) != str(tenant_id) for row in rows):
        raise HTTPException(status_code=UNPROCESSABLE_STATUS, detail=f"Backup rows are invalid: {filename}")
    return rows


def _tenant_ids(db: Session, *, tenant_id: int, column: Any) -> set[int]:
    return {row[0] for row in db.query(column).filter(column.class_.tenant_id == tenant_id).all()}


def _upsert_child(
    db: Session,
    *,
    tenant_id: int,
    model: Any,
    row: dict[str, Any],
    authoritative: bool,
    natural_key: tuple[str, ...] = (),
) -> tuple[Any, str]:
    """Write one child row: matched by id, else by its natural key, else created with its id.

    Children of a restored record are always created when missing, since a parent without
    its lines is not the record that was backed up. Existing children are overwritten only
    when the restore mode lets the backup win. Returns the row and created/updated/skipped.
    """
    pk_name = _primary_key_name(model)
    pk_column = getattr(model, pk_name)
    existing = db.query(model).filter(model.tenant_id == tenant_id, pk_column == row.get(pk_name)).first()
    if existing is None and natural_key:
        existing = db.query(model).filter(
            model.tenant_id == tenant_id, *[getattr(model, key) == row.get(key) for key in natural_key]
        ).first()
    if existing is not None:
        if not authoritative:
            return existing, "skipped"
        # A natural-key match keeps its own id; only the values come from the backup.
        _assign_row_values(existing, {key: value for key, value in row.items() if key != pk_name}, tenant_id=tenant_id)
        return existing, "updated"
    instance = model()
    _assign_row_values(instance, row, tenant_id=tenant_id)
    db.add(instance)
    return instance, "created"


def _count(totals: dict[str, int], outcome: str) -> None:
    totals[outcome] = totals.get(outcome, 0) + 1


def _restore_opportunity_bundle(db: Session, zipf: zipfile.ZipFile, *, tenant_id: int, mode: str, deal_rows: list[dict[str, Any]]) -> dict[str, int]:
    """Deals with their pipelines, stages and participants (13a A2).

    Pipelines and stages are matched by id, else by name and stage key, because a tenant
    that recreated its pipeline has the same stages under new ids. Deals are remapped onto
    the ids that matched. Pipelines and stages are created in every mode: they are
    configuration the deals cannot be restored without.
    """
    authoritative = mode in {"update_existing", "replace_module_data", WHOLE_TENANT_RESTORE_MODE}
    totals = {"created": 0, "updated": 0, "skipped": 0, "soft_deleted": 0}
    pipeline_ids: dict[Any, int] = {}
    for row in _child_rows(zipf, tenant_id=tenant_id, filename="sales_pipelines.json"):
        if row.get("is_default"):
            current_default = db.query(SalesPipeline).filter(
                SalesPipeline.tenant_id == tenant_id, SalesPipeline.module_key == row.get("module_key"),
                SalesPipeline.is_default.is_(True), SalesPipeline.id != row.get("id"), SalesPipeline.name != row.get("name"),
            ).first()
            if current_default is not None:
                if authoritative:
                    current_default.is_default = False
                    db.flush()
                else:
                    row = {**row, "is_default": False}
        pipeline, outcome = _upsert_child(db, tenant_id=tenant_id, model=SalesPipeline, row=row, authoritative=authoritative, natural_key=("module_key", "name"))
        db.flush()
        pipeline_ids[row.get("id")] = pipeline.id
        _count(totals, outcome)
    stage_ids: dict[Any, int] = {}
    for row in _child_rows(zipf, tenant_id=tenant_id, filename="sales_pipeline_stages.json"):
        if row.get("pipeline_id") not in pipeline_ids:
            _count(totals, "skipped")
            continue
        row = {**row, "pipeline_id": pipeline_ids[row["pipeline_id"]]}
        stage, outcome = _upsert_child(db, tenant_id=tenant_id, model=SalesPipelineStage, row=row, authoritative=authoritative, natural_key=("pipeline_id", "key"))
        db.flush()
        stage_ids[row.get("id")] = stage.id
        _count(totals, outcome)

    remapped_deals = [
        {
            **row,
            "pipeline_id": pipeline_ids.get(row.get("pipeline_id"), row.get("pipeline_id")),
            "pipeline_stage_id": stage_ids.get(row.get("pipeline_stage_id"), row.get("pipeline_stage_id")),
        }
        for row in deal_rows
    ]
    result = _apply_restore_rows(db, tenant_id=tenant_id, model=SalesOpportunity, rows=remapped_deals, mode=mode)
    db.flush()

    deals = _tenant_ids(db, tenant_id=tenant_id, column=SalesOpportunity.opportunity_id)
    contacts = _tenant_ids(db, tenant_id=tenant_id, column=SalesContact.contact_id)
    for row in _child_rows(zipf, tenant_id=tenant_id, filename="sales_opportunity_contacts.json"):
        if row.get("opportunity_id") not in deals or row.get("contact_id") not in contacts:
            _count(totals, "skipped")
            continue
        if row.get("is_primary") and not row.get("deleted_at"):
            # One primary per deal: the backup's primary wins only when the backup wins.
            others = db.query(SalesOpportunityContact).filter(
                SalesOpportunityContact.tenant_id == tenant_id, SalesOpportunityContact.opportunity_id == row["opportunity_id"],
                SalesOpportunityContact.contact_id != row["contact_id"], SalesOpportunityContact.is_primary.is_(True),
            ).all()
            if others and authoritative:
                for other in others:
                    other.is_primary = False
                db.flush()
            elif others:
                row = {**row, "is_primary": False}
        _participant, outcome = _upsert_child(
            db, tenant_id=tenant_id, model=SalesOpportunityContact, row=row, authoritative=authoritative,
            natural_key=("opportunity_id", "contact_id"),
        )
        db.flush()
        _count(totals, outcome)
    _sync_id_sequences(db, [SalesPipeline, SalesPipelineStage, SalesOpportunityContact])
    return {key: result[key] + totals[key] for key in result}


# Sets whose children hang off the parent by one column, with the key that identifies a
# child when its id has changed. Lines that exist beyond the backup are kept: an order line
# may already be delivered or invoiced, so a restore never deletes one.
CHILD_RESTORE_SPECS: dict[str, list[tuple[str, Any, str, Any, tuple[str, ...]]]] = {
    "sales_orders": [("sales_order_items.json", SalesOrderItem, "order_id", SalesOrder.id, ())],
    "documents": [
        ("document_versions.json", DocumentVersion, "document_id", Document.id, ("document_id", "version_number")),
        ("document_links.json", DocumentLink, "document_id", Document.id, ("document_id", "module_key", "entity_id")),
    ],
}


def _restore_with_children(db: Session, zipf: zipfile.ZipFile, *, tenant_id: int, module_key: str, model: Any, mode: str, rows: list[dict[str, Any]]) -> dict[str, int]:
    result = _apply_restore_rows(db, tenant_id=tenant_id, model=model, rows=rows, mode=mode)
    db.flush()
    specs = CHILD_RESTORE_SPECS.get(module_key, [])
    authoritative = mode in {"update_existing", "replace_module_data", WHOLE_TENANT_RESTORE_MODE}
    for filename, child_model, parent_key, parent_column, natural_key in specs:
        parents = _tenant_ids(db, tenant_id=tenant_id, column=parent_column)
        for row in _child_rows(zipf, tenant_id=tenant_id, filename=filename):
            if row.get(parent_key) not in parents:
                _count(result, "skipped")
                continue
            _child, outcome = _upsert_child(db, tenant_id=tenant_id, model=child_model, row=row, authoritative=authoritative, natural_key=natural_key)
            _count(result, outcome)
        db.flush()
    _sync_id_sequences(db, [spec[1] for spec in specs])
    return result


def _restore_picklists(db: Session, zipf: zipfile.ZipFile, *, tenant_id: int, authoritative: bool) -> None:
    """The backup's picklists, before any record that stores their keys (13b §3.8).

    Lists match by key and values by list and key, so a tenant whose lists were reseeded
    under new ids gets the backup's values back. Missing values are always created; existing
    ones take the backup's label, order and flags only when the backup wins. A backup taken
    before picklists existed restores none, and its stray values show under *Values not in
    the list*.
    """
    list_ids: dict[Any, int] = {}
    for row in _child_rows(zipf, tenant_id=tenant_id, filename="picklists.json"):
        picklist, _outcome = _upsert_child(db, tenant_id=tenant_id, model=Picklist, row=row, authoritative=authoritative, natural_key=("key",))
        db.flush()
        list_ids[row.get("id")] = picklist.id
    for row in _child_rows(zipf, tenant_id=tenant_id, filename="picklist_values.json"):
        if row.get("picklist_id") not in list_ids:
            continue
        row = {**row, "picklist_id": list_ids[row["picklist_id"]]}
        if row.get("is_default"):
            other = db.query(PicklistValue).filter(
                PicklistValue.tenant_id == tenant_id, PicklistValue.picklist_id == row["picklist_id"],
                PicklistValue.is_default.is_(True), PicklistValue.key != row.get("key"),
            ).first()
            if other is not None:
                if authoritative:
                    other.is_default = False
                    db.flush()
                else:
                    row = {**row, "is_default": False}
        _upsert_child(db, tenant_id=tenant_id, model=PicklistValue, row=row, authoritative=authoritative, natural_key=("picklist_id", "key"))
        db.flush()
    # Dependencies name fields and value keys, not ids, so they restore as they were.
    for row in _child_rows(zipf, tenant_id=tenant_id, filename="picklist_dependencies.json"):
        _upsert_child(
            db, tenant_id=tenant_id, model=PicklistDependency, row=row, authoritative=authoritative,
            natural_key=("module_key", "dependent_field_key"),
        )
        db.flush()
    _sync_id_sequences(db, [Picklist, PicklistValue, PicklistDependency])


def _restore_field_values(db: Session, zipf: zipfile.ZipFile, *, tenant_id: int, module_key: str, model: Any, authoritative: bool) -> None:
    """The set's custom field values (13b §3.8), after its records: definitions match by module
    and key, values by record and definition, and a value whose record is not here is skipped."""
    definitions = [row for row in _child_rows(zipf, tenant_id=tenant_id, filename="field_definitions.json") if row.get("module_key") == module_key]
    if not definitions:
        return
    list_ids = {row.get("id"): row.get("key") for row in _child_rows(zipf, tenant_id=tenant_id, filename="picklists.json")}
    current_lists = {key: list_id for list_id, key in db.query(Picklist.id, Picklist.key).filter(Picklist.tenant_id == tenant_id).all()}
    definition_ids: dict[Any, int] = {}
    for row in definitions:
        row = {**row, "picklist_id": current_lists.get(list_ids.get(row.get("picklist_id"))) if row.get("picklist_id") else None,
               "custom_module_id": row.get("custom_module_id")}
        definition, _outcome = _upsert_child(db, tenant_id=tenant_id, model=FieldDefinition, row=row, authoritative=authoritative,
                                             natural_key=("module_key", "field_key"))
        db.flush()
        definition_ids[row.get("id")] = definition.id
    live = _tenant_ids(db, tenant_id=tenant_id, column=getattr(model, _primary_key_name(model)))
    for row in _child_rows(zipf, tenant_id=tenant_id, filename="field_values.json"):
        if row.get("module_key") != module_key or row.get("field_definition_id") not in definition_ids or row.get("record_id") not in live:
            continue
        row = {**row, "field_definition_id": definition_ids[row["field_definition_id"]]}
        _upsert_child(db, tenant_id=tenant_id, model=FieldValue, row=row, authoritative=authoritative,
                      natural_key=("module_key", "record_id", "field_definition_id"))
    db.flush()
    _sync_id_sequences(db, [FieldDefinition, FieldValue])


def _restore_module_rows(db: Session, zipf: zipfile.ZipFile, *, tenant_id: int, module_key: str, model: Any, mode: str, rows: list[dict[str, Any]]) -> dict[str, int]:
    """One set, parents and children, then its custom field values, in the given mode."""
    authoritative = mode in {"update_existing", "replace_module_data", WHOLE_TENANT_RESTORE_MODE}
    _restore_picklists(db, zipf, tenant_id=tenant_id, authoritative=authoritative)
    result = _restore_module_rows_only(db, zipf, tenant_id=tenant_id, module_key=module_key, model=model, mode=mode, rows=rows)
    _restore_field_values(db, zipf, tenant_id=tenant_id, module_key=module_key, model=model, authoritative=authoritative)
    return result


def _restore_module_rows_only(db: Session, zipf: zipfile.ZipFile, *, tenant_id: int, module_key: str, model: Any, mode: str, rows: list[dict[str, Any]]) -> dict[str, int]:
    """One set, parents and children, in the given mode."""
    if module_key == "inventory_stock":
        return _restore_inventory_bundle(db, zipf, tenant_id=tenant_id, mode=mode, warehouse_rows=rows)
    if module_key == "finance_pos":
        # Issued documents are final, so a whole-tenant restore creates what is missing.
        return _restore_finance_bundle(db, zipf, tenant_id=tenant_id, mode="create_missing" if mode == WHOLE_TENANT_RESTORE_MODE else mode, invoice_rows=rows)
    if mode == WHOLE_TENANT_RESTORE_MODE:
        mode = "replace_module_data"
    if module_key == "sales_opportunities":
        return _restore_opportunity_bundle(db, zipf, tenant_id=tenant_id, mode=mode, deal_rows=rows)
    return _restore_with_children(db, zipf, tenant_id=tenant_id, module_key=module_key, model=model, mode=mode, rows=rows)


def _preview_total(zipf: zipfile.ZipFile, *, tenant_id: int, module_key: str, rows: list[dict[str, Any]]) -> int:
    """Parent rows plus every child file the restore will read."""
    if module_key == "inventory_stock":
        return _inventory_preview_count(zipf, tenant_id=tenant_id, warehouse_rows=rows)
    return len(rows) + sum(
        len(_child_rows(zipf, tenant_id=tenant_id, filename=filename)) for filename, _model in MODULE_CHILD_EXPORTS.get(module_key, [])
    )


def _restore_order(module_keys: list[str]) -> list[str]:
    """Backed-up sets in dependency order (see SUPPORTED_MODULE_EXPORTS)."""
    return [key for key in SUPPORTED_MODULE_EXPORTS if key in module_keys]


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
                # Compared as values: the backup's JSON writes 20.0000 as 20.0.
                column = InventoryStockMove.__table__.columns[key]
                if _coerce_column_value(column, getattr(existing, key)) != _coerce_column_value(column, row.get(key)):
                    raise HTTPException(status_code=409, detail=f"Movement {row['id']} differs from the immutable backup")

    created = updated = skipped = soft_deleted = 0
    bundles = [("inventory_warehouses.json", InventoryWarehouse, warehouse_rows)] + [
        (name, model, children[name]) for name, model in MODULE_CHILD_EXPORTS["inventory_stock"] if model is not InventoryStockLevel
    ]
    for _name, model, rows in bundles:
        row_mode = "create_missing" if model in (InventoryStockMove, InventoryRevaluation) or mode in {"create_missing", "skip_duplicates"} else "replace_module_data"
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
    # Stock value is Σ move values + Σ revaluations (12d §3.1); moves from a backup older than
    # E6 carry no value and count as cost missing until revalued.
    values: dict[int, Decimal] = {}
    for product_id, value in db.query(InventoryStockMove.product_id, func.coalesce(func.sum(InventoryStockMove.value), 0)).filter(
            InventoryStockMove.tenant_id == tenant_id).group_by(InventoryStockMove.product_id):
        values[product_id] = Decimal(value or 0)
    for product_id, change in db.query(InventoryRevaluation.product_id, func.coalesce(func.sum(InventoryRevaluation.stock_change), 0)).filter(
            InventoryRevaluation.tenant_id == tenant_id).group_by(InventoryRevaluation.product_id):
        values[product_id] = values.get(product_id, Decimal(0)) + Decimal(change or 0)
    for product_id, product in products.items():
        total = sum((quantity for (pid, _), quantity in balances.items() if pid == product_id), Decimal(0))
        product.stock_quantity = total
        product.stock_status = "in_stock" if total > 0 else "out_of_stock"
        product.stock_value = values.get(product_id, Decimal(0)) if total > 0 else Decimal(0)
        if total > 0 and product.stock_value > 0:
            product.cost_price = (product.stock_value / total).quantize(Decimal("0.0001"))
    db.flush()
    rebuild_reservations(db, tenant_id=tenant_id)
    _sync_id_sequences(db, [model for _name, model, _rows in bundles])
    return {"created": created, "updated": updated, "skipped": skipped, "soft_deleted": soft_deleted}


def _restore_finance_bundle(db: Session, zipf: zipfile.ZipFile, *, tenant_id: int, mode: str, invoice_rows: list[dict[str, Any]]) -> dict[str, int]:
    """Restore invoices, credit notes and payments by creating what is missing (12c §3.6).

    Issued documents are final, so nothing that exists is overwritten or removed; balances
    and the orders' invoice status are recomputed from the restored allocations.
    """
    from app.modules.finance.models import FinanceCreditNote, FinancePosInvoice
    from app.modules.finance.services.invoice_balances import refresh_credit_note_balance, refresh_invoice_balance
    from app.modules.finance.services.invoicing_services import recompute_tenant
    from app.modules.purchasing.models import PurchaseBill, PurchaseVendorCredit
    from app.modules.purchasing.services.bill_services import refresh_bill_balance
    from app.modules.purchasing.services.vendor_credit_services import refresh_vendor_credit_balance

    if mode in {"update_existing", "replace_module_data"}:
        raise HTTPException(status_code=409, detail="Invoices, credit notes and payments are final; restore them with create missing")
    bundles = [("finance_invoices.json", SUPPORTED_MODULE_EXPORTS["finance_pos"][1], invoice_rows)]
    for filename, model in MODULE_CHILD_EXPORTS["finance_pos"]:
        rows = _read_json(zipf, f"modules/{filename}") if f"modules/{filename}" in zipf.namelist() else []
        if not isinstance(rows, list) or any(not isinstance(row, dict) or str(row.get("tenant_id")) != str(tenant_id) for row in rows):
            raise HTTPException(status_code=UNPROCESSABLE_STATUS, detail=f"Finance backup rows are invalid: {filename}")
        if filename == "finance_payment_allocations.json":
            # An allocation to a bill this tenant no longer has cannot be restored.
            bills = {row[0] for row in db.query(PurchaseBill.id).filter(PurchaseBill.tenant_id == tenant_id)}
            credits = {row[0] for row in db.query(PurchaseVendorCredit.id).filter(PurchaseVendorCredit.tenant_id == tenant_id)}
            rows = [row for row in rows if (not row.get("bill_id") or int(row["bill_id"]) in bills)
                    and (not row.get("vendor_credit_id") or int(row["vendor_credit_id"]) in credits)]
        bundles.append((filename, model, rows))
    created = skipped = 0
    for _name, model, rows in bundles:
        result = _apply_restore_rows(db, tenant_id=tenant_id, model=model, rows=rows, mode="create_missing")
        created += result["created"]
        skipped += result["skipped"]
        db.flush()
    for invoice in db.query(FinancePosInvoice).filter(FinancePosInvoice.tenant_id == tenant_id).all():
        refresh_invoice_balance(db, invoice)
    for credit_note in db.query(FinanceCreditNote).filter(FinanceCreditNote.tenant_id == tenant_id).all():
        refresh_credit_note_balance(db, credit_note)
    for bill in db.query(PurchaseBill).filter(PurchaseBill.tenant_id == tenant_id).all():
        refresh_bill_balance(db, bill)
    for credit in db.query(PurchaseVendorCredit).filter(PurchaseVendorCredit.tenant_id == tenant_id).all():
        refresh_vendor_credit_balance(db, credit)
    recompute_tenant(db, tenant_id=tenant_id)
    db.flush()
    _sync_id_sequences(db, [model for _name, model, _rows in bundles])
    return {"created": created, "updated": 0, "skipped": skipped, "soft_deleted": 0}


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
        total_rows = _preview_total(zipf, tenant_id=tenant_id, module_key=module_key, rows=rows)
    summary = {**_restore_summary(db, tenant_id=tenant_id, model=model, rows=rows), "total_rows": total_rows}
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
            preview_summary["total_rows"] = _preview_total(zipf, tenant_id=tenant_id, module_key=module_key, rows=rows)
            with db.begin_nested():
                result = _restore_module_rows(db, zipf, tenant_id=tenant_id, module_key=module_key, model=model, mode=mode, rows=rows)
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
        for module_key in _restore_order(metadata.get("module_list") or []):
            _validate_module_enabled(db, tenant_id=tenant_id, module_key=module_key)
            _module_metadata, rows, model = _module_payload(zipf, tenant_id=tenant_id, module_key=module_key)
            summary = _restore_summary(db, tenant_id=tenant_id, model=model, rows=rows)
            summary["total_rows"] = _preview_total(zipf, tenant_id=tenant_id, module_key=module_key, rows=rows)
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
            for module_key in _restore_order(metadata.get("module_list") or []):
                _validate_module_enabled(db, tenant_id=tenant_id, module_key=module_key)
                _module_metadata, rows, model = _module_payload(zipf, tenant_id=tenant_id, module_key=module_key)
                preview_summary = _restore_summary(db, tenant_id=tenant_id, model=model, rows=rows)
                preview_summary["total_rows"] = _preview_total(zipf, tenant_id=tenant_id, module_key=module_key, rows=rows)
                with db.begin_nested():
                    result = _restore_module_rows(db, zipf, tenant_id=tenant_id, module_key=module_key, model=model, mode=WHOLE_TENANT_RESTORE_MODE, rows=rows)
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
