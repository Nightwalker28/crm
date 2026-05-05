from __future__ import annotations

import csv
import io
import tempfile
import zipfile
from pathlib import Path
from collections.abc import Iterable, Sequence

from fastapi.responses import StreamingResponse


def _sanitize_csv_cell(value) -> str:
    text = str(value) if value is not None else ""
    if text and text[0] in {"=", "+", "-", "@", "\t", "\r"}:
        return "'" + text
    return text


def dict_rows_to_csv_bytes(*, headers: Sequence[str], rows: Iterable[dict]) -> bytes:
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=list(headers))
    writer.writeheader()
    for row in rows:
        writer.writerow({header: _sanitize_csv_cell(row.get(header)) for header in headers})
    return output.getvalue().encode("utf-8")


def batched_csv_zip_file(
    *,
    rows: Iterable,
    batch_size: int,
    file_prefix: str,
    serialize_row,
) -> tuple[Path, dict]:
    temp_file = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    temp_path = Path(temp_file.name)
    temp_file.close()
    total_rows = 0
    batch_no = 1
    batches_written = 0
    batch: list = []

    with zipfile.ZipFile(temp_path, mode="w", compression=zipfile.ZIP_DEFLATED) as zipf:
        for row in rows:
            batch.append(row)
            if len(batch) >= batch_size:
                zipf.writestr(f"{file_prefix}_batch_{batch_no}.csv", serialize_row(batch))
                total_rows += len(batch)
                batches_written += 1
                batch_no += 1
                batch = []

        if batch:
            zipf.writestr(f"{file_prefix}_batch_{batch_no}.csv", serialize_row(batch))
            total_rows += len(batch)
            batches_written += 1

    return temp_path, {"batches": batches_written, "rows": total_rows}


def bytes_download_response(
    *,
    content: bytes,
    filename: str,
    media_type: str,
    extra_headers: dict[str, str] | None = None,
) -> StreamingResponse:
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    if extra_headers:
        headers.update(extra_headers)
    return StreamingResponse(io.BytesIO(content), media_type=media_type, headers=headers)
