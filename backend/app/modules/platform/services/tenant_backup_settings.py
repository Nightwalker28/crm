from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.documents.services.document_services import (
    DOCUMENT_PROVIDER_GOOGLE_DRIVE,
    DOCUMENT_PROVIDER_MICROSOFT_ONEDRIVE,
    require_connected_document_storage,
)
from app.modules.documents.models import DocumentStorageConnection
from app.modules.platform.models import TenantBackupSettings
from app.modules.platform.services.activity_logs import safe_log_activity
from app.modules.user_management.models import Module, TenantModuleConfig


ALLOWED_FREQUENCIES = {"manual", "daily", "weekly", "monthly"}
ALLOWED_SCOPES = {"full_tenant", "selected_modules"}
ALLOWED_RETENTION_COUNTS = {3, 7, 14, 30}
ALLOWED_DESTINATIONS = {"local_download", "google_drive", "onedrive"}
DESTINATION_PROVIDERS = {
    "google_drive": DOCUMENT_PROVIDER_GOOGLE_DRIVE,
    "onedrive": DOCUMENT_PROVIDER_MICROSOFT_ONEDRIVE,
}
PROVIDER_DESTINATIONS = {provider: destination for destination, provider in DESTINATION_PROVIDERS.items()}
DEFAULT_SETTINGS = {
    "enabled": False,
    "frequency": "manual",
    "scope": "full_tenant",
    "selected_modules": [],
    "retention_count": 3,
    "destination": "local_download",
    "include_documents": True,
}


def _next_run_at(*, enabled: bool, frequency: str, now: datetime | None = None) -> datetime | None:
    if not enabled or frequency == "manual":
        return None
    current = now or datetime.now(timezone.utc)
    if frequency == "daily":
        return current + timedelta(days=1)
    if frequency == "weekly":
        return current + timedelta(days=7)
    if frequency == "monthly":
        return current + timedelta(days=30)
    return None


def _validate_choice(value: Any, allowed: set[Any], field_name: str) -> Any:
    if value not in allowed:
        allowed_values = ", ".join(str(item) for item in sorted(allowed))
        raise HTTPException(
            status_code=422,
            detail=f"{field_name} must be one of: {allowed_values}",
        )
    return value


def _validate_selected_modules(db: Session, *, tenant_id: int, selected_modules: list[str], scope: str) -> list[str]:
    normalized = []
    seen = set()
    for module_key in selected_modules:
        value = str(module_key).strip()
        if not value:
            continue
        if len(value) > 100:
            raise HTTPException(status_code=422, detail="selected_modules contains an invalid module key")
        if value not in seen:
            normalized.append(value)
            seen.add(value)

    if scope == "full_tenant":
        return []
    if not normalized:
        raise HTTPException(status_code=422, detail="selected_modules is required when scope is selected_modules")

    existing = {
        row.name
        for row in db.query(Module.name)
        .join(TenantModuleConfig, TenantModuleConfig.module_id == Module.id)
        .filter(
            TenantModuleConfig.tenant_id == tenant_id,
            TenantModuleConfig.is_enabled == 1,
            Module.name.in_(normalized),
        )
        .all()
    }
    missing = [module_key for module_key in normalized if module_key not in existing]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown module key: {missing[0]}",
        )
    return normalized


def _validate_destination_connection(db: Session, *, tenant_id: int, actor_user_id: int, destination: str) -> None:
    provider = DESTINATION_PROVIDERS.get(destination)
    if not provider:
        return
    require_connected_document_storage(db, tenant_id=tenant_id, user_id=actor_user_id, provider=provider)


def serialize_tenant_backup_settings(settings: TenantBackupSettings) -> dict[str, Any]:
    return {
        "id": settings.id,
        "tenant_id": settings.tenant_id,
        "enabled": bool(settings.enabled),
        "frequency": settings.frequency,
        "scope": settings.scope,
        "selected_modules": list(settings.selected_modules or []),
        "retention_count": int(settings.retention_count),
        "destination": settings.destination,
        "include_documents": bool(settings.include_documents),
        "created_by_id": settings.created_by_id,
        "updated_by_id": settings.updated_by_id,
        "last_run_at": settings.last_run_at,
        "next_run_at": settings.next_run_at,
        "created_at": settings.created_at,
        "updated_at": settings.updated_at,
    }


def list_tenant_backup_destination_connections(db: Session, *, tenant_id: int, actor_user_id: int) -> list[dict[str, Any]]:
    rows = (
        db.query(DocumentStorageConnection)
        .filter(
            DocumentStorageConnection.tenant_id == tenant_id,
            DocumentStorageConnection.user_id == actor_user_id,
            DocumentStorageConnection.provider.in_(set(PROVIDER_DESTINATIONS)),
        )
        .order_by(DocumentStorageConnection.provider.asc())
        .all()
    )
    return [
        {
            "destination": PROVIDER_DESTINATIONS[connection.provider],
            "provider": connection.provider,
            "status": connection.status,
            "account_email": connection.account_email,
            "provider_root_name": connection.provider_root_name,
            "last_error": connection.last_error,
            "updated_at": connection.updated_at,
        }
        for connection in rows
    ]


def get_or_create_tenant_backup_settings(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int | None = None,
) -> TenantBackupSettings:
    settings = (
        db.query(TenantBackupSettings)
        .filter(TenantBackupSettings.tenant_id == tenant_id)
        .first()
    )
    if settings:
        return settings

    settings = TenantBackupSettings(
        tenant_id=tenant_id,
        created_by_id=actor_user_id,
        updated_by_id=actor_user_id,
        next_run_at=None,
        **DEFAULT_SETTINGS,
    )
    db.add(settings)
    db.commit()
    db.refresh(settings)
    return settings


def update_tenant_backup_settings(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int,
    payload: dict[str, Any],
) -> TenantBackupSettings:
    settings = get_or_create_tenant_backup_settings(db, tenant_id=tenant_id, actor_user_id=actor_user_id)
    before_state = serialize_tenant_backup_settings(settings)

    enabled = bool(payload.get("enabled", settings.enabled))
    frequency = _validate_choice(payload.get("frequency", settings.frequency), ALLOWED_FREQUENCIES, "frequency")
    scope = _validate_choice(payload.get("scope", settings.scope), ALLOWED_SCOPES, "scope")
    retention_count = int(payload.get("retention_count", settings.retention_count))
    _validate_choice(retention_count, ALLOWED_RETENTION_COUNTS, "retention_count")
    destination = _validate_choice(payload.get("destination", settings.destination), ALLOWED_DESTINATIONS, "destination")
    _validate_destination_connection(db, tenant_id=tenant_id, actor_user_id=actor_user_id, destination=destination)
    include_documents = bool(payload.get("include_documents", settings.include_documents))
    selected_modules = _validate_selected_modules(
        db,
        tenant_id=tenant_id,
        selected_modules=list(payload.get("selected_modules", settings.selected_modules or [])),
        scope=scope,
    )

    settings.enabled = enabled
    settings.frequency = frequency
    settings.scope = scope
    settings.selected_modules = selected_modules
    settings.retention_count = retention_count
    settings.destination = destination
    settings.include_documents = include_documents
    settings.updated_by_id = actor_user_id
    settings.next_run_at = _next_run_at(enabled=enabled, frequency=frequency)

    db.commit()
    db.refresh(settings)

    safe_log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key="tenant_backups",
        entity_type="tenant_backup_settings",
        entity_id=settings.id,
        action="backup.settings.updated",
        description="Updated tenant backup settings",
        before_state=before_state,
        after_state=serialize_tenant_backup_settings(settings),
    )
    return settings
