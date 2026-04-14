from __future__ import annotations
import json
import os
import re

from datetime import datetime, date
from decimal import Decimal, InvalidOperation
from io import BytesIO
from pathlib import Path
from typing import Any, IO

from dateutil import parser
from docx import Document
import pdfplumber
from sqlalchemy import extract, func, literal, or_
from sqlalchemy.orm import Session

from app.core.postgres_search import TRIGRAM_SIMILARITY_THRESHOLD
from app.modules.finance.models import FinanceIO
from app.modules.platform.services.custom_fields import save_custom_field_values, validate_custom_field_payload
from app.modules.sales.models import SalesContact, SalesOrganization
from app.modules.user_management.models import Module, User

# Single folder override via env
IO_SEARCH_UPLOAD_DIR = Path(os.environ["IO_SEARCH_UPLOAD_DIR"]).resolve()
IO_SEARCH_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# IO module_id in the modules table
DEFAULT_MODULE_ID = 2
FINANCE_MODULE_KEY = "finance_io"
DEFAULT_IO_STATUS = "draft"
DEFAULT_IO_CURRENCY = "USD"

# Mapping from the DOCX table labels to DB column names
FIELD_MAP = {
    "Agency / Client Name": "client_name",
    "Campaign Name": "campaign_name",
    "Start Date": "start_date",
    "End Date": "end_date",
    "Campaign Type": "campaign_type",
    "Total Leads": "total_leads",
    "Seniority Split": "seniority_split",
    "CPL": "cpl",
    "Total Cost of Project": "total_cost_of_project",
    "Target Persona": "target_persona",
    "Targeting": "target_persona",
    "Domain Cap": "domain_cap",
    "Target Geography": "target_geography",
    "Delivery Format": "delivery_format",
    "Account Manager": "account_manager",
}

TEXT_SEARCHABLE_FIELDS = {
    "file_name",
    "client_name",
    "campaign_name",
    "campaign_type",
    "total_leads",
    "seniority_split",
    "cpl",
    "total_cost_of_project",
    "target_persona",
    "domain_cap",
    "target_geography",
    "delivery_format",
    "account_manager",
}

DATE_FIELDS = {"start_date", "end_date"}
QUARTER_SEARCH_FIELD = "quarter"
REQUIRED_RECORD_FIELDS = {"Agency / Client Name", "Campaign Name"}

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

FinanceSearchRow = tuple[
    str | None,  # io_number
    str,  # file_name
    str | None,  # file_path
    str,  # campaign_name
    datetime,  # updated_at
    int | None,  # user_id
    str | None,  # first_name
    str | None,  # last_name
    str | None,  # photo_url
    str | None,  # client_name
    str | None,  # cpl
    date | None,  # start_date
    date | None,  # end_date
    str | None,  # campaign_type
    str | None,  # account_manager
    str | None,  # total_leads
]

IO_NUMBER_PREFIX = "IOAI"
IO_NUMBER_PAD = 5
IO_NUMBER_REGEX = re.compile(rf"^{IO_NUMBER_PREFIX}(\d+)$")


def get_finance_module_id(db: Session) -> int:
    module_id = db.query(Module.id).filter(Module.name == FINANCE_MODULE_KEY).scalar()
    return int(module_id) if module_id is not None else DEFAULT_MODULE_ID


def _get_max_io_sequence(db: Session, prefix: str = IO_NUMBER_PREFIX) -> int:
    """Return the highest existing io_number sequence for the prefix."""
    max_seq = 0
    for (io_number,) in db.query(FinanceIO.io_number).filter(FinanceIO.io_number.like(f"{prefix}%")).all():
        if not io_number:
            continue
        match = IO_NUMBER_REGEX.match(io_number)
        if not match:
            continue
        try:
            seq = int(match.group(1))
        except ValueError:
            continue
        max_seq = max(max_seq, seq)
    return max_seq


def sanitize_file_name(file_name: str) -> str:
    """Normalize file names by stripping directories and replacing whitespace with dashes."""
    name_only = Path(file_name).name
    stem, suffix = os.path.splitext(name_only)
    sanitized_stem = re.sub(r"\s+", "-", stem.strip())
    return f"{sanitized_stem}{suffix}"

def _safe_remove_file(path_str: str) -> None:
    """Best-effort removal of a file, ignoring any errors."""
    try:
        path = Path(path_str)
        if path.is_file():
            path.unlink()
    except Exception:
        pass


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


def _legacy_payload_for_record(raw: dict[str, Any]) -> str:
    legacy_data = {
        "client_name": raw.get("client_name"),
        "campaign_name": raw.get("campaign_name"),
        "campaign_type": raw.get("campaign_type"),
        "total_leads": raw.get("total_leads"),
        "seniority_split": raw.get("seniority_split"),
        "cpl": raw.get("cpl"),
        "total_cost_of_project": raw.get("total_cost_of_project"),
        "target_persona": raw.get("target_persona"),
        "domain_cap": raw.get("domain_cap"),
        "target_geography": raw.get("target_geography"),
        "delivery_format": raw.get("delivery_format"),
        "account_manager": raw.get("account_manager"),
    }
    return json.dumps({k: v for k, v in legacy_data.items() if v is not None})


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


def _finance_record_total(record: FinanceIO) -> Decimal | None:
    return record.total_amount


def _serialize_finance_record(record: FinanceIO, *, request, current_user) -> dict[str, Any]:
    full_name = None
    if getattr(record, "assigned_user", None):
        first_name = getattr(record.assigned_user, "first_name", None)
        last_name = getattr(record.assigned_user, "last_name", None)
        full_name = " ".join([part for part in (first_name, last_name) if part]) or None

    user_name = "You" if current_user and record.user_id == current_user.id else full_name
    file_url = None
    if request is not None and record.io_number:
        file_url = str(request.url_for("download_insertion_order_file", io_number=record.io_number))

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
        "file_url": file_url,
        "user_name": user_name,
        "photo_url": getattr(getattr(record, "assigned_user", None), "photo_url", None),
        "updated_at": _date_to_iso(record.updated_at),
    }


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
            SalesOrganization.deleted_at.is_(None),
        )
        .first()
    )
    if existing:
        return existing

    if not create_if_missing:
        return None

    organization = SalesOrganization(
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


def get_quarter_from_date(date_value: date | datetime | None) -> str | None:
    """Return the quarter label (e.g. 'Q1 2025') for a given date or datetime."""
    if not date_value:
        return None

    quarter_number = ((date_value.month - 1) // 3) + 1
    return f"Q{quarter_number} {date_value.year}"


def get_quarter_from_date_string(date_string: str) -> str | None:
    """
    Return the quarter label (e.g. 'Q1 2025') for a given date string.

    Accepts flexible inputs like '1 Sept 2025' or 'Sept 2025'.
    Returns None when the date cannot be parsed.
    """
    try:
        parsed_date = parser.parse(date_string, fuzzy=True)
        return get_quarter_from_date(parsed_date)
    except ValueError:
        return None
    except Exception as exc:
        return f"error while processing the Quarter {exc}"


def persist_records_to_db(
    db: Session,
    records: list[dict[str, Any]],
    module_id: int = DEFAULT_MODULE_ID,
    user_id: int | None = None,
    force_insert: bool = False,
    replace_duplicates: bool = False,
) -> dict[str, Any]:
    """
    Insert or update finance IO records for a given module_id.
    Uses (module_id, user_id, campaign_name) as the natural key to decide whether to update or insert.
    When force_insert is True, always creates new rows even if a matching campaign_name exists.
    When replace_duplicates is True, updates existing rows for the module regardless of user_id ownership.
    Optionally stamps records with the uploading user's id.

    Returns a summary with counts and skipped duplicates (kept for compatibility).
    """
    inserted = 0
    updated = 0
    skipped_duplicates: list[tuple[str, str]] = []
    next_io_sequence: int | None = None

    for raw in records:
        file_name = raw.get("file_name")
        if not file_name:
            continue

        file_path = raw.get("file_path")

        # Skip records that are missing required table fields to avoid DB NOT NULL failures.
        missing_required = [label for label in REQUIRED_RECORD_FIELDS if not raw.get(label)]
        if missing_required:
            continue

        payload: dict[str, Any] = {
            "module_id": module_id,
            "file_name": file_name,
            "status": "imported",
            "currency": DEFAULT_IO_CURRENCY,
        }

        if file_path:
            payload["file_path"] = file_path

        if user_id is not None:
            payload["user_id"] = user_id

        for source_label, column_name in FIELD_MAP.items():
            value = raw.get(source_label)

            if column_name == "target_persona":
                # Prefer the first non-empty value among Target Persona/Targeting
                existing = payload.get(column_name)
                candidate = value.strip() if isinstance(value, str) else value
                if existing:
                    continue
                if candidate is None or candidate == "":
                    continue
                payload[column_name] = candidate
                continue

            if column_name in {"start_date", "end_date"}:
                payload[column_name] = parse_human_date(value) if isinstance(value, str) else None
            else:
                payload[column_name] = value

        payload["customer_name"] = _normalize_text(payload.get("client_name")) or _normalize_text(payload.get("campaign_name"))
        payload["counterparty_reference"] = _normalize_text(payload.get("campaign_name"))
        payload["external_reference"] = _normalize_text(file_name)
        payload["issue_date"] = payload.get("start_date") or datetime.utcnow().date()
        payload["effective_date"] = payload.get("start_date")
        payload["due_date"] = payload.get("end_date")
        payload["total_amount"] = _parse_decimal(payload.get("total_cost_of_project"))
        payload["legacy_payload"] = _legacy_payload_for_record(payload)
        payload["notes"] = "Imported from the legacy insertion order workflow."

        existing = None
        if not force_insert:
            filters = [FinanceIO.module_id == module_id, FinanceIO.deleted_at.is_(None)]
            if not replace_duplicates:
                if user_id is not None:
                    filters.append(FinanceIO.user_id == user_id)
                else:
                    filters.append(FinanceIO.user_id.is_(None))

            if payload.get("campaign_name"):
                filters.append(FinanceIO.campaign_name == payload["campaign_name"])
            else:
                # Fallback to file_name when campaign_name is missing
                filters.append(FinanceIO.file_name == file_name)

            existing = db.query(FinanceIO).filter(*filters).first()

        if existing and not force_insert:
            if replace_duplicates:
                old_path = getattr(existing, "file_path", None)
                new_path = payload.get("file_path")
                if old_path and new_path and old_path != new_path:
                    _safe_remove_file(old_path)

            # Ensure existing rows get an io_number if missing
            if not getattr(existing, "io_number", None):
                if next_io_sequence is None:
                    next_io_sequence = _get_max_io_sequence(db)
                next_io_sequence += 1
                existing.io_number = f"{IO_NUMBER_PREFIX}{next_io_sequence:0{IO_NUMBER_PAD}d}"

            for field, value in payload.items():
                setattr(existing, field, value)
            db.add(existing)
            updated += 1
        else:
            if next_io_sequence is None:
                next_io_sequence = _get_max_io_sequence(db)
            next_io_sequence += 1
            payload["io_number"] = f"{IO_NUMBER_PREFIX}{next_io_sequence:0{IO_NUMBER_PAD}d}"
            db.add(FinanceIO(**payload))
            inserted += 1

    db.commit()

    return {
        "inserted": inserted,
        "updated": updated,
        "skipped_duplicates": skipped_duplicates,
    }


def search_finance_io(
    db: Session,
    field: str,
    value: str,
    module_id: int = DEFAULT_MODULE_ID,
    user_id: int | None = None,
    limit: int | None = None,
    offset: int | None = None,
    return_total: bool = False,
) -> list[FinanceSearchRow] | tuple[list[FinanceSearchRow], int]:
    """
    Search finance_io by a single column and return matching file names with updated timestamps.
    Text fields use case-insensitive substring match; date fields require exact date.
    """
    allowed_fields = TEXT_SEARCHABLE_FIELDS | DATE_FIELDS | {QUARTER_SEARCH_FIELD}
    if field not in allowed_fields:
        raise ValueError("Unsupported search field")

    def _rows_to_results(rows):
        return [
            (
                row.io_number,
                row.file_name,
                row.file_path,
                row.campaign_name,
                row.updated_at,
                row.user_id,
                row.first_name,
                row.last_name,
                row.photo_url,
                row.client_name,
                row.cpl,
                row.start_date,
                row.end_date,
                row.campaign_type,
                row.account_manager,
                row.total_leads,
            )
            for row in rows
        ]

    base_query = (
        db.query(
            FinanceIO.io_number,
            FinanceIO.file_name,
            FinanceIO.file_path,
            FinanceIO.campaign_name,
            FinanceIO.updated_at,
            FinanceIO.user_id,
            User.first_name,
            User.last_name,
            User.photo_url,
            FinanceIO.client_name,
            FinanceIO.cpl,
            FinanceIO.start_date,
            FinanceIO.end_date,
            FinanceIO.campaign_type,
            FinanceIO.account_manager,
            FinanceIO.total_leads,
        )
        .outerjoin(User, FinanceIO.user_id == User.id)
        .filter(
            FinanceIO.module_id == module_id,
            FinanceIO.deleted_at.is_(None),
        )
    )

    if user_id is not None:
        base_query = base_query.filter(FinanceIO.user_id == user_id)

    if field == QUARTER_SEARCH_FIELD:
        normalized_value = value.strip().upper()
        match = re.match(r"Q([1-4])(?:\s+(\d{4}))?$", normalized_value)
        if not match:
            return ([], 0) if return_total else []

        quarter_num = int(match.group(1))
        year_filter = int(match.group(2)) if match.group(2) else None
        quarter_months = {
            1: (1, 3),
            2: (4, 6),
            3: (7, 9),
            4: (10, 12),
        }
        start_month, end_month = quarter_months[quarter_num]

        base_query = base_query.filter(
            FinanceIO.start_date.isnot(None),
            extract("month", FinanceIO.start_date) >= start_month,
            extract("month", FinanceIO.start_date) <= end_month,
        )
        if year_filter:
            base_query = base_query.filter(extract("year", FinanceIO.start_date) == year_filter)

        query = base_query.distinct().order_by(FinanceIO.updated_at.desc())
        rows = query.all()

        filtered_rows = []
        expected_prefix = f"Q{quarter_num}" if not year_filter else f"Q{quarter_num} {year_filter}"
        for row in rows:
            if not row.start_date:
                continue
            quarter_label = get_quarter_from_date(row.start_date)
            if not quarter_label:
                continue

            quarter_label_upper = quarter_label.upper()
            if year_filter:
                if quarter_label_upper == expected_prefix:
                    filtered_rows.append(row)
            else:
                if quarter_label_upper.startswith(expected_prefix):
                    filtered_rows.append(row)

        total_count = len(filtered_rows) if return_total else None

        if offset is not None:
            filtered_rows = filtered_rows[offset:]
        if limit is not None:
            filtered_rows = filtered_rows[:limit]

        results = _rows_to_results(filtered_rows)
        return (results, total_count) if return_total else results

    column = getattr(FinanceIO, field)

    if field in DATE_FIELDS:
        parsed = parse_human_date(value) if isinstance(value, str) else None
        if not parsed:
            # Try ISO format as a fallback
            try:
                parsed = datetime.strptime(value, "%Y-%m-%d").date() if value else None
            except (ValueError, TypeError):
                parsed = None

        if not parsed:
            return ([], 0) if return_total else []

        base_query = base_query.filter(column == parsed)
    else:
        normalized = value.strip().lower()
        searchable_column = func.lower(func.coalesce(column, literal("")))
        rank = func.similarity(searchable_column, normalized)
        base_query = base_query.filter(
            or_(
                searchable_column.ilike(f"%{normalized}%"),
                rank >= TRIGRAM_SIMILARITY_THRESHOLD,
            )
        )

    # Compute total count before applying pagination
    total_count = base_query.distinct().count() if return_total else None

    if field in TEXT_SEARCHABLE_FIELDS:
        normalized = value.strip().lower()
        searchable_column = func.lower(func.coalesce(column, literal("")))
        rank = func.similarity(searchable_column, normalized)
        query = base_query.distinct().order_by(rank.desc(), FinanceIO.updated_at.desc())
    else:
        query = base_query.distinct().order_by(FinanceIO.updated_at.desc())

    if offset is not None:
        query = query.offset(offset)
    if limit is not None:
        query = query.limit(limit)

    results = _rows_to_results(query.all())

    if return_total:
        return results, total_count

    return results


def list_finance_io(
    db: Session,
    module_id: int = DEFAULT_MODULE_ID,
    user_id: int | None = None,
    limit: int | None = None,
    offset: int | None = None,
) -> list[FinanceSearchRow]:
    """
    Return all finance_io file names with their last updated timestamp for a module.
    """
    query = (
        db.query(
            FinanceIO.io_number,
            FinanceIO.file_name,
            FinanceIO.file_path,
            FinanceIO.campaign_name,
            FinanceIO.updated_at,
            FinanceIO.user_id,
            User.first_name,
            User.last_name,
            User.photo_url,
            FinanceIO.client_name,
            FinanceIO.cpl,
            FinanceIO.start_date,
            FinanceIO.end_date,
            FinanceIO.campaign_type,
            FinanceIO.account_manager,
            FinanceIO.total_leads,
        )
        .outerjoin(User, FinanceIO.user_id == User.id)
        .filter(
            FinanceIO.module_id == module_id,
            FinanceIO.deleted_at.is_(None),
        )
    )

    if user_id is not None:
        query = query.filter(FinanceIO.user_id == user_id)

    query = query.order_by(FinanceIO.updated_at.desc())

    if offset is not None:
        query = query.offset(offset)
    if limit is not None:
        query = query.limit(limit)

    query = query.distinct()
    return [
        (
            row.io_number,
            row.file_name,
            row.file_path,
            row.campaign_name,
            row.updated_at,
            row.user_id,
            row.first_name,
            row.last_name,
            row.photo_url,
            row.client_name,
            row.cpl,
            row.start_date,
            row.end_date,
            row.campaign_type,
            row.account_manager,
            row.total_leads,
        )
        for row in query.all()
    ]


def list_insertion_orders(
    db: Session,
    *,
    module_id: int,
    user_id: int | None,
    pagination,
    search: str | None = None,
    status_filter: str | None = None,
) -> tuple[list[FinanceIO], int]:
    query = db.query(FinanceIO).filter(
        FinanceIO.module_id == module_id,
        FinanceIO.deleted_at.is_(None),
    )

    if user_id is not None:
        query = query.filter(FinanceIO.user_id == user_id)

    if status_filter:
        query = query.filter(func.lower(FinanceIO.status) == status_filter.strip().lower())

    if search:
        document = func.lower(
            func.concat(
                func.coalesce(FinanceIO.io_number, ""),
                " ",
                func.coalesce(FinanceIO.customer_name, ""),
                " ",
                func.coalesce(FinanceIO.counterparty_reference, ""),
                " ",
                func.coalesce(FinanceIO.external_reference, ""),
                " ",
                func.coalesce(FinanceIO.status, ""),
                " ",
                func.coalesce(FinanceIO.currency, ""),
                " ",
                func.coalesce(FinanceIO.file_name, ""),
                " ",
                func.coalesce(FinanceIO.notes, ""),
                " ",
            )
        )
        normalized = search.strip().lower()
        rank = func.similarity(document, normalized)
        query = query.filter(or_(document.ilike(f"%{normalized}%"), rank >= TRIGRAM_SIMILARITY_THRESHOLD))
        query = query.order_by(rank.desc(), FinanceIO.updated_at.desc())
    else:
        query = query.order_by(FinanceIO.updated_at.desc())

    total_count = query.count()
    records = query.offset(pagination.offset).limit(pagination.limit).all()
    return records, total_count


def get_insertion_order_or_404(
    db: Session,
    *,
    module_id: int,
    io_id: int,
    user_id: int | None,
) -> FinanceIO:
    query = db.query(FinanceIO).filter(
        FinanceIO.id == io_id,
        FinanceIO.module_id == module_id,
        FinanceIO.deleted_at.is_(None),
    )
    if user_id is not None:
        query = query.filter(FinanceIO.user_id == user_id)

    record = query.first()
    if not record:
        raise ValueError("Insertion order not found")
    return record


def create_insertion_order(
    db: Session,
    *,
    module_id: int,
    current_user,
    data: dict[str, Any],
) -> FinanceIO:
    custom_data = validate_custom_field_payload(
        db,
        module_key="finance_io",
        payload=data.pop("custom_fields", None),
    )
    next_io_sequence = _get_max_io_sequence(db) + 1
    requested_io_number = _normalize_text(data.get("io_number"))
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
        module_id=module_id,
        user_id=current_user.id if current_user else None,
        io_number=requested_io_number or f"{IO_NUMBER_PREFIX}{next_io_sequence:0{IO_NUMBER_PAD}d}",
        file_name=data.get("external_reference") or f"insertion-order-{next_io_sequence}.manual",
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
        currency=(_normalize_text(data.get("currency")) or DEFAULT_IO_CURRENCY).upper(),
        subtotal_amount=_parse_decimal(data.get("subtotal_amount")),
        tax_amount=_parse_decimal(data.get("tax_amount")),
        total_amount=_parse_decimal(data.get("total_amount")),
        notes=_normalize_text(data.get("notes")),
        custom_data=custom_data,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    save_custom_field_values(db, module_key="finance_io", record_id=record.id, values=record.custom_data or {})
    db.commit()
    return record


def update_insertion_order(
    db: Session,
    *,
    record: FinanceIO,
    current_user=None,
    data: dict[str, Any],
) -> FinanceIO:
    if "custom_fields" in data:
        record.custom_data = validate_custom_field_payload(
            db,
            module_key="finance_io",
            payload=data.pop("custom_fields"),
            existing=record.custom_data or {},
        )

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
            if key == "currency" and value:
                value = value.upper()
            setattr(record, key, value)

    for key in {"subtotal_amount", "tax_amount", "total_amount"}:
        if key in data:
            setattr(record, key, _parse_decimal(data[key]))

    if record.external_reference:
        record.file_name = record.external_reference

    db.add(record)
    db.commit()
    db.refresh(record)
    save_custom_field_values(db, module_key="finance_io", record_id=record.id, values=record.custom_data or {})
    db.commit()
    return record


def soft_delete_insertion_order(db: Session, *, record: FinanceIO) -> None:
    record.deleted_at = datetime.utcnow()
    db.add(record)
    db.commit()


def list_deleted_insertion_orders(
    db: Session,
    *,
    module_id: int,
    pagination,
) -> tuple[list[FinanceIO], int]:
    query = (
        db.query(FinanceIO)
        .filter(
            FinanceIO.module_id == module_id,
            FinanceIO.deleted_at.is_not(None),
        )
        .order_by(FinanceIO.deleted_at.desc(), FinanceIO.updated_at.desc())
    )
    total_count = query.count()
    records = query.offset(pagination.offset).limit(pagination.limit).all()
    return records, total_count


def get_deleted_insertion_order_or_404(
    db: Session,
    *,
    module_id: int,
    io_id: int,
) -> FinanceIO:
    record = (
        db.query(FinanceIO)
        .filter(
            FinanceIO.id == io_id,
            FinanceIO.module_id == module_id,
            FinanceIO.deleted_at.is_not(None),
        )
        .first()
    )
    if not record:
        raise ValueError("Deleted insertion order not found")
    return record


def restore_insertion_order(db: Session, *, record: FinanceIO) -> FinanceIO:
    record.deleted_at = None
    db.add(record)
    db.commit()
    db.refresh(record)
    return record
