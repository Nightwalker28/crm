from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

import requests
from fastapi import HTTPException, status

from app.core.microsoft_oauth import MICROSOFT_GRAPH_BASE
from app.core.uploads import UPLOADS_DIR


DOCUMENT_STORAGE_DIR = UPLOADS_DIR / "documents"
DOCUMENT_STORAGE_DIR.mkdir(parents=True, exist_ok=True)


@dataclass(frozen=True)
class StoredDocument:
    provider: str
    storage_path: str


def _provider_error_detail(response: requests.Response, *, provider_name: str) -> str:
    fallback = response.text[:500] if response.text else response.reason
    try:
        payload = response.json()
    except ValueError:
        payload = None
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict):
            message = error.get("message") or error.get("code")
            if message:
                fallback = str(message)
        elif payload.get("message"):
            fallback = str(payload["message"])
    return f"Failed to upload document to {provider_name}: {fallback or response.status_code}"


class LocalDocumentStorage:
    provider = "local"

    def save(self, *, tenant_id: int, extension: str, content: bytes) -> StoredDocument:
        target_dir = DOCUMENT_STORAGE_DIR / f"tenant-{tenant_id}"
        target_dir.mkdir(parents=True, exist_ok=True)
        path = target_dir / f"{uuid4().hex}.{extension}"
        path.write_bytes(content)
        return StoredDocument(provider=self.provider, storage_path=path.relative_to(DOCUMENT_STORAGE_DIR).as_posix())

    def resolve_path(self, storage_path: str) -> Path:
        root = DOCUMENT_STORAGE_DIR.resolve()
        normalized_path = (storage_path or "").strip().lstrip("/")
        if normalized_path.startswith("documents/"):
            normalized_path = normalized_path.removeprefix("documents/")
        path = (root / normalized_path).resolve()
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
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=_provider_error_detail(response, provider_name="Google Drive"),
            )
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


class MicrosoftOneDriveDocumentStorage:
    provider = "microsoft_onedrive"

    def __init__(self, *, access_token: str):
        self.access_token = access_token

    def save(self, *, tenant_id: int, extension: str, content: bytes, filename: str, content_type: str) -> StoredDocument:
        remote_name = f"{uuid4().hex}.{extension}"
        response = requests.put(
            f"{MICROSOFT_GRAPH_BASE}/me/drive/special/approot:/{remote_name}:/content",
            headers={"Authorization": f"Bearer {self.access_token}", "Content-Type": content_type},
            data=content,
            timeout=60,
        )
        body = response.json() if response.content else {}
        if not response.ok or not body.get("id"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=_provider_error_detail(response, provider_name="Microsoft OneDrive"),
            )
        return StoredDocument(provider=self.provider, storage_path=body["id"])

    def download(self, storage_path: str) -> bytes:
        response = requests.get(
            f"{MICROSOFT_GRAPH_BASE}/me/drive/items/{storage_path}/content",
            headers={"Authorization": f"Bearer {self.access_token}"},
            timeout=60,
        )
        if not response.ok:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document file not found in Microsoft OneDrive.")
        return response.content


def get_document_storage_backend(provider: str = "local", *, access_token: str | None = None):
    normalized = (provider or "local").strip().lower()
    if normalized == "local":
        return LocalDocumentStorage()
    if normalized == "google_drive":
        if not access_token:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google Drive is not connected.")
        return GoogleDriveDocumentStorage(access_token=access_token)
    if normalized == "microsoft_onedrive":
        if not access_token:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Microsoft OneDrive is not connected.")
        return MicrosoftOneDriveDocumentStorage(access_token=access_token)
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
            "status": "available",
            "requires_oauth": True,
        },
    ]
