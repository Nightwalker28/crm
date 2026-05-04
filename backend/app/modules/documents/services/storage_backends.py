from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

import requests
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


class GoogleDriveDocumentStorage:
    provider = "google_drive"
    upload_url = "https://www.googleapis.com/upload/drive/v3/files"
    api_url = "https://www.googleapis.com/drive/v3/files"

    def __init__(self, *, access_token: str):
        self.access_token = access_token

    def save(self, *, tenant_id: int, extension: str, content: bytes, filename: str, content_type: str) -> StoredDocument:
        metadata = {"name": filename, "description": f"Lynk document upload for tenant {tenant_id}"}
        files = {
            "metadata": (None, json.dumps(metadata), "application/json; charset=UTF-8"),
            "file": (filename, content, content_type),
        }
        response = requests.post(
            self.upload_url,
            params={"uploadType": "multipart", "fields": "id"},
            headers={"Authorization": f"Bearer {self.access_token}"},
            files=files,
            timeout=60,
        )
        body = response.json() if response.content else {}
        if not response.ok or not body.get("id"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to upload document to Google Drive.")
        return StoredDocument(provider=self.provider, storage_path=body["id"])

    def download(self, storage_path: str) -> bytes:
        response = requests.get(
            f"{self.api_url}/{storage_path}",
            params={"alt": "media"},
            headers={"Authorization": f"Bearer {self.access_token}"},
            timeout=60,
        )
        if not response.ok:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document file not found in Google Drive.")
        return response.content


def get_document_storage_backend(provider: str = "local", *, access_token: str | None = None):
    normalized = (provider or "local").strip().lower()
    if normalized == "local":
        return LocalDocumentStorage()
    if normalized == "google_drive":
        if not access_token:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google Drive is not connected.")
        return GoogleDriveDocumentStorage(access_token=access_token)
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
            "status": "available",
            "requires_oauth": True,
        },
        {
            "provider": "microsoft_onedrive",
            "label": "Microsoft OneDrive",
            "status": "planned",
            "requires_oauth": True,
        },
    ]
