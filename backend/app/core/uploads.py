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
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded image is empty.")

    detected_type = _detect_image_type(file_bytes)
    if detected_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported image type. Allowed types: .jpg, .jpeg, .png, .webp",
        )

    normalized_extension = ALLOWED_IMAGE_TYPES[detected_type]
    if raw_extension and raw_extension not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported image extension. Allowed types: .jpg, .jpeg, .png, .webp",
        )
    return file_bytes, normalized_extension


def persist_media_file(*, category: str, owner_key: str, extension: str, content: bytes) -> str:
    target_dir = MEDIA_ROOT_DIR / category / owner_key
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
        path.unlink()
        parent = path.parent
        while parent != media_root and parent.exists():
            try:
                parent.rmdir()
            except OSError:
                break
            parent = parent.parent


def build_media_url(relative_media_path: str) -> str:
    if relative_media_path.startswith("/"):
        return relative_media_path
    return f"/{relative_media_path.lstrip('/')}"
