from __future__ import annotations

import csv
import io
import json
import re
from collections.abc import Iterator

from fastapi import HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from app.core.module_export import dict_rows_to_csv_bytes


CSV_CONTENT_TYPES = {
    "text/csv",
    "application/csv",
    "text/plain",
    "application/vnd.ms-excel",
}


class ImportFailureItem(BaseModel):
    row_number: int | None = None
    record_identifier: str | None = None
    reason: str


class StandardImportSummary(BaseModel):
    message: str
    total_rows: int = 0
    processed_rows: int = 0
    imported_rows: int = 0
    new_rows: int = 0
    skipped_rows: int = 0
    overwritten_rows: int = 0
    merged_rows: int = 0
    failed_rows: int = 0
    failures: list[ImportFailureItem] = Field(default_factory=list)


class ImportExecutionResponse(BaseModel):
    mode: str
    message: str
    summary: StandardImportSummary | None = None
    job_id: int | None = None
    job_status: str | None = None


def build_import_summary(
    *,
    total_rows: int,
    new_rows: int = 0,
    skipped_rows: int = 0,
    overwritten_rows: int = 0,
    merged_rows: int = 0,
    failures: list[dict | ImportFailureItem] | None = None,
) -> dict:
    normalized_failures = [
        failure if isinstance(failure, ImportFailureItem) else ImportFailureItem(**failure)
        for failure in (failures or [])
    ]
    failed_rows = len(normalized_failures)
    imported_rows = new_rows + overwritten_rows + merged_rows
    processed_rows = imported_rows + skipped_rows + failed_rows

    return StandardImportSummary(
        message=(
            f"Processed {processed_rows} of {total_rows} row(s): "
            f"{imported_rows} imported, {skipped_rows} skipped, {failed_rows} failed."
        ),
        total_rows=total_rows,
        processed_rows=processed_rows,
        imported_rows=imported_rows,
        new_rows=new_rows,
        skipped_rows=skipped_rows,
        overwritten_rows=overwritten_rows,
        merged_rows=merged_rows,
        failed_rows=failed_rows,
        failures=normalized_failures,
    ).model_dump(mode="json")


async def read_upload_bytes(
    file: UploadFile,
    *,
    allowed_extensions: set[str],
) -> bytes:
    original_filename = file.filename or ""
    filename = original_filename.lower()
    if not any(filename.endswith(f".{extension.lower().lstrip('.')}") for extension in allowed_extensions):
        allowed_text = ", ".join(sorted(f".{extension.lower().lstrip('.')}" for extension in allowed_extensions))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Only {allowed_text} files are supported for '{original_filename or 'upload'}'.",
        )

    normalized_extensions = {extension.lower().lstrip(".") for extension in allowed_extensions}
    content_type = (file.content_type or "").split(";", 1)[0].strip().lower()
    if "csv" in normalized_extensions and content_type and content_type not in CSV_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file content type.",
        )

    content = await file.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )
    return content


async def read_csv_upload(file: UploadFile) -> tuple[list[str], list[dict[str, str | None]]]:
    content = await read_upload_bytes(file, allowed_extensions={"csv"})
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to decode CSV file as UTF-8.",
        ) from exc

    return rows_from_csv_text(text)


def rows_from_csv_text(text: str) -> tuple[list[str], list[dict[str, str | None]]]:
    headers, row_iter = iter_csv_rows_from_text(text)
    return headers, list(row_iter)


def iter_csv_rows_from_text(text: str) -> tuple[list[str], Iterator[dict[str, str | None]]]:
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV file is missing headers.",
        )

    headers = [str(header).strip() for header in reader.fieldnames if header is not None]

    def generate_rows() -> Iterator[dict[str, str | None]]:
        for row in reader:
            normalized = {
                str(key).strip(): (value.strip() if isinstance(value, str) else value)
                for key, value in row.items()
                if key is not None
            }
            if all(not (value or "").strip() for value in normalized.values()):
                continue
            yield normalized

    return headers, generate_rows()


def rows_from_csv_bytes(file_bytes: bytes) -> tuple[list[str], list[dict[str, str | None]]]:
    headers, row_iter = iter_csv_rows_from_bytes(file_bytes)
    return headers, list(row_iter)


def iter_csv_rows_from_bytes(file_bytes: bytes) -> tuple[list[str], Iterator[dict[str, str | None]]]:
    try:
        text = file_bytes.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to decode CSV file as UTF-8.",
        ) from exc
    return iter_csv_rows_from_text(text)


def count_csv_rows_bytes(file_bytes: bytes) -> int:
    _, row_iter = iter_csv_rows_from_bytes(file_bytes)
    return sum(1 for _ in row_iter)


def require_csv_headers(headers: list[str], *, required: set[str]) -> None:
    missing = sorted(required - set(headers))
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Missing required column(s): {', '.join(missing)}",
        )


def normalize_header_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.strip().lower())


def suggest_header_mapping(
    *,
    source_headers: list[str],
    target_headers: list[str],
    aliases: dict[str, list[str] | set[str]] | None = None,
) -> dict[str, str | None]:
    aliases = aliases or {}
    normalized_source_headers = {
        normalize_header_name(source_header): source_header
        for source_header in source_headers
    }
    suggestions: dict[str, str | None] = {}

    for target_header in target_headers:
        normalized_target = normalize_header_name(target_header)
        matched_source = normalized_source_headers.get(normalized_target)

        if not matched_source:
            for alias in aliases.get(target_header, []):
                matched_source = normalized_source_headers.get(normalize_header_name(alias))
                if matched_source:
                    break

        suggestions[target_header] = matched_source

    return suggestions


def remap_csv_rows(
    rows: list[dict[str, str | None]],
    mapping: dict[str, str | None],
) -> list[dict[str, str | None]]:
    remapped_rows: list[dict[str, str | None]] = []
    for row in rows:
        remapped_rows.append(
            {
                target_header: row.get(source_header) if source_header else None
                for target_header, source_header in mapping.items()
            }
        )
    return remapped_rows


def parse_mapping_json(mapping_json: str | None, *, target_headers: list[str]) -> dict[str, str | None] | None:
    if not mapping_json:
        return None
    try:
        payload = json.loads(mapping_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid mapping payload.") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Import mapping must be an object.")
    valid_targets = set(target_headers)
    mapping: dict[str, str | None] = {}
    for target_header, source_header in payload.items():
        target = str(target_header).strip()
        if target not in valid_targets:
            continue
        source = str(source_header).strip() if source_header is not None else None
        mapping[target] = source or None
    return mapping


def remap_csv_bytes(
    file_bytes: bytes,
    *,
    target_headers: list[str],
    mapping: dict[str, str | None] | None,
) -> bytes:
    if not mapping:
        return file_bytes
    _, rows = rows_from_csv_bytes(file_bytes)
    remapped_rows = remap_csv_rows(rows, mapping)
    return dict_rows_to_csv_bytes(headers=target_headers, rows=remapped_rows)
