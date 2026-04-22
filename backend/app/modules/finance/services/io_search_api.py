from pathlib import Path
import logging

from fastapi import HTTPException, Request, UploadFile, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.core.access_control import get_finance_user_scope
from app.core.module_csv import build_import_summary, read_csv_upload, require_csv_headers
from app.core.module_export import dict_rows_to_csv_bytes
from app.core.duplicates import (
    DuplicateMode,
    detect_duplicates,
    ensure_single_duplicate_action,
    resolve_duplicate_mode,
    should_merge_value,
)
from app.core.pagination import Pagination, build_paged_response
from app.modules.platform.services.activity_logs import log_activity
from app.modules.finance.models import FinanceIO
from app.modules.finance.services.io_search_services import (
    IO_SEARCH_UPLOAD_DIR,
    _build_insertion_orders_query,
    create_insertion_order,
    get_finance_module_id,
    get_insertion_order_or_404,
    list_insertion_orders,
    soft_delete_insertion_order,
    update_insertion_order,
    _serialize_finance_record,
)

logger = logging.getLogger(__name__)
INSERTION_ORDER_EXPORT_HEADERS = [
    "id",
    "io_number",
    "customer_name",
    "customer_contact_id",
    "customer_organization_id",
    "counterparty_reference",
    "external_reference",
    "issue_date",
    "effective_date",
    "due_date",
    "start_date",
    "end_date",
    "status",
    "currency",
    "subtotal_amount",
    "tax_amount",
    "total_amount",
    "notes",
    "updated_at",
]


async def import_insertion_orders_csv(
    db: Session,
    current_user,
    file: UploadFile | None = None,
    *,
    file_bytes: bytes | None = None,
    duplicate_mode: str | None = None,
    default_duplicate_mode: str | None = None,
    replace_duplicates: bool,
    skip_duplicates: bool,
    create_new_records: bool,
):
    module_id = get_finance_module_id(db)
    try:
        mode = resolve_duplicate_mode(
            duplicate_mode=duplicate_mode,
            default_mode=default_duplicate_mode,
            replace_duplicates=replace_duplicates,
            skip_duplicates=skip_duplicates,
            create_new_records=create_new_records,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )

    if file_bytes is not None:
        from app.core.module_csv import rows_from_csv_bytes
        headers, rows = rows_from_csv_bytes(file_bytes)
    elif file is not None:
        headers, rows = await read_csv_upload(file)
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Import file is required.",
        )
    require_csv_headers(headers, required={"customer_name"})

    import_io_numbers: list[str] = []
    failures: list[dict[str, str | int | None]] = []
    valid_rows: list[tuple[int, dict[str, str | None]]] = []
    for index, row in enumerate(rows, start=2):
        if not (row.get("customer_name") or "").strip():
            failures.append(
                {
                    "row_number": index,
                    "record_identifier": (row.get("io_number") or "").strip() or None,
                    "reason": "customer_name is required.",
                }
            )
            continue
        io_number = (row.get("io_number") or "").strip()
        if io_number:
            import_io_numbers.append(io_number)
        valid_rows.append((index, row))

    existing_by_io_number = {
        row.io_number: row
        for row in db.query(FinanceIO)
        .filter(
            FinanceIO.module_id == module_id,
            FinanceIO.io_number.in_(import_io_numbers),
            FinanceIO.deleted_at.is_(None),
        )
        .all()
    }
    detection = detect_duplicates(import_io_numbers, existing_values=set(existing_by_io_number))
    duplicate_io_numbers = detection.duplicate_values
    if duplicate_io_numbers and duplicate_mode is None and not any((replace_duplicates, skip_duplicates, create_new_records)) and default_duplicate_mode is None:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={
                "message": (
                    "Duplicate insertion orders detected. Resend with "
                    "replace_duplicates=true to overwrite them, "
                    "skip_duplicates=true to leave the existing IOs untouched, or "
                    "create_new_records=true to create new rows with generated IO numbers."
                ),
                "duplicate_io_numbers": duplicate_io_numbers,
                "requires_confirmation": True,
            },
        )

    new_rows = overwritten_rows = merged_rows = skipped_rows = 0

    for index, row in valid_rows:
        try:
            row_io_number = (row.get("io_number") or "").strip() or None
            payload = {
                "io_number": row_io_number,
                "customer_name": row.get("customer_name"),
                "customer_contact_id": int(row["customer_contact_id"]) if (row.get("customer_contact_id") or "").strip() else None,
                "customer_organization_id": int(row["customer_organization_id"]) if (row.get("customer_organization_id") or "").strip() else None,
                "create_customer_if_missing": str(row.get("create_customer_if_missing") or "").strip().lower() in {"1", "true", "yes"},
                "customer_email": (row.get("customer_email") or "").strip() or None,
                "counterparty_reference": (row.get("counterparty_reference") or "").strip() or None,
                "external_reference": (row.get("external_reference") or "").strip() or None,
                "issue_date": (row.get("issue_date") or "").strip() or None,
                "effective_date": (row.get("effective_date") or "").strip() or None,
                "due_date": (row.get("due_date") or "").strip() or None,
                "start_date": (row.get("start_date") or "").strip() or None,
                "end_date": (row.get("end_date") or "").strip() or None,
                "status": (row.get("status") or "").strip() or "draft",
                "currency": (row.get("currency") or "").strip() or "USD",
                "subtotal_amount": (row.get("subtotal_amount") or "").strip() or None,
                "tax_amount": (row.get("tax_amount") or "").strip() or None,
                "total_amount": (row.get("total_amount") or "").strip() or None,
                "notes": (row.get("notes") or "").strip() or None,
            }
            existing = existing_by_io_number.get(row_io_number) if row_io_number else None
            if existing and mode == DuplicateMode.skip:
                skipped_rows += 1
                continue
            if existing and mode == DuplicateMode.overwrite:
                update_insertion_order(db, record=existing, current_user=current_user, data=payload)
                overwritten_rows += 1
                continue
            if existing and mode == DuplicateMode.merge:
                merge_payload = {
                    field: value
                    for field, value in payload.items()
                    if should_merge_value(getattr(existing, field, None), value)
                }
                if merge_payload:
                    update_insertion_order(db, record=existing, current_user=current_user, data=merge_payload)
                merged_rows += 1
                continue
            create_insertion_order(db, module_id=module_id, current_user=current_user, data=payload)
            new_rows += 1
        except Exception as exc:
            logger.warning("Insertion order import failed on row %s: %s", index, exc)
            failures.append(
                {
                    "row_number": index,
                    "record_identifier": row_io_number or (row.get("customer_name") or "").strip() or None,
                    "reason": str(exc),
                }
            )

    return build_import_summary(
        total_rows=len(rows),
        new_rows=new_rows,
        skipped_rows=skipped_rows,
        overwritten_rows=overwritten_rows,
        merged_rows=merged_rows,
        failures=failures,
    )


def get_downloadable_insertion_order(db: Session, current_user, io_number: str) -> tuple[Path, str]:
    module_id = get_finance_module_id(db)
    user_scope = get_finance_user_scope(db, current_user)
    user_id_filter = user_scope.user_id_filter

    query = db.query(FinanceIO).filter(
        FinanceIO.module_id == module_id,
        FinanceIO.io_number == io_number,
        FinanceIO.deleted_at.is_(None),
    )
    if user_id_filter is not None:
        query = query.filter(FinanceIO.user_id == user_id_filter)

    record = query.first()
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Insertion order not found or not accessible.",
        )

    path_str = record.file_path or str(IO_SEARCH_UPLOAD_DIR / record.file_name)
    file_path = Path(path_str).resolve()

    try:
        allowed_root = IO_SEARCH_UPLOAD_DIR.resolve()
        if allowed_root not in file_path.parents and file_path != allowed_root:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid file location.",
            )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to resolve file path.",
        ) from exc

    if not file_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found.",
        )

    return file_path, record.file_name


def list_generic_insertion_orders_page(
    db: Session,
    current_user,
    *,
    pagination: Pagination,
    request: Request | None,
    search: str | None = None,
    status_filter: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
):
    module_id = get_finance_module_id(db)
    user_scope = get_finance_user_scope(db, current_user)
    records, total_count = list_insertion_orders(
        db,
        tenant_id=current_user.tenant_id,
        module_id=module_id,
        user_id=user_scope.user_id_filter,
        pagination=pagination,
        search=search,
        status_filter=status_filter,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    return build_paged_response(
        [_serialize_finance_record(record, request=request, current_user=current_user) for record in records],
        total_count,
        pagination,
    )


def export_generic_insertion_orders(
    db: Session,
    current_user,
    *,
    search: str | None = None,
    status_filter: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> tuple[bytes, int]:
    module_id = get_finance_module_id(db)
    user_scope = get_finance_user_scope(db, current_user)
    records = _build_insertion_orders_query(
        db,
        tenant_id=current_user.tenant_id,
        module_id=module_id,
        user_id=user_scope.user_id_filter,
        search=search,
        status_filter=status_filter,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    ).order_by(FinanceIO.updated_at.desc()).all()
    return (
        dict_rows_to_csv_bytes(
            headers=INSERTION_ORDER_EXPORT_HEADERS,
            rows=(
                {
                    "id": record.id,
                    "io_number": record.io_number or "",
                    "customer_name": record.customer_name or "",
                    "customer_contact_id": record.customer_contact_id or "",
                    "customer_organization_id": record.customer_organization_id or "",
                    "counterparty_reference": record.counterparty_reference or "",
                    "external_reference": record.external_reference or "",
                    "issue_date": record.issue_date.isoformat() if record.issue_date else "",
                    "effective_date": record.effective_date.isoformat() if record.effective_date else "",
                    "due_date": record.due_date.isoformat() if record.due_date else "",
                    "start_date": record.start_date.isoformat() if record.start_date else "",
                    "end_date": record.end_date.isoformat() if record.end_date else "",
                    "status": record.status or "",
                    "currency": record.currency or "",
                    "subtotal_amount": record.subtotal_amount if record.subtotal_amount is not None else "",
                    "tax_amount": record.tax_amount if record.tax_amount is not None else "",
                    "total_amount": record.total_amount if record.total_amount is not None else "",
                    "notes": record.notes or "",
                    "updated_at": record.updated_at.isoformat() if record.updated_at else "",
                }
                for record in records
            ),
        ),
        len(records),
    )


def get_generic_insertion_order(
    db: Session,
    current_user,
    *,
    io_id: int,
    request: Request | None,
):
    module_id = get_finance_module_id(db)
    user_scope = get_finance_user_scope(db, current_user)
    try:
        record = get_insertion_order_or_404(
            db,
            module_id=module_id,
            io_id=io_id,
            user_id=user_scope.user_id_filter,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return _serialize_finance_record(record, request=request, current_user=current_user)


def create_generic_insertion_order(
    db: Session,
    current_user,
    *,
    data: dict,
    request: Request | None,
):
    module_id = get_finance_module_id(db)
    record = create_insertion_order(db, module_id=module_id, current_user=current_user, data=data)
    serialized = _serialize_finance_record(record, request=request, current_user=current_user)
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key="finance_insertion_orders",
        entity_type="finance_insertion_order",
        entity_id=record.id,
        action="create",
        description=f"Created insertion order {record.io_number}",
        after_state=serialized,
    )
    return serialized


def update_generic_insertion_order(
    db: Session,
    current_user,
    *,
    io_id: int,
    data: dict,
    request: Request | None,
):
    module_id = get_finance_module_id(db)
    user_scope = get_finance_user_scope(db, current_user)
    try:
        record = get_insertion_order_or_404(
        db,
        tenant_id=current_user.tenant_id,
        module_id=module_id,
            io_id=io_id,
            user_id=user_scope.user_id_filter,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    before_state = _serialize_finance_record(record, request=request, current_user=current_user)
    updated = update_insertion_order(db, record=record, current_user=current_user, data=data)
    serialized = _serialize_finance_record(updated, request=request, current_user=current_user)
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key="finance_insertion_orders",
        entity_type="finance_insertion_order",
        entity_id=updated.id,
        action="update",
        description=f"Updated insertion order {updated.io_number}",
        before_state=before_state,
        after_state=serialized,
    )
    return serialized


def delete_generic_insertion_order(
    db: Session,
    current_user,
    *,
    io_id: int,
):
    module_id = get_finance_module_id(db)
    user_scope = get_finance_user_scope(db, current_user)
    try:
        record = get_insertion_order_or_404(
        db,
        tenant_id=current_user.tenant_id,
        module_id=module_id,
            io_id=io_id,
            user_id=user_scope.user_id_filter,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    before_state = _serialize_finance_record(record, request=None, current_user=current_user)
    soft_delete_insertion_order(db, record=record)
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key="finance_insertion_orders",
        entity_type="finance_insertion_order",
        entity_id=record.id,
        action="soft_delete",
        description=f"Moved insertion order {record.io_number} to recycle bin",
        before_state=before_state,
    )
