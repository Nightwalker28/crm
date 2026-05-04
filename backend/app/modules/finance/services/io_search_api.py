from pathlib import Path
import logging
from datetime import date, datetime
from typing import Any

from fastapi import HTTPException, Request, UploadFile, status
from sqlalchemy import func, tuple_
from sqlalchemy.orm import Session

from app.core.access_control import get_finance_user_scope
from app.core.module_csv import build_import_summary, iter_csv_rows_from_bytes, read_upload_bytes, require_csv_headers, rows_from_csv_bytes
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
from app.modules.platform.services.crm_events import actor_payload, safe_emit_crm_event
from app.modules.finance.models import FinanceIO
from app.modules.finance.services.io_search_services import (
    IO_SEARCH_UPLOAD_DIR,
    IO_NUMBER_PAD,
    IO_NUMBER_PREFIX,
    _build_insertion_orders_query,
    _get_next_io_sequence,
    _normalize_allowed_currency,
    _normalize_text,
    _parse_decimal,
    _split_contact_name,
    create_insertion_order,
    get_finance_module_id,
    get_insertion_order_or_404,
    list_insertion_orders,
    parse_human_date,
    soft_delete_insertion_order,
    update_insertion_order,
    _serialize_finance_record_response,
    _serialize_finance_record_state,
)
from app.modules.sales.models import SalesContact, SalesOrganization

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


def _serialize_insertion_order_export_row(record: FinanceIO) -> dict:
    return {
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


def _optional_int(value: str | None) -> int | None:
    normalized = (value or "").strip()
    return int(normalized) if normalized else None


def _build_import_payload(row: dict[str, str | None]) -> dict[str, Any]:
    return {
        "io_number": (row.get("io_number") or "").strip() or None,
        "customer_name": row.get("customer_name"),
        "customer_contact_id": _optional_int(row.get("customer_contact_id")),
        "customer_organization_id": _optional_int(row.get("customer_organization_id")),
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


def _bulk_resolve_import_customers(
    db: Session,
    current_user,
    prepared_rows: list[dict[str, Any]],
) -> tuple[dict[int, SalesContact | None], dict[int, SalesOrganization | None], dict[int, str]]:
    contact_ids: set[int] = set()
    contact_emails: set[str] = set()
    contact_name_keys: set[tuple[str, str]] = set()

    for item in prepared_rows:
        payload = item["payload"]
        contact_id = payload.get("customer_contact_id")
        if contact_id is not None:
            contact_ids.add(contact_id)
            continue
        normalized_email = _normalize_text(payload.get("customer_email"))
        if normalized_email:
            contact_emails.add(normalized_email.lower())
        first_name, last_name = _split_contact_name(payload.get("customer_name"))
        if first_name and last_name:
            contact_name_keys.add((first_name.lower(), last_name.lower()))

    contacts_by_id: dict[int, SalesContact] = {}
    contacts_by_email: dict[str, SalesContact] = {}
    contacts_by_name: dict[tuple[str, str], SalesContact] = {}

    if contact_ids:
        contacts = (
            db.query(SalesContact)
            .filter(
                SalesContact.contact_id.in_(contact_ids),
                SalesContact.tenant_id == current_user.tenant_id,
                SalesContact.deleted_at.is_(None),
            )
            .all()
        )
        contacts_by_id = {contact.contact_id: contact for contact in contacts}
    if contact_emails:
        contacts = (
            db.query(SalesContact)
            .filter(
                func.lower(SalesContact.primary_email).in_(contact_emails),
                SalesContact.tenant_id == current_user.tenant_id,
                SalesContact.deleted_at.is_(None),
            )
            .all()
        )
        contacts_by_email = {contact.primary_email.lower(): contact for contact in contacts if contact.primary_email}
    if contact_name_keys:
        contacts = (
            db.query(SalesContact)
            .filter(
                tuple_(
                    func.lower(func.coalesce(SalesContact.first_name, "")),
                    func.lower(func.coalesce(SalesContact.last_name, "")),
                ).in_(contact_name_keys),
                SalesContact.tenant_id == current_user.tenant_id,
                SalesContact.deleted_at.is_(None),
            )
            .all()
        )
        contacts_by_name = {
            ((contact.first_name or "").lower(), (contact.last_name or "").lower()): contact
            for contact in contacts
        }

    contacts_by_row: dict[int, SalesContact | None] = {}
    failures: dict[int, str] = {}
    new_contacts_by_email: dict[str, SalesContact] = {}

    for item in prepared_rows:
        row_number = item["row_number"]
        payload = item["payload"]
        contact_id = payload.get("customer_contact_id")
        contact = None
        if contact_id is not None:
            contact = contacts_by_id.get(contact_id)
            if not contact:
                failures[row_number] = "Linked customer contact was not found"
                continue
        else:
            normalized_email = _normalize_text(payload.get("customer_email"))
            if normalized_email:
                contact = contacts_by_email.get(normalized_email.lower()) or new_contacts_by_email.get(normalized_email.lower())
            if contact is None:
                first_name, last_name = _split_contact_name(payload.get("customer_name"))
                if first_name and last_name:
                    contact = contacts_by_name.get((first_name.lower(), last_name.lower()))
            if contact is None and payload.get("create_customer_if_missing"):
                if not normalized_email:
                    failures[row_number] = "customer_email is required when creating a new customer contact"
                    continue
                first_name, last_name = _split_contact_name(payload.get("customer_name") or normalized_email)
                contact = SalesContact(
                    tenant_id=current_user.tenant_id,
                    first_name=first_name,
                    last_name=last_name,
                    primary_email=normalized_email,
                    assigned_to=current_user.id if current_user else None,
                )
                db.add(contact)
                db.flush()
                new_contacts_by_email[normalized_email.lower()] = contact
        contacts_by_row[row_number] = contact

    org_ids: set[int] = set()
    org_names: set[str] = set()
    for item in prepared_rows:
        row_number = item["row_number"]
        if row_number in failures:
            continue
        payload = item["payload"]
        contact = contacts_by_row.get(row_number)
        org_id = contact.organization_id if contact and contact.organization_id is not None else payload.get("customer_organization_id")
        if org_id is not None:
            org_ids.add(org_id)
        elif contact is None:
            normalized_name = _normalize_text(payload.get("customer_name"))
            if normalized_name:
                org_names.add(normalized_name.lower())

    orgs_by_id: dict[int, SalesOrganization] = {}
    orgs_by_name: dict[str, SalesOrganization] = {}
    if org_ids:
        orgs = (
            db.query(SalesOrganization)
            .filter(
                SalesOrganization.org_id.in_(org_ids),
                SalesOrganization.tenant_id == current_user.tenant_id,
                SalesOrganization.deleted_at.is_(None),
            )
            .all()
        )
        orgs_by_id = {org.org_id: org for org in orgs}
    if org_names:
        orgs = (
            db.query(SalesOrganization)
            .filter(
                func.lower(SalesOrganization.org_name).in_(org_names),
                SalesOrganization.tenant_id == current_user.tenant_id,
                SalesOrganization.deleted_at.is_(None),
            )
            .all()
        )
        orgs_by_name = {org.org_name.lower(): org for org in orgs if org.org_name}

    orgs_by_row: dict[int, SalesOrganization | None] = {}
    new_orgs_by_name: dict[str, SalesOrganization] = {}
    for item in prepared_rows:
        row_number = item["row_number"]
        if row_number in failures:
            continue
        payload = item["payload"]
        contact = contacts_by_row.get(row_number)
        org = None
        org_id = contact.organization_id if contact and contact.organization_id is not None else payload.get("customer_organization_id")
        if org_id is not None:
            org = orgs_by_id.get(org_id)
            if not org:
                failures[row_number] = "Linked customer organization was not found"
                continue
        elif contact is None:
            normalized_name = _normalize_text(payload.get("customer_name"))
            if normalized_name:
                org = orgs_by_name.get(normalized_name.lower()) or new_orgs_by_name.get(normalized_name.lower())
                if org is None and payload.get("create_customer_if_missing"):
                    org = SalesOrganization(
                        tenant_id=current_user.tenant_id,
                        org_name=normalized_name,
                        assigned_to=current_user.id if current_user else None,
                    )
                    db.add(org)
                    db.flush()
                    new_orgs_by_name[normalized_name.lower()] = org
        orgs_by_row[row_number] = org

    return contacts_by_row, orgs_by_row, failures


def _resolved_customer_name(
    payload: dict[str, Any],
    contact: SalesContact | None,
    organization: SalesOrganization | None,
) -> str | None:
    if contact:
        full_name = " ".join([part for part in (contact.first_name, contact.last_name) if part]).strip()
        return full_name or contact.primary_email
    if organization:
        return organization.org_name
    return _normalize_text(payload.get("customer_name"))


def _create_imported_insertion_order(
    db: Session,
    current_user,
    *,
    module_id: int,
    payload: dict[str, Any],
    contact: SalesContact | None,
    organization: SalesOrganization | None,
) -> FinanceIO:
    requested_io_number = _normalize_text(payload.get("io_number"))
    if requested_io_number:
        io_number = requested_io_number
        file_sequence_label = requested_io_number
    else:
        next_io_sequence = _get_next_io_sequence(db)
        io_number = f"{IO_NUMBER_PREFIX}{next_io_sequence:0{IO_NUMBER_PAD}d}"
        file_sequence_label = str(next_io_sequence)

    customer_name = _resolved_customer_name(payload, contact, organization)
    if not customer_name:
        raise ValueError("customer_name is required")

    record = FinanceIO(
        tenant_id=current_user.tenant_id,
        module_id=module_id,
        user_id=current_user.id if current_user else None,
        io_number=io_number,
        file_name=payload.get("external_reference") or f"insertion-order-{file_sequence_label}.manual",
        customer_contact_id=contact.contact_id if contact else None,
        customer_organization_id=organization.org_id if organization else None,
        customer_name=customer_name,
        counterparty_reference=_normalize_text(payload.get("counterparty_reference")),
        external_reference=_normalize_text(payload.get("external_reference")),
        issue_date=parse_human_date(payload["issue_date"]) if payload.get("issue_date") else datetime.utcnow().date(),
        effective_date=parse_human_date(payload["effective_date"]) if payload.get("effective_date") else None,
        due_date=parse_human_date(payload["due_date"]) if payload.get("due_date") else None,
        start_date=parse_human_date(payload["start_date"]) if payload.get("start_date") else None,
        end_date=parse_human_date(payload["end_date"]) if payload.get("end_date") else None,
        status=_normalize_text(payload.get("status")) or "draft",
        currency=_normalize_allowed_currency(db, current_user, payload.get("currency")),
        subtotal_amount=_parse_decimal(payload.get("subtotal_amount")),
        tax_amount=_parse_decimal(payload.get("tax_amount")),
        total_amount=_parse_decimal(payload.get("total_amount")),
        notes=_normalize_text(payload.get("notes")),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def _resolve_io_download_path(record: FinanceIO) -> Path:
    allowed_root = IO_SEARCH_UPLOAD_DIR.resolve()
    if record.file_path:
        file_path = Path(record.file_path).resolve()
    else:
        file_name = (record.file_name or "").strip()
        if not file_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid file location.",
            )
        file_path = (allowed_root / file_name).resolve()

    try:
        file_path.relative_to(allowed_root)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file location.",
        ) from exc
    return file_path


def import_insertion_orders_csv_bytes(
    db: Session,
    current_user,
    *,
    file_bytes: bytes,
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

    headers, row_iter = iter_csv_rows_from_bytes(file_bytes)
    require_csv_headers(headers, required={"customer_name"})

    import_io_numbers: list[str] = []
    total_rows = 0
    failures: list[dict[str, str | int | None]] = []
    valid_rows: list[tuple[int, dict[str, str | None]]] = []
    for index, row in enumerate(row_iter, start=2):
        total_rows += 1
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
            FinanceIO.tenant_id == current_user.tenant_id,
            FinanceIO.module_id == module_id,
            FinanceIO.io_number.in_(import_io_numbers),
            FinanceIO.deleted_at.is_(None),
        )
        .all()
    }
    detection = detect_duplicates(import_io_numbers, existing_values=set(existing_by_io_number))
    duplicate_io_numbers = detection.duplicate_values
    if duplicate_io_numbers and duplicate_mode is None and not any((replace_duplicates, skip_duplicates, create_new_records)) and default_duplicate_mode is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
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
    prepared_rows: list[dict[str, Any]] = []

    for index, row in valid_rows:
        try:
            row_io_number = (row.get("io_number") or "").strip() or None
            payload = _build_import_payload(row)
            existing = existing_by_io_number.get(row_io_number) if row_io_number else None
            prepared_rows.append(
                {
                    "row_number": index,
                    "row": row,
                    "row_io_number": row_io_number,
                    "payload": payload,
                    "existing": existing,
                }
            )
        except Exception as exc:
            logger.warning("Insertion order import failed on row %s: %s", index, exc)
            failures.append(
                {
                    "row_number": index,
                    "record_identifier": row_io_number or (row.get("customer_name") or "").strip() or None,
                    "reason": str(exc),
                }
            )

    create_rows = [
        item
        for item in prepared_rows
        if not item["existing"]
    ]
    contacts_by_row, orgs_by_row, resolution_failures = _bulk_resolve_import_customers(
        db,
        current_user,
        create_rows,
    )
    for item in create_rows:
        row_number = item["row_number"]
        if row_number in resolution_failures:
            row = item["row"]
            logger.warning("Insertion order import failed on row %s: %s", row_number, resolution_failures[row_number])
            failures.append(
                {
                    "row_number": row_number,
                    "record_identifier": item["row_io_number"] or (row.get("customer_name") or "").strip() or None,
                    "reason": resolution_failures[row_number],
                }
            )

    for item in prepared_rows:
        index = item["row_number"]
        row = item["row"]
        row_io_number = item["row_io_number"]
        payload = item["payload"]
        existing = item["existing"]
        try:
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
            if index in resolution_failures:
                continue
            _create_imported_insertion_order(
                db,
                current_user,
                module_id=module_id,
                payload=payload,
                contact=contacts_by_row.get(index),
                organization=orgs_by_row.get(index),
            )
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
        total_rows=total_rows,
        new_rows=new_rows,
        skipped_rows=skipped_rows,
        overwritten_rows=overwritten_rows,
        merged_rows=merged_rows,
        failures=failures,
    )


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
    if file_bytes is None:
        if file is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Import file is required.",
            )
        file_bytes = await read_upload_bytes(file, allowed_extensions={"csv"})

    return import_insertion_orders_csv_bytes(
        db,
        current_user,
        file_bytes=file_bytes,
        duplicate_mode=duplicate_mode,
        default_duplicate_mode=default_duplicate_mode,
        replace_duplicates=replace_duplicates,
        skip_duplicates=skip_duplicates,
        create_new_records=create_new_records,
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

    try:
        file_path = _resolve_io_download_path(record)
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
        [_serialize_finance_record_response(record, request=request, current_user=current_user) for record in records],
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
    query = _build_insertion_orders_query(
        db,
        tenant_id=current_user.tenant_id,
        module_id=module_id,
        user_id=user_scope.user_id_filter,
        search=search,
        status_filter=status_filter,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    total_count = query.order_by(None).count()
    records = query.order_by(FinanceIO.updated_at.desc()).yield_per(500)
    return (
        dict_rows_to_csv_bytes(
            headers=INSERTION_ORDER_EXPORT_HEADERS,
            rows=(_serialize_insertion_order_export_row(record) for record in records),
        ),
        total_count,
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

    return _serialize_finance_record_response(record, request=request, current_user=current_user)


def _is_overdue_invoice(record: FinanceIO) -> bool:
    status_value = _finance_record_status(record).strip().lower()
    if status_value in {"paid", "completed", "closed", "cancelled", "void"}:
        return False
    if status_value in {"overdue", "past_due"}:
        return True
    return bool(record.due_date and record.due_date < date.today())


def _emit_invoice_overdue_event_if_needed(db: Session, *, current_user, record: FinanceIO) -> None:
    if not _is_overdue_invoice(record):
        return
    safe_emit_crm_event(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        event_type="invoice.overdue",
        entity_type="finance_insertion_order",
        entity_id=record.id,
        payload={
            **actor_payload(current_user),
            "invoice_number": record.io_number,
            "customer_name": _finance_record_customer_name(record),
            "amount": float(record.total_amount) if record.total_amount is not None else None,
            "currency": _finance_record_currency(record),
            "due_date": _date_to_iso(record.due_date),
            "status": _finance_record_status(record),
            "href": f"/dashboard/finance/insertion-orders?ioId={record.id}",
        },
    )


def create_generic_insertion_order(
    db: Session,
    current_user,
    *,
    data: dict,
    request: Request | None,
):
    module_id = get_finance_module_id(db)
    record = create_insertion_order(db, module_id=module_id, current_user=current_user, data=data)
    serialized = _serialize_finance_record_response(record, request=request, current_user=current_user)
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key="finance_insertion_orders",
        entity_type="finance_insertion_order",
        entity_id=record.id,
        action="create",
        description=f"Created insertion order {record.io_number}",
        after_state=_serialize_finance_record_state(record, current_user=current_user),
    )
    _emit_invoice_overdue_event_if_needed(db, current_user=current_user, record=record)
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
    before_state = _serialize_finance_record_state(record, current_user=current_user)
    updated = update_insertion_order(db, record=record, current_user=current_user, data=data)
    serialized = _serialize_finance_record_response(updated, request=request, current_user=current_user)
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
        after_state=_serialize_finance_record_state(updated, current_user=current_user),
    )
    _emit_invoice_overdue_event_if_needed(db, current_user=current_user, record=updated)
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
    before_state = _serialize_finance_record_state(record, current_user=current_user)
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
