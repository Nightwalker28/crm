from __future__ import annotations

import csv
import io

from fastapi import HTTPException, UploadFile, status


async def read_csv_upload(file: UploadFile) -> tuple[list[str], list[dict[str, str | None]]]:
    filename = (file.filename or "").lower()
    if not filename.endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only CSV files are supported.",
        )

    content = await file.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )

    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to decode CSV file as UTF-8.",
        ) from exc

    return rows_from_csv_text(text)


def rows_from_csv_text(text: str) -> tuple[list[str], list[dict[str, str | None]]]:
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV file is missing headers.",
        )

    headers = [str(header).strip() for header in reader.fieldnames if header is not None]
    rows: list[dict[str, str | None]] = []
    for row in reader:
        normalized = {
            str(key).strip(): (value.strip() if isinstance(value, str) else value)
            for key, value in row.items()
            if key is not None
        }
        if all(not (value or "").strip() for value in normalized.values()):
            continue
        rows.append(normalized)

    return headers, rows


def rows_from_csv_bytes(file_bytes: bytes) -> tuple[list[str], list[dict[str, str | None]]]:
    try:
        text = file_bytes.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to decode CSV file as UTF-8.",
        ) from exc
    return rows_from_csv_text(text)


def require_csv_headers(headers: list[str], *, required: set[str]) -> None:
    missing = sorted(required - set(headers))
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Missing required column(s): {', '.join(missing)}",
        )
