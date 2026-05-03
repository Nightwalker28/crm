from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, status

from app.core.uploads import UPLOADS_DIR


DOCUMENT_STORAGE_DIR = UPLOADS_DIR / "documents"
DOCUMENT_STORAGE_DIR.mkdir(parents=True, exist_ok=True)


@dataclass(frozen=True)
class StoredDocument:
    provider: str
    storage_path: str


class LocalDocumentStorage:
    provider = "local"

    def save(self, *, tenant_id: int, extension: str, content: bytes) -> StoredDocument:
        target_dir = DOCUMENT_STORAGE_DIR / f"tenant-{tenant_id}"
        target_dir.mkdir(parents=True, exist_ok=True)
        path = target_dir / f"{uuid4().hex}.{extension}"
        path.write_bytes(content)
        return StoredDocument(provider=self.provider, storage_path=path.relative_to(UPLOADS_DIR).as_posix())

    def resolve_path(self, storage_path: str) -> Path:
        path = (UPLOADS_DIR / storage_path).resolve()
        root = DOCUMENT_STORAGE_DIR.resolve()
        if root != path and root not in path.parents:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document file not found.")
        if not path.exists() or not path.is_file():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document file not found.")
        return path


def get_document_storage_backend(provider: str = "local") -> LocalDocumentStorage:
    normalized = (provider or "local").strip().lower()
    if normalized == "local":
        return LocalDocumentStorage()
    raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Document storage provider is not configured.")


def supported_storage_providers() -> list[dict]:
    return [
        {
            "provider": "local",
            "label": "Local backend storage",
            "status": "available",
            "requires_oauth": False,
        },
        {
            "provider": "s3",
            "label": "S3-compatible object storage",
            "status": "planned",
            "requires_oauth": False,
        },
        {
            "provider": "google_drive",
            "label": "Google Drive",
            "status": "planned",
            "requires_oauth": True,
        },
        {
            "provider": "microsoft_onedrive",
            "label": "Microsoft OneDrive",
            "status": "planned",
            "requires_oauth": True,
        },
    ]
