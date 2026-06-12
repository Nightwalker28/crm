from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.modules.calendar.models import UserCalendarConnection
from app.modules.documents.models import DocumentStorageConnection
from app.modules.mail.models import UserMailConnection
from app.modules.platform.models import IntegrationConnection, IntegrationProvider, IntegrationSyncRun, NotificationChannel
from app.modules.website_integrations.models import WebsiteIntegrationApiKey


KNOWN_PROVIDERS = [
    {
        "key": "google_mail",
        "name": "Gmail",
        "category": "Communication",
        "description": "Google mailbox sending and opt-in inbox sync.",
        "metadata_json": {
            "config_href": "/dashboard/settings/integrations",
            "reconnect_href": "/dashboard/settings/integrations",
            "reconnect_action": "Connect Gmail",
            "source": "mail",
        },
    },
    {
        "key": "microsoft_mail",
        "name": "Microsoft Mail",
        "category": "Communication",
        "description": "Microsoft Graph mailbox sending and opt-in inbox sync.",
        "metadata_json": {
            "config_href": "/dashboard/settings/integrations",
            "reconnect_href": "/dashboard/settings/integrations",
            "reconnect_action": "Connect Microsoft Mail",
            "source": "mail",
        },
    },
    {
        "key": "imap_smtp_mail",
        "name": "IMAP / SMTP",
        "category": "Communication",
        "description": "Custom mailbox connection for sending and inbox sync.",
        "metadata_json": {
            "config_href": "/dashboard/settings/integrations",
            "reconnect_href": "/dashboard/settings/integrations",
            "reconnect_action": "Reconnect IMAP / SMTP",
            "source": "mail",
        },
    },
    {
        "key": "google_calendar",
        "name": "Google Calendar",
        "category": "Scheduling",
        "description": "Google Calendar sync for CRM calendar events.",
        "metadata_json": {
            "config_href": "/dashboard/settings/integrations",
            "reconnect_href": "/dashboard/settings/integrations",
            "reconnect_action": "Reconnect Google Calendar",
            "source": "calendar",
        },
    },
    {
        "key": "microsoft_calendar",
        "name": "Microsoft Calendar",
        "category": "Scheduling",
        "description": "Microsoft Calendar connection readiness.",
        "metadata_json": {
            "config_href": "/dashboard/settings/integrations",
            "reconnect_href": "/dashboard/settings/integrations",
            "reconnect_action": "Reconnect Microsoft Calendar",
            "source": "calendar",
        },
    },
    {
        "key": "google_drive",
        "name": "Google Drive",
        "category": "Documents",
        "description": "External document storage connection.",
        "metadata_json": {
            "config_href": "/dashboard/settings/integrations",
            "reconnect_href": "/dashboard/settings/integrations",
            "reconnect_action": "Reconnect Google Drive",
            "source": "documents",
        },
    },
    {
        "key": "microsoft_onedrive",
        "name": "Microsoft OneDrive",
        "category": "Documents",
        "description": "Microsoft OneDrive document storage connection.",
        "metadata_json": {
            "config_href": "/dashboard/settings/integrations",
            "reconnect_href": "/dashboard/settings/integrations",
            "reconnect_action": "Reconnect OneDrive",
            "source": "documents",
        },
    },
    {
        "key": "website_api",
        "name": "Website API",
        "category": "Website",
        "description": "Scoped API keys for public catalog reads and website order writeback.",
        "metadata_json": {
            "config_href": "/dashboard/settings/integrations#website-apis",
            "reconnect_href": "/dashboard/settings/integrations#website-apis",
            "reconnect_action": "Create API Key",
            "source": "website",
        },
    },
    {
        "key": "slack_webhooks",
        "name": "Slack Webhooks",
        "category": "Notifications",
        "description": "Slack incoming webhooks for CRM event alerts.",
        "metadata_json": {
            "config_href": "/dashboard/settings/integrations#webhooks",
            "reconnect_href": "/dashboard/settings/integrations#webhooks",
            "reconnect_action": "Add Slack Webhook",
            "source": "notifications",
        },
    },
    {
        "key": "teams_webhooks",
        "name": "Microsoft Teams Webhooks",
        "category": "Notifications",
        "description": "Microsoft Teams incoming webhooks for CRM event alerts.",
        "metadata_json": {
            "config_href": "/dashboard/settings/integrations#webhooks",
            "reconnect_href": "/dashboard/settings/integrations#webhooks",
            "reconnect_action": "Add Teams Webhook",
            "source": "notifications",
        },
    },
]

_PUBLIC_SETTINGS_KEYS = {"label", "last_failure_reason", "notes", "scope_summary"}


def _public_settings(settings: dict[str, Any] | None) -> dict[str, Any]:
    return {key: value for key, value in (settings or {}).items() if key in _PUBLIC_SETTINGS_KEYS}


def _latest(*values: datetime | None) -> datetime | None:
    candidates = [value for value in values if value is not None]
    return max(candidates) if candidates else None


def _aggregate_status(rows) -> str:
    statuses = {str(row.status).lower() for row in rows}
    if "expired" in statuses or "reconnect_required" in statuses:
        return "reconnect_required"
    if "connected" in statuses or "active" in statuses:
        return "connected"
    if "error" in statuses:
        return "error"
    if "pending" in statuses:
        return "pending"
    return "disconnected"


def _normalize_scopes(value: Any) -> list[str]:
    if isinstance(value, list):
        return sorted({str(item).strip() for item in value if str(item).strip()})
    if isinstance(value, str):
        return sorted({part.strip() for part in value.replace(",", " ").split() if part.strip()})
    return []


def _credential_state_for_rows(rows) -> str:
    rows = list(rows)
    if not rows:
        return "not_configured"
    now = datetime.now(timezone.utc)
    has_connected = False
    has_expired = False
    for row in rows:
        status = str(getattr(row, "status", "") or "").lower()
        if status in {"expired", "reconnect_required"}:
            has_expired = True
        expires_at = getattr(row, "token_expires_at", None)
        if expires_at is not None:
            comparable = expires_at if expires_at.tzinfo is not None else expires_at.replace(tzinfo=timezone.utc)
            if comparable <= now and not getattr(row, "refresh_token", None):
                has_expired = True
        if status in {"connected", "active"}:
            has_connected = True
    if has_expired:
        return "expired"
    if has_connected:
        return "valid"
    return "not_configured"


def _health_status(status: str, credential_state: str, last_error: str | None) -> str:
    if last_error or status == "error":
        return "error"
    if status == "reconnect_required" or credential_state == "expired":
        return "reconnect_required"
    if status == "connected":
        return "healthy"
    if status == "pending":
        return "pending"
    return "not_configured"


def _aggregate_rows(rows, *, last_sync_attr: str | None = None, error_attr: str | None = None) -> dict[str, Any]:
    rows = list(rows)
    last_sync_at = _latest(*(getattr(row, last_sync_attr, None) for row in rows)) if last_sync_attr else None
    errors = [getattr(row, error_attr, None) for row in rows] if error_attr else []
    last_error = next((error for error in errors if error), None)
    scopes: set[str] = set()
    for row in rows:
        scopes.update(_normalize_scopes(getattr(row, "scopes", None)))
    status = _aggregate_status(rows)
    credential_state = _credential_state_for_rows(rows)
    return {
        "status": "reconnect_required" if credential_state == "expired" and status == "connected" else status,
        "connection_count": sum(1 for row in rows if str(row.status).lower() in {"connected", "active"}),
        "last_sync_at": last_sync_at,
        "last_successful_sync_at": last_sync_at if not last_error else None,
        "last_error": last_error,
        "last_failure_reason": last_error,
        "credential_state": credential_state,
        "scopes": sorted(scopes),
    }


def seed_provider_registry(db: Session) -> list[IntegrationProvider]:
    current = {provider.key: provider for provider in db.query(IntegrationProvider).all()}
    changed = False
    for definition in KNOWN_PROVIDERS:
        provider = current.get(definition["key"])
        if provider is None:
            provider = IntegrationProvider(enabled=True, **definition)
            db.add(provider)
            current[provider.key] = provider
            changed = True
            continue
        for key, value in definition.items():
            if getattr(provider, key) != value:
                setattr(provider, key, value)
                changed = True
    if changed:
        db.commit()
    return list_provider_registry(db)


def list_provider_registry(db: Session) -> list[IntegrationProvider]:
    return db.query(IntegrationProvider).filter(IntegrationProvider.enabled.is_(True)).order_by(IntegrationProvider.category.asc(), IntegrationProvider.name.asc()).all()


def list_registry_connections(db: Session, *, tenant_id: int) -> list[IntegrationConnection]:
    return db.query(IntegrationConnection).filter(IntegrationConnection.tenant_id == tenant_id).order_by(IntegrationConnection.provider_key.asc()).all()


def serialize_registry_connection(connection: IntegrationConnection) -> dict[str, Any]:
    settings = _public_settings(connection.settings_json)
    scopes = _normalize_scopes(settings.get("scope_summary"))
    last_failure_reason = settings.get("last_failure_reason")
    return {
        "id": connection.id,
        "provider_key": connection.provider_key,
        "status": connection.status,
        "provider_display_name": connection.provider.name if connection.provider else connection.provider_key,
        "connected_by_id": connection.connected_by_id,
        "connected_at": connection.connected_at,
        "last_sync_at": connection.last_sync_at,
        "last_successful_sync_at": connection.last_sync_at if connection.status == "connected" else None,
        "settings_json": settings,
        "source": "registry",
        "connection_count": 1 if connection.status == "connected" else 0,
        "credential_state": "valid" if connection.status == "connected" else "not_configured",
        "health_status": _health_status(connection.status, "valid" if connection.status == "connected" else "not_configured", last_failure_reason),
        "scopes": scopes,
        "last_error": last_failure_reason,
        "last_failure_reason": last_failure_reason,
        "reconnect_url": (connection.provider.metadata_json or {}).get("reconnect_href") if connection.provider else None,
        "reconnect_action": (connection.provider.metadata_json or {}).get("reconnect_action") if connection.provider else None,
        "created_at": connection.created_at,
        "updated_at": connection.updated_at,
    }


def _derived_connections(db: Session, *, tenant_id: int) -> dict[str, dict[str, Any]]:
    derived: dict[str, dict[str, Any]] = {}

    mail_rows = db.query(UserMailConnection).filter(UserMailConnection.tenant_id == tenant_id).all()
    for source_key, provider_key in {"google": "google_mail", "microsoft": "microsoft_mail", "imap_smtp": "imap_smtp_mail"}.items():
        rows = [row for row in mail_rows if row.provider == source_key]
        if rows:
            derived[provider_key] = {**_aggregate_rows(rows, last_sync_attr="last_synced_at", error_attr="last_error"), "source": "mail"}

    calendar_rows = db.query(UserCalendarConnection).filter(UserCalendarConnection.tenant_id == tenant_id).all()
    for source_key, provider_key in {"google": "google_calendar", "microsoft": "microsoft_calendar"}.items():
        rows = [row for row in calendar_rows if row.provider == source_key]
        if rows:
            derived[provider_key] = {**_aggregate_rows(rows, last_sync_attr="last_synced_at", error_attr="last_error"), "source": "calendar"}

    storage_rows = db.query(DocumentStorageConnection).filter(DocumentStorageConnection.tenant_id == tenant_id).all()
    for source_key, provider_key in {"google_drive": "google_drive", "microsoft_onedrive": "microsoft_onedrive"}.items():
        rows = [row for row in storage_rows if row.provider == source_key]
        if rows:
            derived[provider_key] = {**_aggregate_rows(rows, error_attr="last_error"), "source": "documents"}

    website_keys = db.query(WebsiteIntegrationApiKey).filter(WebsiteIntegrationApiKey.tenant_id == tenant_id).all()
    if website_keys:
        active_keys = [key for key in website_keys if key.status == "active"]
        derived["website_api"] = {
            "status": "connected" if active_keys else "disconnected",
            "connection_count": len(active_keys),
            "last_sync_at": _latest(*(key.last_used_at for key in website_keys)),
            "last_successful_sync_at": _latest(*(key.last_used_at for key in website_keys)),
            "last_error": None,
            "last_failure_reason": None,
            "credential_state": "valid" if active_keys else "not_configured",
            "scopes": sorted({scope for key in active_keys for scope in (key.scopes or [])}),
            "source": "website",
        }

    channels = db.query(NotificationChannel).filter(NotificationChannel.tenant_id == tenant_id).all()
    for source_key, provider_key in {"slack": "slack_webhooks", "teams": "teams_webhooks"}.items():
        rows = [channel for channel in channels if channel.provider == source_key]
        if rows:
            active_rows = [channel for channel in rows if channel.is_active]
            derived[provider_key] = {
                "status": "connected" if active_rows else "disconnected",
                "connection_count": len(active_rows),
                "last_sync_at": None,
                "last_successful_sync_at": None,
                "last_error": None,
                "last_failure_reason": None,
                "credential_state": "valid" if active_rows else "not_configured",
                "scopes": [],
                "source": "notifications",
            }
    return derived


def _merge_connection(provider_key: str, registry: IntegrationConnection | None, derived: dict[str, Any] | None) -> dict[str, Any]:
    provider = registry.provider if registry else None
    metadata = provider.metadata_json if provider else {}
    base = serialize_registry_connection(registry) if registry else {
        "id": None,
        "provider_key": provider_key,
        "status": "disconnected",
        "provider_display_name": None,
        "connected_by_id": None,
        "connected_at": None,
        "last_sync_at": None,
        "last_successful_sync_at": None,
        "settings_json": {},
        "source": "provider_catalog",
        "connection_count": 0,
        "credential_state": "not_configured",
        "health_status": "not_configured",
        "scopes": [],
        "last_error": None,
        "last_failure_reason": None,
        "reconnect_url": None,
        "reconnect_action": None,
        "created_at": None,
        "updated_at": None,
    }
    if derived:
        base.update({
            "status": derived["status"],
            "last_sync_at": _latest(base["last_sync_at"], derived["last_sync_at"]),
            "last_successful_sync_at": _latest(base["last_successful_sync_at"], derived["last_successful_sync_at"]),
            "source": derived["source"] if not registry else f'{derived["source"]}+registry',
            "connection_count": derived["connection_count"],
            "last_error": derived["last_error"],
            "last_failure_reason": derived["last_failure_reason"],
            "credential_state": derived["credential_state"],
            "scopes": derived["scopes"],
        })
    if provider is not None:
        base["provider_display_name"] = provider.name
        base["reconnect_url"] = metadata.get("reconnect_href")
        base["reconnect_action"] = metadata.get("reconnect_action")
    base["health_status"] = _health_status(base["status"], base["credential_state"], base["last_failure_reason"])
    return base


def list_integration_health(db: Session, *, tenant_id: int) -> list[dict[str, Any]]:
    providers = seed_provider_registry(db)
    registry = {connection.provider_key: connection for connection in list_registry_connections(db, tenant_id=tenant_id)}
    derived = _derived_connections(db, tenant_id=tenant_id)
    return [
        {
            "provider": provider,
            "connection": {
                **_merge_connection(provider.key, registry.get(provider.key), derived.get(provider.key)),
                "provider_display_name": provider.name,
                "reconnect_url": (provider.metadata_json or {}).get("reconnect_href"),
                "reconnect_action": (provider.metadata_json or {}).get("reconnect_action"),
            },
        }
        for provider in providers
    ]


def list_integration_connections(db: Session, *, tenant_id: int) -> list[dict[str, Any]]:
    return [
        item["connection"]
        for item in list_integration_health(db, tenant_id=tenant_id)
        if item["connection"]["id"] is not None or item["connection"]["connection_count"] > 0
    ]


def list_sync_runs(db: Session, *, tenant_id: int, provider_key: str | None = None, limit: int = 50) -> list[IntegrationSyncRun]:
    query = db.query(IntegrationSyncRun).join(IntegrationConnection).filter(IntegrationSyncRun.tenant_id == tenant_id, IntegrationConnection.tenant_id == tenant_id)
    if provider_key:
        query = query.filter(IntegrationConnection.provider_key == provider_key)
    return query.order_by(IntegrationSyncRun.started_at.desc(), IntegrationSyncRun.id.desc()).limit(limit).all()


def serialize_sync_run(run: IntegrationSyncRun) -> dict[str, Any]:
    return {
        "id": run.id,
        "connection_id": run.connection_id,
        "provider_key": run.connection.provider_key,
        "status": run.status,
        "started_at": run.started_at,
        "finished_at": run.finished_at,
        "result_json": run.result_json or {},
        "error_message": run.error_message,
    }


def upsert_integration_connection(db: Session, *, tenant_id: int, provider_key: str, status: str, connected_by_id: int | None = None, settings_json: dict[str, Any] | None = None, last_sync_at: datetime | None = None) -> IntegrationConnection:
    provider = db.query(IntegrationProvider).filter(IntegrationProvider.key == provider_key, IntegrationProvider.enabled.is_(True)).first()
    if provider is None:
        seed_provider_registry(db)
        provider = db.query(IntegrationProvider).filter(IntegrationProvider.key == provider_key, IntegrationProvider.enabled.is_(True)).first()
    if provider is None:
        raise ValueError("Unknown integration provider")
    connection = db.query(IntegrationConnection).filter(IntegrationConnection.tenant_id == tenant_id, IntegrationConnection.provider_key == provider_key).first()
    if connection is None:
        connection = IntegrationConnection(tenant_id=tenant_id, provider_key=provider_key)
        db.add(connection)
    connection.status = status
    connection.connected_by_id = connected_by_id
    connection.connected_at = connection.connected_at or (datetime.now(timezone.utc) if status == "connected" else None)
    connection.last_sync_at = last_sync_at
    connection.settings_json = settings_json or {}
    db.commit()
    db.refresh(connection)
    return connection


def record_sync_run(db: Session, *, connection: IntegrationConnection, status: str, result_json: dict[str, Any] | None = None, error_message: str | None = None, finished_at: datetime | None = None) -> IntegrationSyncRun:
    run = IntegrationSyncRun(
        tenant_id=connection.tenant_id,
        connection_id=connection.id,
        status=status,
        result_json=result_json or {},
        error_message=error_message,
        finished_at=finished_at,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run
