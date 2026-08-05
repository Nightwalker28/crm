from __future__ import annotations

import json
import re
import urllib.parse
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

import requests
from fastapi import HTTPException, status

from app.core.microsoft_oauth import MICROSOFT_GRAPH_BASE
from app.core.uploads import UPLOADS_DIR


DOCUMENT_STORAGE_DIR = UPLOADS_DIR / "documents"
DOCUMENT_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
LOCAL_SAVE_ATTEMPTS = 5
PROVIDER_FILENAME_MAX_LENGTH = 200
WINDOWS_RESERVED_FILE_STEMS = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{number}" for number in range(1, 10)),
    *(f"LPT{number}" for number in range(1, 10)),
}


@dataclass(frozen=True)
class StoredDocument:
    provider: str
    storage_path: str
    provider_file_id: str | None = None
    provider_parent_id: str | None = None
    provider_path: str | None = None
    external_web_url: str | None = None
    provider_created_at: datetime | None = None


def _trusted_provider_web_url(provider: str, value: object) -> str | None:
    candidate = str(value or "").strip()
    if not candidate:
        return None
    parsed = urlsplit(candidate)
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or parsed.username or parsed.password:
        return None
    if provider == "google_drive" and (hostname == "drive.google.com" or hostname == "docs.google.com"):
        return candidate
    if provider == "microsoft_onedrive" and (
        hostname == "onedrive.live.com" or hostname == "1drv.ms" or hostname.endswith(".sharepoint.com")
    ):
        return candidate
    return None


def _provider_datetime(value: object) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")) if value else None
    except ValueError:
        return None


def _safe_provider_filename(filename: str, extension: str) -> str:
    validated_extension = extension.strip().lower().lstrip(".")
    suffix = f".{validated_extension}"
    candidate = str(filename or "").strip()
    if candidate.lower().endswith(suffix):
        candidate = candidate[: -len(suffix)]
    candidate = re.sub(r'[\x00-\x1f<>:"/\\|?*]', "_", candidate)
    candidate = re.sub(r"\s+", " ", candidate).strip(" .")
    if not candidate:
        candidate = "document"
    if candidate.upper().split(".", 1)[0] in WINDOWS_RESERVED_FILE_STEMS:
        candidate = f"_{candidate}"
    max_stem_length = max(1, PROVIDER_FILENAME_MAX_LENGTH - len(suffix))
    return f"{candidate[:max_stem_length].rstrip(' .')}{suffix}"


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
        for _ in range(LOCAL_SAVE_ATTEMPTS):
            path = target_dir / f"{uuid4().hex}.{extension}"
            try:
                with path.open("xb") as handle:
                    handle.write(content)
            except FileExistsError:
                continue
            storage_path = path.relative_to(DOCUMENT_STORAGE_DIR).as_posix()
            return StoredDocument(provider=self.provider, storage_path=storage_path, provider_path=storage_path)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not store document file.")

    def resolve_path(self, storage_path: str) -> Path:
        root = DOCUMENT_STORAGE_DIR.resolve()
        normalized_path = (storage_path or "").strip()
        if (
            not normalized_path
            or Path(normalized_path).is_absolute()
            or normalized_path.startswith("/")
            or normalized_path.startswith("documents/")
            or "\\" in normalized_path
            or any(part in {"", ".", ".."} for part in Path(normalized_path).parts)
        ):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document file not found.")
        path = (root / normalized_path).resolve()
        if root != path and root not in path.parents:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document file not found.")
        if not path.exists() or not path.is_file():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document file not found.")
        return path

    def delete(self, storage_path: str) -> None:
        try:
            path = self.resolve_path(storage_path)
        except HTTPException:
            return
        path.unlink(missing_ok=True)


class GoogleDriveDocumentStorage:
    provider = "google_drive"
    upload_url = "https://www.googleapis.com/upload/drive/v3/files"
    api_url = "https://www.googleapis.com/drive/v3/files"

    def __init__(self, *, access_token: str):
        self.access_token = access_token

    def save(self, *, tenant_id: int, extension: str, content: bytes, filename: str, content_type: str) -> StoredDocument:
        remote_name = _safe_provider_filename(filename, extension)
        metadata = {"name": remote_name, "description": f"Lynk document upload for tenant {tenant_id}"}
        files = {
            "metadata": (None, json.dumps(metadata), "application/json; charset=UTF-8"),
            "file": (remote_name, content, content_type),
        }
        response = requests.post(
            self.upload_url,
            params={"uploadType": "multipart", "fields": "id,name,webViewLink,parents,createdTime,size,mimeType"},
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
        provider_file_id = str(body["id"])
        web_url = _trusted_provider_web_url(self.provider, body.get("webViewLink"))
        if not web_url:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Google Drive returned an invalid document view URL.")
        parents = body.get("parents") if isinstance(body.get("parents"), list) else []
        return StoredDocument(
            provider=self.provider,
            storage_path=provider_file_id,
            provider_file_id=provider_file_id,
            provider_parent_id=str(parents[0]) if parents else None,
            provider_path=str(body.get("name") or remote_name),
            external_web_url=web_url,
            provider_created_at=_provider_datetime(body.get("createdTime")),
        )

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

    def get_reference(self, storage_path: str) -> dict:
        response = requests.get(
            f"{self.api_url}/{urllib.parse.quote(storage_path, safe='')}",
            params={"fields": "id,name,webViewLink,parents,createdTime,trashed"},
            headers={"Authorization": f"Bearer {self.access_token}"},
            timeout=20,
        )
        if response.status_code == 404:
            return {"status": "missing"}
        if response.status_code in {401, 403}:
            return {"status": "permission_lost"}
        if not response.ok:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Google Drive availability could not be checked.")
        body = response.json()
        parents = body.get("parents") if isinstance(body.get("parents"), list) else []
        return {
            "status": "deleted" if body.get("trashed") else "available",
            "provider_file_id": str(body.get("id") or storage_path),
            "provider_parent_id": str(parents[0]) if parents else None,
            "provider_path": str(body.get("name") or "") or None,
            "external_web_url": _trusted_provider_web_url(self.provider, body.get("webViewLink")),
            "provider_created_at": _provider_datetime(body.get("createdTime")),
        }

    def check_access(self, storage_path: str) -> str:
        return str(self.get_reference(storage_path)["status"])

    def delete(self, storage_path: str) -> None:
        response = requests.delete(
            f"{self.api_url}/{storage_path}",
            headers={"Authorization": f"Bearer {self.access_token}"},
            timeout=30,
        )
        if response.status_code not in {200, 202, 204, 404}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=_provider_error_detail(response, provider_name="Google Drive"),
            )


class MicrosoftOneDriveDocumentStorage:
    provider = "microsoft_onedrive"

    def __init__(self, *, access_token: str):
        self.access_token = access_token

    def save(self, *, tenant_id: int, extension: str, content: bytes, filename: str, content_type: str) -> StoredDocument:
        remote_name = _safe_provider_filename(filename, extension)
        response = requests.put(
            f"{MICROSOFT_GRAPH_BASE}/me/drive/special/approot:/{urllib.parse.quote(remote_name, safe='')}:/content",
            params={"@microsoft.graph.conflictBehavior": "rename"},
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
        provider_file_id = str(body["id"])
        web_url = _trusted_provider_web_url(self.provider, body.get("webUrl"))
        if not web_url:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Microsoft OneDrive returned an invalid document view URL.")
        parent_reference = body.get("parentReference") if isinstance(body.get("parentReference"), dict) else {}
        parent_path = str(parent_reference.get("path") or "").rstrip("/")
        returned_name = str(body.get("name") or remote_name)
        return StoredDocument(
            provider=self.provider,
            storage_path=provider_file_id,
            provider_file_id=provider_file_id,
            provider_parent_id=str(parent_reference.get("id") or "") or None,
            provider_path=f"{parent_path}/{returned_name}" if parent_path else returned_name,
            external_web_url=web_url,
            provider_created_at=_provider_datetime(body.get("createdDateTime")),
        )

    def download(self, storage_path: str) -> bytes:
        response = requests.get(
            f"{MICROSOFT_GRAPH_BASE}/me/drive/items/{storage_path}/content",
            headers={"Authorization": f"Bearer {self.access_token}"},
            timeout=60,
        )
        if not response.ok:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document file not found in Microsoft OneDrive.")
        return response.content

    def get_reference(self, storage_path: str) -> dict:
        response = requests.get(
            f"{MICROSOFT_GRAPH_BASE}/me/drive/items/{urllib.parse.quote(storage_path, safe='')}",
            params={"$select": "id,name,webUrl,parentReference,createdDateTime,deleted"},
            headers={"Authorization": f"Bearer {self.access_token}"},
            timeout=20,
        )
        if response.status_code == 404:
            return {"status": "missing"}
        if response.status_code in {401, 403}:
            return {"status": "permission_lost"}
        if not response.ok:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Microsoft OneDrive availability could not be checked.")
        body = response.json()
        parent_reference = body.get("parentReference") if isinstance(body.get("parentReference"), dict) else {}
        parent_path = str(parent_reference.get("path") or "").rstrip("/")
        returned_name = str(body.get("name") or "")
        return {
            "status": "deleted" if body.get("deleted") else "available",
            "provider_file_id": str(body.get("id") or storage_path),
            "provider_parent_id": str(parent_reference.get("id") or "") or None,
            "provider_path": (f"{parent_path}/{returned_name}" if parent_path and returned_name else parent_path or returned_name or None),
            "external_web_url": _trusted_provider_web_url(self.provider, body.get("webUrl")),
            "provider_created_at": _provider_datetime(body.get("createdDateTime")),
        }

    def check_access(self, storage_path: str) -> str:
        return str(self.get_reference(storage_path)["status"])

    def delete(self, storage_path: str) -> None:
        response = requests.delete(
            f"{MICROSOFT_GRAPH_BASE}/me/drive/items/{storage_path}",
            headers={"Authorization": f"Bearer {self.access_token}"},
            timeout=30,
        )
        if response.status_code not in {200, 202, 204, 404}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=_provider_error_detail(response, provider_name="Microsoft OneDrive"),
            )


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
