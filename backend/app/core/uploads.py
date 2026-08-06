from __future__ import annotations

import logging
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[2]
UPLOADS_DIR = BACKEND_DIR / "uploads"
MEDIA_ROOT_DIR = UPLOADS_DIR / "media"
MEDIA_ROOT_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
ALLOWED_IMAGE_TYPES = {"jpeg": "jpg", "png": "png", "webp": "webp"}
ALLOWED_IMAGE_MIME_TYPES = {
    "image/jpeg": "jpeg",
    "image/png": "png",
    "image/webp": "webp",
}
UPLOAD_READ_CHUNK_BYTES = 1024 * 1024
IMAGE_MAX_UPLOAD_BYTES = 5 * 1024 * 1024


def _detect_image_type(file_bytes: bytes) -> str | None:
    if file_bytes.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if file_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if file_bytes.startswith(b"RIFF") and file_bytes[8:12] == b"WEBP":
        return "webp"
    return None


async def read_image_upload(file: UploadFile) -> tuple[bytes, str]:
    raw_extension = (file.filename or "").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else ""
    declared_type = (file.content_type or "").lower()
    if declared_type not in ALLOWED_IMAGE_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported image type. Allowed types: .jpg, .jpeg, .png, .webp",
        )
    file_bytes = await read_upload_limited(
        file,
        max_bytes=IMAGE_MAX_UPLOAD_BYTES,
        empty_detail="Uploaded image is empty.",
        oversize_detail=f"Image exceeds the {IMAGE_MAX_UPLOAD_BYTES} byte upload limit.",
    )

    detected_type = _detect_image_type(file_bytes)
    if detected_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported image type. Allowed types: .jpg, .jpeg, .png, .webp",
        )
    if ALLOWED_IMAGE_MIME_TYPES[declared_type] != detected_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Image content does not match its declared type.",
        )

    normalized_extension = ALLOWED_IMAGE_TYPES[detected_type]
    if raw_extension and raw_extension not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported image extension. Allowed types: .jpg, .jpeg, .png, .webp",
        )
    normalized_raw_extension = "jpg" if raw_extension == "jpeg" else raw_extension
    if normalized_raw_extension and normalized_raw_extension != normalized_extension:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Image content does not match its file extension.",
        )
    return file_bytes, normalized_extension


async def read_upload_limited(
    file: UploadFile,
    *,
    max_bytes: int,
    empty_detail: str,
    oversize_detail: str | None = None,
) -> bytes:
    chunks: list[bytes] = []
    total_bytes = 0
    while True:
        chunk = await file.read(UPLOAD_READ_CHUNK_BYTES)
        if not chunk:
            break
        total_bytes += len(chunk)
        if total_bytes > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=oversize_detail or f"Upload exceeds the {max_bytes} byte file size limit.",
            )
        chunks.append(chunk)

    content = b"".join(chunks)
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=empty_detail)
    return content


def persist_media_file(*, category: str, owner_key: str, extension: str, content: bytes) -> str:
    media_root = MEDIA_ROOT_DIR.resolve()
    target_dir = (media_root / category / owner_key).resolve()
    if target_dir == media_root or media_root not in target_dir.parents:
        raise ValueError("Media storage path must remain inside the media root")
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid4().hex}.{extension}"
    path = target_dir / filename
    path.write_bytes(content)
    return path.relative_to(UPLOADS_DIR).as_posix()


def delete_local_media_file(relative_media_path: str | None) -> None:
    if not relative_media_path:
        return
    normalized_path = relative_media_path.lstrip("/")
    if not normalized_path.startswith("media/"):
        parsed = urlparse(relative_media_path)
        if parsed.scheme in {"http", "https"}:
            return
        logger.warning(
            "Ignoring unexpected local media cleanup path outside media root: %s",
            relative_media_path,
        )
        return
    path = (MEDIA_ROOT_DIR / normalized_path.removeprefix("media/")).resolve()
    media_root = MEDIA_ROOT_DIR.resolve()
    if media_root not in path.parents:
        logger.warning("Ignoring local media cleanup path that resolves outside media root: %s", relative_media_path)
        return
    if path.exists():
        try:
            path.unlink()
        except OSError:
            logger.warning("Unable to remove managed media file: %s", relative_media_path, exc_info=True)
            return
        parent = path.parent
        while parent != media_root and parent.exists():
            try:
                parent.rmdir()
                parent = parent.parent
            except OSError:
                break


def delete_managed_media_file(
    media_url: str | None,
    *,
    category: str,
    owner_key: str,
) -> None:
    """Delete a local asset only when it belongs to the expected managed owner directory."""
    if not media_url:
        return
    parsed = urlparse(media_url)
    if parsed.scheme in {"http", "https"}:
        return

    normalized_path = parsed.path.lstrip("/")
    expected_directory = (MEDIA_ROOT_DIR / category / owner_key).resolve()
    media_root = MEDIA_ROOT_DIR.resolve()
    if expected_directory == media_root or media_root not in expected_directory.parents:
        logger.warning("Ignoring invalid managed media owner path: %s/%s", category, owner_key)
        return

    candidate = (MEDIA_ROOT_DIR / normalized_path.removeprefix("media/")).resolve()
    if not normalized_path.startswith("media/") or candidate.parent != expected_directory:
        logger.warning("Ignoring media cleanup outside expected owner directory: %s", media_url)
        return
    delete_local_media_file(normalized_path)


def build_media_url(relative_media_path: str) -> str:
    if relative_media_path.startswith("/"):
        return relative_media_path
    return f"/{relative_media_path.lstrip('/')}"
