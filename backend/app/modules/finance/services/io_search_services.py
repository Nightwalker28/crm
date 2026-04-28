from __future__ import annotations
import os
import re

from datetime import datetime, date
from decimal import Decimal, InvalidOperation
from io import BytesIO
from pathlib import Path
from typing import Any, IO

from docx import Document
import pdfplumber
from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session

from app.core.module_search import apply_ranked_search
from app.core.module_filters import apply_filter_conditions
from app.core.postgres_search import searchable_text
from app.modules.finance.models import FinanceIO
from app.modules.platform.services.custom_fields import (
    build_custom_field_filter_map,
    hydrate_custom_field_record,
    hydrate_custom_field_records,
    load_custom_field_values_with_fallback,
    save_custom_field_values,
    validate_custom_field_payload,
)
from app.modules.sales.models import SalesContact, SalesOrganization
from app.modules.user_management.services.profile import get_company_operating_currencies
from app.modules.user_management.models import Module

# Single folder override via env
_upload_dir = os.getenv("IO_SEARCH_UPLOAD_DIR")
if not _upload_dir:
    raise RuntimeError("IO_SEARCH_UPLOAD_DIR environment variable is required")
IO_SEARCH_UPLOAD_DIR = Path(_upload_dir).resolve()
IO_SEARCH_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# IO module_id in the modules table
DEFAULT_MODULE_ID = 2
FINANCE_MODULE_KEY = "finance_io"
DEFAULT_IO_STATUS = "draft"
DEFAULT_IO_CURRENCY = "USD"

MONTH_ALIASES: dict[str, int] = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}

IO_NUMBER_PREFIX = "IOAI"
IO_NUMBER_PAD = 5
IO_NUMBER_REGEX = re.compile(rf"^{IO_NUMBER_PREFIX}(\d+)$")


def get_finance_module_id(db: Session) -> int:
    module_id = db.query(Module.id).filter(Module.name == FINANCE_MODULE_KEY).scalar()
    return int(module_id) if module_id is not None else DEFAULT_MODULE_ID


def _get_max_io_sequence(
    db: Session,
    prefix: str = IO_NUMBER_PREFIX,
    *,
    tenant_id: int | None = None,
) -> int:
    """Return the highest existing io_number sequence for the prefix."""
    where_clause = "io_number ~ :pattern"
    params: dict[str, Any] = {
        "offset": len(prefix) + 1,
        "pattern": f"^{re.escape(prefix)}\\d+$",
    }
    if tenant_id is not None:
        where_clause = f"{where_clause} AND tenant_id = :tenant_id"
        params["tenant_id"] = tenant_id

    result = db.execute(
        text(
            f"""
            SELECT COALESCE(MAX(CAST(SUBSTRING(io_number FROM :offset) AS BIGINT)), 0)
            FROM finance_io
            WHERE {where_clause}
            """
        ),
        params,
    ).scalar()
    return int(result or 0)


def _get_next_io_sequence(db: Session) -> int:
    """Allocate the next insertion-order number from the database sequence."""
    result = db.execute(text("SELECT nextval('finance_io_number_seq')")).scalar()
    return int(result or 0)


def sanitize_file_name(file_name: str) -> str:
    """Normalize file names by stripping directories and replacing whitespace with dashes."""
    name_only = Path(file_name).name
    stem, suffix = os.path.splitext(name_only)
    sanitized_stem = re.sub(r"\s+", "-", stem.strip())
    return f"{sanitized_stem}{suffix}"

def _parse_decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return value
    normalized = str(value).strip()
    if not normalized:
        return None
    cleaned = re.sub(r"[^\d.\-]", "", normalized)
    if not cleaned:
        return None
    try:
        return Decimal(cleaned)
    except (InvalidOperation, ValueError):
        return None


def _normalize_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _date_to_iso(value: date | datetime | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    return value.isoformat()


def _finance_record_customer_name(record: FinanceIO) -> str:
    linked_contact = getattr(record, "customer_contact", None)
    linked_customer = getattr(record, "customer_organization", None)
    return (
        _normalize_text(
            " ".join(
                [
                    part
                    for part in (
                        getattr(linked_contact, "first_name", None),
                        getattr(linked_contact, "last_name", None),
                    )
                    if part
                ]
            )
        )
        or _normalize_text(getattr(linked_contact, "primary_email", None))
        or
        _normalize_text(getattr(linked_customer, "org_name", None))
        or
        _normalize_text(record.customer_name)
        or _normalize_text(record.file_name)
        or "Untitled Insertion Order"
    )


def _finance_record_status(record: FinanceIO) -> str:
    return _normalize_text(record.status) or DEFAULT_IO_STATUS


def _finance_record_currency(record: FinanceIO) -> str:
    return _normalize_text(record.currency) or DEFAULT_IO_CURRENCY


def _normalize_allowed_currency(db: Session, current_user, currency: str | None) -> str:
    allowed = get_company_operating_currencies(db, current_user)
    normalized = (_normalize_text(currency) or allowed[0]).upper()
    if normalized not in allowed:
        raise ValueError(f"Currency must be one of: {', '.join(allowed)}")
    return normalized


def _finance_record_total(record: FinanceIO) -> Decimal | None:
    return record.total_amount


def _serialize_finance_record_state(record: FinanceIO, *, current_user=None) -> dict[str, Any]:
    full_name = None
    if getattr(record, "assigned_user", None):
        first_name = getattr(record.assigned_user, "first_name", None)
        last_name = getattr(record.assigned_user, "last_name", None)
        full_name = " ".join([part for part in (first_name, last_name) if part]) or None

    user_name = "You" if current_user and record.user_id == current_user.id else full_name
    total_amount = _finance_record_total(record)

    return {
        "id": record.id,
        "io_number": record.io_number,
        "customer_name": _finance_record_customer_name(record),
        "customer_contact_id": getattr(record, "customer_contact_id", None),
        "customer_organization_id": getattr(record, "customer_organization_id", None),
        "counterparty_reference": _normalize_text(record.counterparty_reference),
        "external_reference": _normalize_text(record.external_reference),
        "issue_date": _date_to_iso(record.issue_date or record.created_at),
        "effective_date": _date_to_iso(record.effective_date or record.start_date),
        "due_date": _date_to_iso(record.due_date or record.end_date),
        "start_date": _date_to_iso(record.start_date),
        "end_date": _date_to_iso(record.end_date),
        "status": _finance_record_status(record),
        "currency": _finance_record_currency(record),
        "subtotal_amount": float(record.subtotal_amount) if record.subtotal_amount is not None else None,
        "tax_amount": float(record.tax_amount) if record.tax_amount is not None else None,
        "total_amount": float(total_amount) if total_amount is not None else None,
        "notes": _normalize_text(record.notes),
        "custom_fields": record.custom_data or None,
        "file_name": _normalize_text(record.file_name),
        "user_name": user_name,
        "photo_url": getattr(getattr(record, "assigned_user", None), "photo_url", None),
        "updated_at": _date_to_iso(record.updated_at),
    }


def _serialize_finance_record_response(record: FinanceIO, *, request, current_user) -> dict[str, Any]:
    data = _serialize_finance_record_state(record, current_user=current_user)
    data["file_url"] = (
        str(request.url_for("download_insertion_order_file", io_number=record.io_number))
        if request is not None and record.io_number
        else None
    )
    return data



def _split_contact_name(value: str | None) -> tuple[str | None, str | None]:
    normalized = _normalize_text(value)
    if not normalized:
        return None, None
    parts = normalized.split()
    if len(parts) == 1:
        return parts[0], None
    return parts[0], " ".join(parts[1:])


def _resolve_customer_contact(
    db: Session,
    *,
    current_user,
    customer_contact_id: int | None,
    customer_name: str | None,
    customer_email: str | None,
    create_if_missing: bool,
) -> SalesContact | None:
    normalized_name = _normalize_text(customer_name)
    normalized_email = _normalize_text(customer_email)

    if customer_contact_id is not None:
        contact = (
            db.query(SalesContact)
            .filter(
                SalesContact.contact_id == customer_contact_id,
                SalesContact.tenant_id == current_user.tenant_id,
                SalesContact.deleted_at.is_(None),
            )
            .first()
        )
        if not contact:
            raise ValueError("Linked customer contact was not found")
        return contact

    if normalized_email:
        existing_by_email = (
            db.query(SalesContact)
            .filter(
                func.lower(SalesContact.primary_email) == normalized_email.lower(),
                SalesContact.tenant_id == current_user.tenant_id,
                SalesContact.deleted_at.is_(None),
            )
            .first()
        )
        if existing_by_email:
            return existing_by_email

    if normalized_name:
        first_name, last_name = _split_contact_name(normalized_name)
        if first_name and last_name:
            existing_by_name = (
                db.query(SalesContact)
                .filter(
                    func.lower(func.coalesce(SalesContact.first_name, "")) == first_name.lower(),
                    func.lower(func.coalesce(SalesContact.last_name, "")) == last_name.lower(),
                    SalesContact.tenant_id == current_user.tenant_id,
                    SalesContact.deleted_at.is_(None),
                )
                .first()
            )
            if existing_by_name:
                return existing_by_name

    if not create_if_missing:
        return None

    if not normalized_email:
        raise ValueError("customer_email is required when creating a new customer contact")

    first_name, last_name = _split_contact_name(normalized_name or normalized_email)
    contact = SalesContact(
        tenant_id=current_user.tenant_id,
        first_name=first_name,
        last_name=last_name,
        primary_email=normalized_email,
        assigned_to=current_user.id if current_user else None,
    )
    db.add(contact)
    db.flush()
    return contact


def _resolve_customer_organization(
    db: Session,
    *,
    current_user,
    customer_name: str | None,
    customer_organization_id: int | None,
    create_if_missing: bool,
) -> SalesOrganization | None:
    normalized_name = _normalize_text(customer_name)

    if customer_organization_id is not None:
        organization = (
            db.query(SalesOrganization)
            .filter(
                SalesOrganization.org_id == customer_organization_id,
                SalesOrganization.tenant_id == current_user.tenant_id,
                SalesOrganization.deleted_at.is_(None),
            )
            .first()
        )
        if not organization:
            raise ValueError("Linked customer organization was not found")
        return organization

    if not normalized_name:
        return None

    existing = (
        db.query(SalesOrganization)
        .filter(
            func.lower(SalesOrganization.org_name) == normalized_name.lower(),
            SalesOrganization.tenant_id == current_user.tenant_id,
            SalesOrganization.deleted_at.is_(None),
        )
        .first()
    )
    if existing:
        return existing

    if not create_if_missing:
        return None

    organization = SalesOrganization(
        tenant_id=current_user.tenant_id,
        org_name=normalized_name,
        assigned_to=current_user.id if current_user else None,
    )
    db.add(organization)
    db.flush()
    return organization

def _parse_docx_bytes(
    file_name: str,
    docx_bytes: bytes,
    destination_dir: Path | None,
) -> list[dict[str, Any]]:
    """Parse one docx payload, persist to disk if requested, and return flattened records."""
    original_name = Path(file_name).name
    sanitized_name = sanitize_file_name(original_name)

    target_dir = destination_dir or IO_SEARCH_UPLOAD_DIR

    if destination_dir:
        destination_dir.mkdir(parents=True, exist_ok=True)
        destination_path = target_dir / sanitized_name
        destination_path.write_bytes(docx_bytes)

    tables = docx_tables_to_dicts(BytesIO(docx_bytes))

    records = []
    for table_dict in tables:
        record = {
            "file_name": original_name,
            "file_path": str(target_dir / sanitized_name),
        }
        record.update(table_dict)
        records.append(record)

    return records


def _parse_pdf_bytes(
    file_name: str,
    pdf_bytes: bytes,
    destination_dir: Path | None,
) -> list[dict[str, Any]]:
    """Parse one PDF payload, persist to disk if requested, and return flattened records."""
    original_name = Path(file_name).name
    sanitized_name = sanitize_file_name(original_name)

    target_dir = destination_dir or IO_SEARCH_UPLOAD_DIR

    if destination_dir:
        destination_dir.mkdir(parents=True, exist_ok=True)
        destination_path = target_dir / sanitized_name
        destination_path.write_bytes(pdf_bytes)

    tables = pdf_tables_to_dicts(BytesIO(pdf_bytes))

    records = []
    for table_dict in tables:
        record = {
            "file_name": original_name,
            "file_path": str(target_dir / sanitized_name),
        }
        record.update(table_dict)
        records.append(record)

    return records


def docx_tables_to_dicts(docx_source: IO[bytes] | str | Path) -> list[dict[str, Any]]:
    """
    Return a list of dicts representing all tables in one docx file.

    docx_source can be a path or a file-like object (e.g. ZipExtFile).
    """
    doc = Document(docx_source)
    tables_data: list[dict[str, Any]] = []

    for table in doc.tables:
        table_data: dict[str, Any] = {}

        for row in table.rows:
            cells = [c.text.strip() for c in row.cells]

            # expect at least two cells per row
            if len(cells) < 2:
                continue

            label = cells[0].strip()
            value = cells[1].strip()

            if not label:
                continue

            # if the same label appears more than once, store as list
            if label in table_data:
                existing = table_data[label]
                if isinstance(existing, list):
                    existing.append(value)
                else:
                    table_data[label] = [existing, value]
            else:
                table_data[label] = value

        if table_data:
            tables_data.append(table_data)

    return tables_data


def pdf_tables_to_dicts(pdf_source: IO[bytes] | str | Path) -> list[dict[str, Any]]:
    """
    Return a list of dicts representing all tables in one PDF file.

    pdf_source can be a path or a file-like object.
    """
    tables_data: list[dict[str, Any]] = []

    with pdfplumber.open(pdf_source) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables() or []:
                table_data: dict[str, Any] = {}
                for row in table:
                    # expect at least two cells per row
                    if not row or len(row) < 2:
                        continue

                    label = (row[0] or "").strip()
                    value = (row[1] or "").strip()

                    if not label:
                        continue

                    if label in table_data:
                        existing = table_data[label]
                        if isinstance(existing, list):
                            existing.append(value)
                        else:
                            table_data[label] = [existing, value]
                    else:
                        table_data[label] = value

                if table_data:
                    tables_data.append(table_data)

    return tables_data


def parse_docx_files(
    files: list[tuple[str, bytes]],
    save_dir: Path | None = None,
) -> list[dict[str, Any]]:
    """Process a collection of docx payloads and return flattened records."""
    all_records: list[dict[str, Any]] = []
    destination_dir = save_dir

    for file_name, docx_bytes in files:
        all_records.extend(_parse_docx_bytes(file_name, docx_bytes, destination_dir))

    return all_records


def parse_pdf_files(
    files: list[tuple[str, bytes]],
    save_dir: Path | None = None,
) -> list[dict[str, Any]]:
    """Process a collection of PDF payloads and return flattened records."""
    all_records: list[dict[str, Any]] = []
    destination_dir = save_dir

    for file_name, pdf_bytes in files:
        all_records.extend(_parse_pdf_bytes(file_name, pdf_bytes, destination_dir))

    return all_records


def parse_io_files(
    files: list[tuple[str, bytes]],
    save_dir: Path | None = None,
) -> list[dict[str, Any]]:
    """
    Process a collection of docx or PDF payloads and return flattened records.
    """
    all_records: list[dict[str, Any]] = []
    for file_name, payload in files:
        suffix = Path(file_name).suffix.lower()
        try:
            if suffix == ".docx":
                all_records.extend(_parse_docx_bytes(file_name, payload, save_dir))
            elif suffix == ".pdf":
                all_records.extend(_parse_pdf_bytes(file_name, payload, save_dir))
            else:
                raise ValueError(f"Unsupported file type for {file_name}")
        except ValueError:
            raise
        except Exception as exc:
            file_type = "DOCX" if suffix == ".docx" else "PDF" if suffix == ".pdf" else "unsupported"
            raise ValueError(f"Failed to parse '{file_name}' as a {file_type} file") from exc
    return all_records


def parse_human_date(value: str) -> datetime.date | None:
    """
    Parse common human-readable dates.
    Supports:
    - day month year (e.g. '15 October 2025', '4 Sept 2025')
    - month year (e.g. 'July 2025', 'October 2025'), defaults day to 1
    - ISO 'YYYY-MM-DD'
    """
    value = value.strip() if value else ""
    if not value:
        return None

    # ISO first to keep behaviour for strict dates
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        pass

    # Regex to capture optional day + month text + year (4 digits)
    match = re.match(r"^(?:(\d{1,2})\s+)?([A-Za-z\.]+)\s+(\d{4})$", value)
    if not match:
        return None

    day_text, month_text, year_text = match.groups()
    month_key = month_text.lower().rstrip(".")
    month_number = MONTH_ALIASES.get(month_key)
    if not month_number:
        return None

    day_number = int(day_text) if day_text else 1

    try:
        return date(int(year_text), month_number, day_number)
    except ValueError:
        return None

    return None


def list_insertion_orders(
    db: Session,
    *,
    tenant_id: int,
    module_id: int,
    user_id: int | None,
    pagination,
    search: str | None = None,
    status_filter: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> tuple[list[FinanceIO], int]:
    query = _build_insertion_orders_query(
        db,
        tenant_id=tenant_id,
        module_id=module_id,
        user_id=user_id,
        search=search,
        status_filter=status_filter,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )

    total_count = query.count()
    records = query.offset(pagination.offset).limit(pagination.limit).all()
    records = hydrate_custom_field_records(
        db,
        tenant_id=tenant_id,
        module_key="finance_io",
        records=records,
        record_id_attr="id",
    )
    return records, total_count


def _build_insertion_orders_query(
    db: Session,
    *,
    tenant_id: int,
    module_id: int,
    user_id: int | None,
    search: str | None = None,
    status_filter: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
):
    query = db.query(FinanceIO).filter(
        FinanceIO.tenant_id == tenant_id,
        FinanceIO.module_id == module_id,
        FinanceIO.deleted_at.is_(None),
    )

    if user_id is not None:
        query = query.filter(FinanceIO.user_id == user_id)

    if status_filter:
        query = query.filter(func.lower(FinanceIO.status) == status_filter.strip().lower())

    filter_field_map = {
        "io_number": {"expression": FinanceIO.io_number, "type": "text"},
        "customer_name": {"expression": FinanceIO.customer_name, "type": "text"},
        "status": {"expression": FinanceIO.status, "type": "text"},
        "currency": {"expression": FinanceIO.currency, "type": "text"},
        "total_amount": {"expression": FinanceIO.total_amount, "type": "number"},
        "issue_date": {"expression": FinanceIO.issue_date, "type": "date"},
        "due_date": {"expression": FinanceIO.due_date, "type": "date"},
        "external_reference": {"expression": FinanceIO.external_reference, "type": "text"},
        "counterparty_reference": {"expression": FinanceIO.counterparty_reference, "type": "text"},
        "updated_at": {"expression": FinanceIO.updated_at, "type": "date"},
        **build_custom_field_filter_map(
            db,
            tenant_id=tenant_id,
            module_key="finance_io",
            record_id_expression=FinanceIO.id,
        ),
    }
    query = apply_filter_conditions(
        query,
        conditions=all_filter_conditions,
        logic="all",
        field_map=filter_field_map,
    )
    query = apply_filter_conditions(
        query,
        conditions=any_filter_conditions,
        logic="any",
        field_map=filter_field_map,
    )

    query = apply_ranked_search(
        query,
        search=search,
        document=searchable_text(
            FinanceIO.io_number,
            FinanceIO.customer_name,
            FinanceIO.counterparty_reference,
            FinanceIO.external_reference,
            FinanceIO.status,
            FinanceIO.currency,
            FinanceIO.file_name,
            FinanceIO.notes,
        ),
        default_order_column=FinanceIO.updated_at,
    )
    return query


def get_insertion_order_or_404(
    db: Session,
    *,
    tenant_id: int,
    module_id: int,
    io_id: int,
    user_id: int | None,
) -> FinanceIO:
    query = db.query(FinanceIO).filter(
        FinanceIO.id == io_id,
        FinanceIO.tenant_id == tenant_id,
        FinanceIO.module_id == module_id,
        FinanceIO.deleted_at.is_(None),
    )
    if user_id is not None:
        query = query.filter(FinanceIO.user_id == user_id)

    record = query.first()
    if not record:
        raise ValueError("Insertion order not found")
    return hydrate_custom_field_record(
        db,
        tenant_id=tenant_id,
        module_key="finance_io",
        record=record,
        record_id=record.id,
    )


def create_insertion_order(
    db: Session,
    *,
    module_id: int,
    current_user,
    data: dict[str, Any],
) -> FinanceIO:
    custom_data = validate_custom_field_payload(
        db,
        tenant_id=current_user.tenant_id,
        module_key="finance_io",
        payload=data.pop("custom_fields", None),
    )
    requested_io_number = _normalize_text(data.get("io_number"))
    next_io_sequence = None
    if requested_io_number:
        io_number = requested_io_number
        file_sequence_label = requested_io_number
    else:
        next_io_sequence = _get_next_io_sequence(db)
        io_number = f"{IO_NUMBER_PREFIX}{next_io_sequence:0{IO_NUMBER_PAD}d}"
        file_sequence_label = str(next_io_sequence)
    customer_contact = _resolve_customer_contact(
        db,
        current_user=current_user,
        customer_contact_id=data.get("customer_contact_id"),
        customer_name=data.get("customer_name"),
        customer_email=data.get("customer_email"),
        create_if_missing=bool(data.get("create_customer_if_missing")),
    )
    customer_name = _normalize_text(data.get("customer_name"))
    customer_organization = _resolve_customer_organization(
        db,
        current_user=current_user,
        customer_name=None if customer_contact else customer_name,
        customer_organization_id=(
            customer_contact.organization_id
            if customer_contact and customer_contact.organization_id is not None
            else data.get("customer_organization_id")
        ),
        create_if_missing=bool(data.get("create_customer_if_missing")),
    )
    resolved_customer_name = (
        " ".join([part for part in (customer_contact.first_name, customer_contact.last_name) if part]).strip()
        if customer_contact and any((customer_contact.first_name, customer_contact.last_name))
        else customer_contact.primary_email if customer_contact
        else None
    ) or (
        customer_organization.org_name if customer_organization else customer_name
    )
    if not resolved_customer_name:
        raise ValueError("customer_name is required")
    issue_date = parse_human_date(data["issue_date"]) if data.get("issue_date") else datetime.utcnow().date()
    effective_date = parse_human_date(data["effective_date"]) if data.get("effective_date") else None
    due_date = parse_human_date(data["due_date"]) if data.get("due_date") else None
    start_date = parse_human_date(data["start_date"]) if data.get("start_date") else None
    end_date = parse_human_date(data["end_date"]) if data.get("end_date") else None

    record = FinanceIO(
        tenant_id=current_user.tenant_id,
        module_id=module_id,
        user_id=current_user.id if current_user else None,
        io_number=io_number,
        file_name=data.get("external_reference") or f"insertion-order-{file_sequence_label}.manual",
        customer_contact_id=customer_contact.contact_id if customer_contact else None,
        customer_organization_id=customer_organization.org_id if customer_organization else None,
        customer_name=resolved_customer_name,
        counterparty_reference=_normalize_text(data.get("counterparty_reference")),
        external_reference=_normalize_text(data.get("external_reference")),
        issue_date=issue_date,
        effective_date=effective_date,
        due_date=due_date,
        start_date=start_date,
        end_date=end_date,
        status=_normalize_text(data.get("status")) or DEFAULT_IO_STATUS,
        currency=_normalize_allowed_currency(db, current_user, data.get("currency")),
        subtotal_amount=_parse_decimal(data.get("subtotal_amount")),
        tax_amount=_parse_decimal(data.get("tax_amount")),
        total_amount=_parse_decimal(data.get("total_amount")),
        notes=_normalize_text(data.get("notes")),
        custom_data=custom_data,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    save_custom_field_values(
        db,
        tenant_id=current_user.tenant_id,
        module_key="finance_io",
        record_id=record.id,
        values=custom_data,
    )
    db.commit()
    return hydrate_custom_field_record(
        db,
        tenant_id=current_user.tenant_id,
        module_key="finance_io",
        record=record,
        record_id=record.id,
    )


def update_insertion_order(
    db: Session,
    *,
    record: FinanceIO,
    current_user=None,
    data: dict[str, Any],
) -> FinanceIO:
    custom_data_to_save: dict[str, Any] | None = None
    if "custom_fields" in data:
        custom_data_to_save = validate_custom_field_payload(
            db,
            tenant_id=record.tenant_id,
            module_key="finance_io",
            payload=data.pop("custom_fields"),
            existing=load_custom_field_values_with_fallback(
                db,
                tenant_id=record.tenant_id,
                module_key="finance_io",
                record_id=record.id,
                fallback=record.custom_data,
            ),
        )
        record.custom_data = custom_data_to_save

    if (
        "customer_name" in data
        or "customer_contact_id" in data
        or "customer_organization_id" in data
        or "customer_email" in data
        or data.get("create_customer_if_missing")
    ):
        customer_contact = _resolve_customer_contact(
            db,
            current_user=current_user,
            customer_contact_id=data.get("customer_contact_id"),
            customer_name=data.get("customer_name", _finance_record_customer_name(record)),
            customer_email=data.get("customer_email"),
            create_if_missing=bool(data.get("create_customer_if_missing")),
        )
        customer_organization = _resolve_customer_organization(
            db,
            current_user=current_user,
            customer_name=None if customer_contact else data.get("customer_name", _finance_record_customer_name(record)),
            customer_organization_id=(
                customer_contact.organization_id
                if customer_contact and customer_contact.organization_id is not None
                else data.get("customer_organization_id")
            ),
            create_if_missing=bool(data.get("create_customer_if_missing")),
        )
        if customer_contact:
            record.customer_contact_id = customer_contact.contact_id
            contact_name = " ".join([part for part in (customer_contact.first_name, customer_contact.last_name) if part]).strip()
            record.customer_name = contact_name or customer_contact.primary_email
        elif "customer_contact_id" in data and data["customer_contact_id"] is None:
            record.customer_contact_id = None
        if customer_organization:
            record.customer_organization_id = customer_organization.org_id
            if not customer_contact:
                record.customer_name = customer_organization.org_name
        else:
            if "customer_organization_id" in data and data["customer_organization_id"] is None:
                record.customer_organization_id = None
            if "customer_name" in data:
                normalized_customer_name = _normalize_text(data["customer_name"])
                if not normalized_customer_name:
                    raise ValueError("customer_name is required")
                record.customer_name = normalized_customer_name

    for key in {"issue_date", "effective_date", "due_date", "start_date", "end_date"}:
        if key in data:
            value = data[key]
            setattr(record, key, parse_human_date(value) if value else None)

    for key in {
        "counterparty_reference",
        "external_reference",
        "status",
        "currency",
        "notes",
    }:
        if key in data:
            value = _normalize_text(data[key]) if data[key] is not None else None
            if key == "currency":
                value = _normalize_allowed_currency(db, current_user, value)
            setattr(record, key, value)

    for key in {"subtotal_amount", "tax_amount", "total_amount"}:
        if key in data:
            setattr(record, key, _parse_decimal(data[key]))

    if record.external_reference:
        record.file_name = record.external_reference

    db.add(record)
    db.commit()
    db.refresh(record)
    if custom_data_to_save is not None:
        save_custom_field_values(
            db,
            tenant_id=record.tenant_id,
            module_key="finance_io",
            record_id=record.id,
            values=custom_data_to_save,
        )
        db.commit()
    return hydrate_custom_field_record(
        db,
        tenant_id=record.tenant_id,
        module_key="finance_io",
        record=record,
        record_id=record.id,
    )


def soft_delete_insertion_order(db: Session, *, record: FinanceIO) -> None:
    record.deleted_at = datetime.utcnow()
    db.add(record)
    db.commit()


def list_deleted_insertion_orders(
    db: Session,
    *,
    tenant_id: int,
    module_id: int,
    pagination,
) -> tuple[list[FinanceIO], int]:
    query = (
        db.query(FinanceIO)
        .filter(
            FinanceIO.module_id == module_id,
            FinanceIO.tenant_id == tenant_id,
            FinanceIO.deleted_at.is_not(None),
        )
        .order_by(FinanceIO.deleted_at.desc(), FinanceIO.updated_at.desc())
    )
    total_count = query.count()
    records = query.offset(pagination.offset).limit(pagination.limit).all()
    records = hydrate_custom_field_records(
        db,
        tenant_id=tenant_id,
        module_key="finance_io",
        records=records,
        record_id_attr="id",
    )
    return records, total_count


def get_deleted_insertion_order_or_404(
    db: Session,
    *,
    tenant_id: int,
    module_id: int,
    io_id: int,
) -> FinanceIO:
    record = (
        db.query(FinanceIO)
        .filter(
            FinanceIO.id == io_id,
            FinanceIO.tenant_id == tenant_id,
            FinanceIO.module_id == module_id,
            FinanceIO.deleted_at.is_not(None),
        )
        .first()
    )
    if not record:
        raise ValueError("Deleted insertion order not found")
    return hydrate_custom_field_record(
        db,
        tenant_id=tenant_id,
        module_key="finance_io",
        record=record,
        record_id=record.id,
    )


def restore_insertion_order(db: Session, *, record: FinanceIO) -> FinanceIO:
    record.deleted_at = None
    db.add(record)
    db.commit()
    db.refresh(record)
    return hydrate_custom_field_record(
        db,
        tenant_id=record.tenant_id,
        module_key="finance_io",
        record=record,
        record_id=record.id,
    )
