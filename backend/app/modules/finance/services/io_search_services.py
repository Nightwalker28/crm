from __future__ import annotations
import os
import re

from datetime import datetime, date
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
from app.modules.user_management.models import User

# Single folder override via env
IO_SEARCH_UPLOAD_DIR = Path(os.environ["IO_SEARCH_UPLOAD_DIR"]).resolve()
IO_SEARCH_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# IO module_id in the modules table
DEFAULT_MODULE_ID = 2

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
        if suffix == ".docx":
            all_records.extend(_parse_docx_bytes(file_name, payload, save_dir))
        elif suffix == ".pdf":
            all_records.extend(_parse_pdf_bytes(file_name, payload, save_dir))
        else:
            raise ValueError(f"Unsupported file type for {file_name}")
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

        existing = None
        if not force_insert:
            filters = [FinanceIO.module_id == module_id]
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
        .filter(FinanceIO.module_id == module_id)
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
        .filter(FinanceIO.module_id == module_id)
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
