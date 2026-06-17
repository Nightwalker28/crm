from __future__ import annotations

import logging
import re
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import requests
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.encrypted_fields import get_encrypted_model_value, set_encrypted_model_value
from app.core.microsoft_oauth import MICROSOFT_CALENDAR_SCOPE, MICROSOFT_GRAPH_BASE, microsoft_scope_string, microsoft_token_url
from app.modules.calendar.models import CalendarEvent, CalendarEventParticipant, UserCalendarConnection
from app.modules.calendar.repositories import calendar_repository
from app.modules.calendar.schema import CalendarProvider
from app.modules.platform.models import UserNotification
from app.modules.tasks.services.tasks_services import get_task_or_404
from app.modules.user_management.models import Team, User
from app.core.config import settings


GOOGLE_CALENDAR_APP_CREATED_SCOPE = "https://www.googleapis.com/auth/calendar.app.created"
GOOGLE_CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events"
GOOGLE_CALENDAR_METADATA_SCOPE = "https://www.googleapis.com/auth/calendar.calendars"
GOOGLE_CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3"
GOOGLE_CALENDAR_EVENTS_URL = f"{GOOGLE_CALENDAR_API_BASE}/calendars/primary/events"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_APP_CALENDAR_NAME = "CRM"
GOOGLE_CALENDAR_ID_PATTERN = re.compile(r"^[A-Za-z0-9._%+-]+(?:@[A-Za-z0-9.-]+)?$")
logger = logging.getLogger(__name__)
CALENDAR_SYNC_BATCH_SIZE = 50


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _display_user_name(user: User | None) -> str | None:
    if not user:
        return None
    full_name = " ".join(part for part in [user.first_name, user.last_name] if part).strip()
    return full_name or user.email or None


def _participant_key(participant_type: str, target_id: int) -> str:
    return f"{participant_type}:{target_id}"


def _coerce_participant_id(value, detail: str) -> int:
    try:
        coerced = int(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail) from exc
    if coerced <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)
    return coerced


def _normalize_participants(
    db: Session,
    *,
    tenant_id: int,
    owner_user_id: int,
    participants_payload: list[dict] | None,
) -> list[dict]:
    normalized: list[dict] = [
        {
            "participant_type": "user",
            "participant_key": _participant_key("user", owner_user_id),
            "user_id": owner_user_id,
            "team_id": None,
            "response_status": "accepted",
            "is_owner": True,
        }
    ]
    seen_keys = {normalized[0]["participant_key"]}
    user_ids: set[int] = set()
    team_ids: set[int] = set()
    for item in participants_payload or []:
        if item.get("participant_type") == "user" and item.get("user_id"):
            user_ids.add(_coerce_participant_id(item.get("user_id"), "User participant requires user_id"))
        if item.get("participant_type") == "team" and item.get("team_id"):
            team_ids.add(_coerce_participant_id(item.get("team_id"), "Team participant requires team_id"))
    existing_user_ids = calendar_repository.existing_participant_user_ids(db, tenant_id=tenant_id, user_ids=user_ids)
    existing_team_ids = calendar_repository.existing_participant_team_ids(db, tenant_id=tenant_id, team_ids=team_ids)

    for item in participants_payload or []:
        participant_type = item.get("participant_type")
        if participant_type == "user":
            user_id = item.get("user_id")
            if not user_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User participant requires user_id")
            user_id = _coerce_participant_id(user_id, "User participant requires user_id")
            if user_id not in existing_user_ids:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Participant user not found")
            key = _participant_key("user", user_id)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            normalized.append(
                {
                    "participant_type": "user",
                    "participant_key": key,
                    "user_id": user_id,
                    "team_id": None,
                    "response_status": "accepted" if user_id == owner_user_id else "pending",
                    "is_owner": user_id == owner_user_id,
                }
            )
            continue

        if participant_type == "team":
            team_id = item.get("team_id")
            if not team_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Team participant requires team_id")
            team_id = _coerce_participant_id(team_id, "Team participant requires team_id")
            if team_id not in existing_team_ids:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Participant team not found")
            key = _participant_key("team", team_id)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            normalized.append(
                {
                    "participant_type": "team",
                    "participant_key": key,
                    "user_id": None,
                    "team_id": team_id,
                    "response_status": "shared",
                    "is_owner": False,
                }
            )
            continue

        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported participant type")

    return normalized


def _apply_event_participants(
    db: Session,
    *,
    event: CalendarEvent,
    tenant_id: int,
    owner_user_id: int,
    participants_payload: list[dict] | None,
) -> tuple[list[CalendarEventParticipant], list[CalendarEventParticipant], list[CalendarEventParticipant]]:
    normalized = _normalize_participants(
        db,
        tenant_id=tenant_id,
        owner_user_id=owner_user_id,
        participants_payload=participants_payload,
    )
    next_map = {item["participant_key"]: item for item in normalized}
    current_map = {item.participant_key: item for item in event.participants}

    added: list[CalendarEventParticipant] = []
    removed: list[CalendarEventParticipant] = []
    changed: list[CalendarEventParticipant] = []

    for key in [key for key in current_map if key not in next_map]:
        removed.append(current_map[key])
        db.delete(current_map[key])

    for key, item in next_map.items():
        existing = current_map.get(key)
        if existing:
            existing.participant_type = item["participant_type"]
            existing.user_id = item["user_id"]
            existing.team_id = item["team_id"]
            existing.is_owner = item["is_owner"]
            if existing.is_owner:
                existing.response_status = "accepted"
                existing.responded_at = existing.responded_at or _utcnow()
            changed.append(existing)
            continue

        participant = CalendarEventParticipant(
            tenant_id=tenant_id,
            event_id=event.id,
            participant_type=item["participant_type"],
            participant_key=key,
            user_id=item["user_id"],
            team_id=item["team_id"],
            response_status=item["response_status"],
            is_owner=item["is_owner"],
            responded_at=_utcnow() if item["response_status"] in {"accepted", "shared"} else None,
        )
        db.add(participant)
        added.append(participant)

    db.flush()
    return added, removed, changed


def _serialize_connection(connection: UserCalendarConnection, *, current_user) -> dict:
    scopes = connection.scopes if isinstance(connection.scopes, list) else []
    refresh_token_present = bool(connection.refresh_token)
    access_token_present = bool(connection.access_token)
    expires_at = _as_aware_utc(connection.token_expires_at)
    token_is_expired = bool(expires_at and expires_at <= _utcnow())
    session_provider_matches = current_user.last_login_provider == connection.provider

    if connection.status != "connected" or not refresh_token_present:
        credential_state = "reconnect_required"
    elif token_is_expired:
        credential_state = "refresh_available"
    elif access_token_present:
        credential_state = "active"
    else:
        credential_state = "refresh_available"

    if connection.status == "error":
        health_status = "error"
    elif connection.status != "connected":
        health_status = "disconnected"
    elif credential_state == "reconnect_required":
        health_status = "reconnect_required"
    elif not session_provider_matches:
        health_status = "session_provider_mismatch"
    elif connection.last_error:
        health_status = "warning"
    else:
        health_status = "healthy"

    reconnect_required = connection.status != "connected" or credential_state == "reconnect_required"
    reconnect_label = None
    if reconnect_required:
        reconnect_label = f"Reconnect {connection.provider.title()} Calendar"
    elif not session_provider_matches:
        reconnect_label = f"Sign in with {connection.provider.title()} to sync this calendar"

    return {
        "provider": connection.provider,
        "status": connection.status,
        "account_email": connection.account_email,
        "provider_calendar_id": connection.provider_calendar_id,
        "provider_calendar_name": connection.provider_calendar_name,
        "sync_enabled_for_current_session": bool(session_provider_matches and connection.status == "connected" and refresh_token_present),
        "last_synced_at": connection.last_synced_at,
        "last_error": connection.last_error,
        "health_status": health_status,
        "credential_state": credential_state,
        "scopes": [str(scope) for scope in scopes if scope],
        "last_successful_sync_at": connection.last_synced_at,
        "last_failure_reason": connection.last_error,
        "reconnect_required": reconnect_required,
        "reconnect_label": reconnect_label,
    }


def serialize_calendar_event(event: CalendarEvent, *, current_user=None) -> dict:
    current_user_response = None
    if current_user is not None:
        for participant in event.participants:
            if participant.user_id == current_user.id:
                current_user_response = participant.response_status
                break
            if getattr(current_user, "team_id", None) and participant.team_id == current_user.team_id:
                current_user_response = participant.response_status
    return {
        "id": event.id,
        "title": event.title,
        "description": event.description,
        "start_at": event.start_at,
        "end_at": event.end_at,
        "is_all_day": bool(event.is_all_day),
        "location": event.location,
        "meeting_url": event.meeting_url,
        "status": event.status,
        "owner_user_id": event.owner_user_id,
        "owner_name": _display_user_name(event.owner),
        "source_module_key": event.source_module_key,
        "source_entity_id": event.source_entity_id,
        "source_label": event.source_label,
        "current_user_response": current_user_response,
        "participants": [
            {
                "participant_type": participant.participant_type,
                "participant_key": participant.participant_key,
                "user_id": participant.user_id,
                "team_id": participant.team_id,
                "response_status": participant.response_status,
                "is_owner": bool(participant.is_owner),
                "label": participant.label,
            }
            for participant in sorted(event.participants, key=lambda item: (0 if item.is_owner else 1, item.participant_key))
        ],
        "created_at": event.created_at,
        "updated_at": event.updated_at,
    }


def list_calendar_events(
    db: Session,
    *,
    tenant_id: int,
    current_user,
    start_at: datetime,
    end_at: datetime,
) -> list[CalendarEvent]:
    return calendar_repository.list_calendar_events(db, tenant_id=tenant_id, current_user=current_user, start_at=start_at, end_at=end_at)


def list_calendar_events_cursor(
    db: Session,
    *,
    tenant_id: int,
    current_user,
    limit: int,
    cursor: int | None = None,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
) -> list[CalendarEvent]:
    return calendar_repository.list_calendar_events_cursor(
        db,
        tenant_id=tenant_id,
        current_user=current_user,
        limit=limit,
        cursor=cursor,
        start_at=start_at,
        end_at=end_at,
    )


def list_pending_invites(db: Session, *, tenant_id: int, current_user) -> list[CalendarEvent]:
    return calendar_repository.list_pending_invites(db, tenant_id=tenant_id, current_user=current_user)


def get_calendar_event_or_404(
    db: Session,
    event_id: int,
    *,
    tenant_id: int,
    current_user,
    include_deleted: bool = False,
) -> CalendarEvent:
    event = calendar_repository.get_visible_calendar_event(
        db,
        event_id=event_id,
        tenant_id=tenant_id,
        current_user=current_user,
        include_deleted=include_deleted,
    )
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calendar event not found")
    return event


def _google_connection_for_user(
    db: Session,
    *,
    tenant_id: int,
    user_id: int,
    include_non_connected: bool = False,
) -> UserCalendarConnection | None:
    return calendar_repository.google_connection_for_user(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        include_non_connected=include_non_connected,
    )


def _microsoft_connection_for_user(
    db: Session,
    *,
    tenant_id: int,
    user_id: int,
    include_non_connected: bool = False,
) -> UserCalendarConnection | None:
    return calendar_repository.microsoft_connection_for_user(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        include_non_connected=include_non_connected,
    )


def _calendar_connection_for_user(db: Session, *, tenant_id: int, user_id: int, provider: str) -> UserCalendarConnection | None:
    if provider == CalendarProvider.google.value:
        return _google_connection_for_user(db, tenant_id=tenant_id, user_id=user_id)
    if provider == CalendarProvider.microsoft.value:
        return _microsoft_connection_for_user(db, tenant_id=tenant_id, user_id=user_id)
    return None


def _set_calendar_connection_token(connection: UserCalendarConnection, field_name: str, value: str | None) -> None:
    set_encrypted_model_value(connection, field_name, value, key_version_field=f"{field_name}_key_version")


def _calendar_connection_token(db: Session, connection: UserCalendarConnection, field_name: str) -> str | None:
    return get_encrypted_model_value(
        db,
        connection,
        field_name,
        key_version_field=f"{field_name}_key_version",
    )


def upsert_google_calendar_connection(
    db: Session,
    *,
    tenant_id: int,
    user: User,
    token_json: dict,
    account_email: str | None,
) -> UserCalendarConnection:
    connection = _google_connection_for_user(
        db,
        tenant_id=tenant_id,
        user_id=user.id,
        include_non_connected=True,
    )
    if not connection:
        connection = UserCalendarConnection(
            tenant_id=tenant_id,
            user_id=user.id,
            provider=CalendarProvider.google.value,
        )

    scopes_raw = token_json.get("scope")
    scopes = scopes_raw.split(" ") if isinstance(scopes_raw, str) and scopes_raw.strip() else [GOOGLE_CALENDAR_EVENTS_SCOPE]
    expires_in = token_json.get("expires_in")
    connection.status = "connected"
    connection.account_email = account_email
    connection.scopes = scopes
    if token_json.get("access_token"):
        _set_calendar_connection_token(connection, "access_token", token_json["access_token"])
    if token_json.get("refresh_token"):
        _set_calendar_connection_token(connection, "refresh_token", token_json["refresh_token"])
    connection.token_expires_at = (
        _utcnow() + timedelta(seconds=int(expires_in))
        if expires_in is not None
        else connection.token_expires_at
    )
    connection.last_error = None
    db.add(connection)
    db.commit()
    db.refresh(connection)
    return connection


def upsert_microsoft_calendar_connection(
    db: Session,
    *,
    tenant_id: int,
    user: User,
    token_json: dict,
    account_email: str | None,
) -> UserCalendarConnection:
    connection = _microsoft_connection_for_user(db, tenant_id=tenant_id, user_id=user.id, include_non_connected=True)
    if not connection:
        connection = UserCalendarConnection(tenant_id=tenant_id, user_id=user.id, provider=CalendarProvider.microsoft.value)
    scopes = token_json.get("scope", "").split()
    connection.status = "connected"
    connection.account_email = account_email
    connection.scopes = scopes
    if token_json.get("access_token"):
        _set_calendar_connection_token(connection, "access_token", token_json["access_token"])
    if token_json.get("refresh_token"):
        _set_calendar_connection_token(connection, "refresh_token", token_json["refresh_token"])
    connection.token_expires_at = _utcnow() + timedelta(seconds=int(token_json.get("expires_in") or 3600))
    connection.last_error = None
    db.add(connection)
    db.commit()
    db.refresh(connection)
    return connection


def _refresh_google_access_token(db: Session, connection: UserCalendarConnection) -> UserCalendarConnection:
    refresh_token = _calendar_connection_token(db, connection, "refresh_token")
    if not refresh_token:
        connection.status = "error"
        connection.last_error = "Missing Google refresh token for calendar sync."
        db.add(connection)
        db.commit()
        return connection

    response = requests.post(
        GOOGLE_TOKEN_URL,
        data={
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
        timeout=20,
    )
    body = response.json().copy() if response.content else {}
    if not response.ok or "access_token" not in body:
        connection.status = "error"
        connection.last_error = "Failed to refresh Google calendar token."
        db.add(connection)
        db.commit()
        return connection

    expires_in = body.get("expires_in")
    _set_calendar_connection_token(connection, "access_token", body.get("access_token"))
    connection.token_expires_at = _utcnow() + timedelta(seconds=int(expires_in or 3600))
    connection.status = "connected"
    connection.last_error = None
    db.add(connection)
    db.commit()
    db.refresh(connection)
    return connection


def _ensure_google_access_token(db: Session, connection: UserCalendarConnection) -> str | None:
    if connection.token_expires_at and connection.token_expires_at <= _utcnow() + timedelta(minutes=1):
        connection = _refresh_google_access_token(db, connection)
    return _calendar_connection_token(db, connection, "access_token")


def _ensure_microsoft_access_token(db: Session, connection: UserCalendarConnection) -> str | None:
    if connection.token_expires_at and connection.token_expires_at <= _utcnow() + timedelta(minutes=1):
        refresh_token = _calendar_connection_token(db, connection, "refresh_token")
        if not refresh_token:
            connection.status = "error"
            connection.last_error = "Missing Microsoft refresh token for calendar sync."
            db.add(connection)
            db.commit()
            return None
        response = requests.post(
            microsoft_token_url(),
            data={
                "client_id": settings.MICROSOFT_CLIENT_ID,
                "client_secret": settings.MICROSOFT_CLIENT_SECRET,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
                "scope": microsoft_scope_string(MICROSOFT_CALENDAR_SCOPE),
            },
            timeout=20,
        )
        body = response.json() if response.content else {}
        if not response.ok or not body.get("access_token"):
            connection.status = "error"
            connection.last_error = "Failed to refresh Microsoft calendar token."
            db.add(connection)
            db.commit()
            return None
        _set_calendar_connection_token(connection, "access_token", body["access_token"])
        if body.get("refresh_token"):
            _set_calendar_connection_token(connection, "refresh_token", body["refresh_token"])
        connection.token_expires_at = _utcnow() + timedelta(seconds=int(body.get("expires_in") or 3600))
        db.add(connection)
        db.commit()
    return _calendar_connection_token(db, connection, "access_token")


def _google_calendar_events_url(calendar_id: str) -> str:
    return f"{GOOGLE_CALENDAR_API_BASE}/calendars/{quote(calendar_id, safe='')}/events"


def _ensure_google_app_calendar(db: Session, connection: UserCalendarConnection) -> str | None:
    if connection.provider_calendar_id:
        return connection.provider_calendar_id

    granted_scopes = set(connection.scopes or [])
    calendar_management_scopes = {
        GOOGLE_CALENDAR_APP_CREATED_SCOPE,
        GOOGLE_CALENDAR_METADATA_SCOPE,
        "https://www.googleapis.com/auth/calendar",
    }
    if not granted_scopes.intersection(calendar_management_scopes):
        connection.status = "error"
        connection.last_error = (
            "Google Calendar sync needs calendar-management access. "
            "Sign out and sign in with Google again to grant the new calendar scope."
        )
        db.add(connection)
        db.commit()
        return None

    access_token = _ensure_google_access_token(db, connection)
    if not access_token:
        return None

    response = requests.post(
        f"{GOOGLE_CALENDAR_API_BASE}/calendars",
        json={"summary": GOOGLE_APP_CALENDAR_NAME},
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
        timeout=20,
    )
    body = response.json().copy() if response.content else {}
    if not response.ok or "id" not in body:
        connection.status = "error"
        google_error = None
        if isinstance(body, dict):
            error_payload = body.get("error")
            if isinstance(error_payload, dict):
                google_error = error_payload.get("message")
            elif isinstance(error_payload, str):
                google_error = error_payload
        connection.last_error = (
            f"Failed to create dedicated Google CRM calendar. {google_error}".strip()
            if google_error
            else "Failed to create dedicated Google CRM calendar."
        )
        db.add(connection)
        db.commit()
        return None

    provider_calendar_id = str(body.get("id") or "").strip()
    if not GOOGLE_CALENDAR_ID_PATTERN.fullmatch(provider_calendar_id):
        connection.status = "error"
        connection.last_error = "Google returned an invalid calendar identifier."
        db.add(connection)
        db.commit()
        return None

    connection.provider_calendar_id = provider_calendar_id
    connection.provider_calendar_name = body.get("summary") or GOOGLE_APP_CALENDAR_NAME
    connection.status = "connected"
    connection.last_error = None
    db.add(connection)
    db.commit()
    db.refresh(connection)
    return connection.provider_calendar_id


def _build_google_event_payload(event: CalendarEvent) -> dict:
    description_parts = [part for part in [event.description, event.meeting_url] if part]
    payload = {
        "summary": event.title,
        "description": "\n\n".join(description_parts) if description_parts else None,
        "location": event.location,
    }
    if event.is_all_day:
        payload["start"] = {"date": event.start_at.date().isoformat()}
        payload["end"] = {"date": event.end_at.date().isoformat()}
    else:
        payload["start"] = {"dateTime": event.start_at.isoformat()}
        payload["end"] = {"dateTime": event.end_at.isoformat()}
    return payload


def _sync_google_participant_event(
    db: Session,
    *,
    event: CalendarEvent,
    participant: CalendarEventParticipant,
) -> None:
    if not participant.user_id:
        return
    user = participant.user
    if not user or user.last_login_provider != CalendarProvider.google.value:
        return

    connection = _google_connection_for_user(db, tenant_id=event.tenant_id, user_id=participant.user_id)
    if not connection:
        return

    calendar_id = _ensure_google_app_calendar(db, connection)
    access_token = _ensure_google_access_token(db, connection)
    if not access_token or not calendar_id:
        participant.last_sync_error = connection.last_error
        db.add(participant)
        db.commit()
        return

    payload = _build_google_event_payload(event)
    headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}

    if participant.external_provider == CalendarProvider.google.value and participant.external_event_id:
        response = requests.patch(
            f"{_google_calendar_events_url(calendar_id)}/{participant.external_event_id}",
            json=payload,
            headers=headers,
            timeout=20,
        )
    else:
        response = requests.post(
            _google_calendar_events_url(calendar_id),
            json=payload,
            headers=headers,
            timeout=20,
        )

    if response.ok:
        body = response.json()
        participant.external_provider = CalendarProvider.google.value
        participant.external_event_id = body.get("id") or participant.external_event_id
        participant.external_synced_at = _utcnow()
        participant.last_sync_error = None
        connection.last_synced_at = participant.external_synced_at
        connection.last_error = None
        db.add(participant)
        db.add(connection)
        db.commit()
        return

    participant.last_sync_error = "Failed to sync event to Google Calendar."
    connection.last_error = participant.last_sync_error
    db.add(participant)
    db.add(connection)
    db.commit()


def _delete_google_participant_event(db: Session, participant: CalendarEventParticipant) -> None:
    if participant.external_provider != CalendarProvider.google.value or not participant.external_event_id or not participant.user_id:
        return

    connection = _google_connection_for_user(db, tenant_id=participant.tenant_id, user_id=participant.user_id)
    if not connection:
        return

    calendar_id = connection.provider_calendar_id or _ensure_google_app_calendar(db, connection)
    access_token = _ensure_google_access_token(db, connection)
    if not access_token or not calendar_id:
        return

    requests.delete(
        f"{_google_calendar_events_url(calendar_id)}/{participant.external_event_id}",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=20,
    )


def _ensure_microsoft_default_calendar(db: Session, connection: UserCalendarConnection) -> str | None:
    if connection.provider_calendar_id:
        return connection.provider_calendar_id
    access_token = _ensure_microsoft_access_token(db, connection)
    if not access_token:
        return None
    response = requests.get(f"{MICROSOFT_GRAPH_BASE}/me/calendar", headers={"Authorization": f"Bearer {access_token}"}, timeout=20)
    body = response.json() if response.content else {}
    if not response.ok or not body.get("id"):
        connection.status = "error"
        connection.last_error = "Failed to load the default Microsoft calendar."
        db.add(connection)
        db.commit()
        return None
    connection.provider_calendar_id = body["id"]
    connection.provider_calendar_name = body.get("name") or "Microsoft Calendar"
    db.add(connection)
    db.commit()
    return connection.provider_calendar_id


def _microsoft_event_payload(event: CalendarEvent) -> dict:
    def date_time(value: datetime) -> dict:
        utc_value = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
        return {"dateTime": utc_value.replace(tzinfo=None).isoformat(), "timeZone": "UTC"}

    description_parts = [part for part in [event.description, event.meeting_url] if part]
    return {
        "subject": event.title,
        "body": {"contentType": "text", "content": "\n\n".join(description_parts)},
        "location": {"displayName": event.location or ""},
        "start": date_time(event.start_at),
        "end": date_time(event.end_at),
        "isAllDay": bool(event.is_all_day),
    }


def _sync_microsoft_participant_event(db: Session, *, event: CalendarEvent, participant: CalendarEventParticipant) -> None:
    participant_user = getattr(participant, "user", None)
    if not participant.user_id or not participant_user or participant_user.last_login_provider != CalendarProvider.microsoft.value:
        return
    connection = _microsoft_connection_for_user(db, tenant_id=event.tenant_id, user_id=participant.user_id)
    if not connection:
        return
    calendar_id = _ensure_microsoft_default_calendar(db, connection)
    access_token = _ensure_microsoft_access_token(db, connection)
    if not calendar_id or not access_token:
        participant.last_sync_error = connection.last_error
        db.add(participant)
        db.commit()
        return
    events_url = f"{MICROSOFT_GRAPH_BASE}/me/calendars/{quote(calendar_id, safe='')}/events"
    headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
    response = (
        requests.patch(f"{events_url}/{quote(participant.external_event_id, safe='')}", json=_microsoft_event_payload(event), headers=headers, timeout=20)
        if participant.external_provider == CalendarProvider.microsoft.value and participant.external_event_id
        else requests.post(events_url, json=_microsoft_event_payload(event), headers=headers, timeout=20)
    )
    if response.ok:
        body = response.json() if response.content else {}
        participant.external_provider = CalendarProvider.microsoft.value
        participant.external_event_id = body.get("id") or participant.external_event_id
        participant.external_synced_at = _utcnow()
        participant.last_sync_error = None
        connection.last_synced_at = participant.external_synced_at
        connection.last_error = None
    else:
        participant.last_sync_error = "Failed to sync event to Microsoft Calendar."
        connection.last_error = participant.last_sync_error
    db.add(participant)
    db.add(connection)
    db.commit()


def _delete_microsoft_participant_event(db: Session, participant: CalendarEventParticipant) -> None:
    if participant.external_provider != CalendarProvider.microsoft.value or not participant.external_event_id or not participant.user_id:
        return
    connection = _microsoft_connection_for_user(db, tenant_id=participant.tenant_id, user_id=participant.user_id)
    if not connection:
        return
    calendar_id = connection.provider_calendar_id or _ensure_microsoft_default_calendar(db, connection)
    access_token = _ensure_microsoft_access_token(db, connection)
    if calendar_id and access_token:
        requests.delete(
            f"{MICROSOFT_GRAPH_BASE}/me/calendars/{quote(calendar_id, safe='')}/events/{quote(participant.external_event_id, safe='')}",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=20,
        )


def _sync_participant_event(db: Session, *, event: CalendarEvent, participant: CalendarEventParticipant) -> None:
    participant_user = getattr(participant, "user", None)
    provider = getattr(participant_user, "last_login_provider", None)
    if participant.external_provider and participant.external_provider != provider:
        _delete_participant_event(db, participant)
        participant.external_provider = None
        participant.external_event_id = None
    if provider == CalendarProvider.google.value:
        _sync_google_participant_event(db, event=event, participant=participant)
    elif provider == CalendarProvider.microsoft.value:
        _sync_microsoft_participant_event(db, event=event, participant=participant)


def _delete_participant_event(db: Session, participant: CalendarEventParticipant) -> None:
    _delete_google_participant_event(db, participant)
    _delete_microsoft_participant_event(db, participant)


def _sync_external_events_for_event(db: Session, event: CalendarEvent) -> None:
    for participant in event.participants:
        if participant.participant_type != "user":
            continue
        if participant.response_status != "accepted":
            continue
        _sync_participant_event(db, event=event, participant=participant)


def sync_external_events_for_event_id(db: Session, *, event_id: int) -> int:
    event = calendar_repository.get_event_for_external_sync(db, event_id=event_id)
    if not event:
        return 0
    _sync_external_events_for_event(db, event)
    return len([participant for participant in event.participants if participant.participant_type == "user" and participant.response_status == "accepted"])


def _enqueue_external_events_for_event(db: Session, event: CalendarEvent) -> None:
    try:
        from app.tasks.calendar_tasks import sync_calendar_event_to_external_providers_task

        sync_calendar_event_to_external_providers_task.delay(event.id)
    except Exception:
        logger.warning(
            "Calendar external sync enqueue failed",
            extra={"tenant_id": event.tenant_id, "event_id": event.id},
            exc_info=True,
        )


def _notify_new_participants(db: Session, *, event: CalendarEvent, actor_name: str | None, participants: list[CalendarEventParticipant]) -> None:
    if not participants:
        return

    try:
        team_ids = [participant.team_id for participant in participants if participant.participant_type == "team" and participant.team_id]
        invitee_user_ids = {participant.user_id for participant in participants if participant.participant_type == "user" and participant.user_id and not participant.is_owner}
        if team_ids:
            members = calendar_repository.team_member_ids(db, tenant_id=event.tenant_id, team_ids=team_ids)
            invitee_user_ids.update(user_id for (user_id,) in members)

        start_label = event.start_at.strftime("%b %d, %Y %H:%M")
        notifications = []
        for user_id in sorted(user_id for user_id in invitee_user_ids if user_id):
            notifications.append(
                UserNotification(
                    tenant_id=event.tenant_id,
                    user_id=user_id,
                    category="calendar_invite",
                    title=f"Calendar event: {event.title}",
                    message=f"{actor_name or 'A teammate'} added you or your team to an event starting {start_label}.",
                    link_url=f"/dashboard/calendar?eventId={event.id}",
                    payload={
                        "calendar_event_id": event.id,
                        "start_at": event.start_at.isoformat(),
                        "source_module_key": event.source_module_key,
                        "source_entity_id": event.source_entity_id,
                    },
                    status="unread",
                )
            )
        if notifications:
            db.add_all(notifications)
            db.commit()
    except Exception:
        db.rollback()
        logger.exception(
            "Calendar participant notification creation failed",
            extra={
                "tenant_id": event.tenant_id,
                "event_id": event.id,
                "participant_count": len(participants),
            },
        )


def create_calendar_event(db: Session, *, payload: dict, current_user) -> tuple[CalendarEvent, list[CalendarEventParticipant]]:
    data = dict(payload)
    participants_payload = data.pop("participants", None)
    event = CalendarEvent(
        tenant_id=current_user.tenant_id,
        owner_user_id=current_user.id,
        title=data["title"].strip(),
        description=(data.get("description") or "").strip() or None,
        start_at=data["start_at"],
        end_at=data["end_at"],
        is_all_day=bool(data.get("is_all_day")),
        location=(data.get("location") or "").strip() or None,
        meeting_url=(data.get("meeting_url") or "").strip() or None,
        source_module_key=(data.get("source_module_key") or "").strip() or None,
        source_entity_id=str(data["source_entity_id"]).strip() if data.get("source_entity_id") is not None else None,
        source_label=(data.get("source_label") or "").strip() or None,
    )
    db.add(event)
    db.flush()
    added, _, _ = _apply_event_participants(
        db,
        event=event,
        tenant_id=current_user.tenant_id,
        owner_user_id=current_user.id,
        participants_payload=participants_payload,
    )
    db.commit()
    db.refresh(event)
    _notify_new_participants(db, event=event, actor_name=_display_user_name(current_user), participants=added)
    _enqueue_external_events_for_event(db, event)
    return get_calendar_event_or_404(db, event.id, tenant_id=current_user.tenant_id, current_user=current_user), added


def update_calendar_event(db: Session, *, event: CalendarEvent, payload: dict, current_user) -> tuple[CalendarEvent, list[CalendarEventParticipant]]:
    data = dict(payload)
    participants_payload = data.pop("participants", None)

    for field in ("title", "description", "start_at", "end_at", "is_all_day", "location", "meeting_url"):
        if field not in data:
            continue
        value = data[field]
        if field in {"title", "description", "location", "meeting_url"} and isinstance(value, str):
            value = value.strip() or None
        setattr(event, field, value)

    if event.end_at <= event.start_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="end_at must be after start_at")

    added: list[CalendarEventParticipant] = []
    removed: list[CalendarEventParticipant] = []
    if participants_payload is not None:
        added, removed, _ = _apply_event_participants(
            db,
            event=event,
            tenant_id=current_user.tenant_id,
            owner_user_id=event.owner_user_id,
            participants_payload=participants_payload,
        )

    db.add(event)
    db.commit()
    db.refresh(event)

    for participant in removed:
        _delete_participant_event(db, participant)
    _notify_new_participants(db, event=event, actor_name=_display_user_name(current_user), participants=added)
    _enqueue_external_events_for_event(db, event)
    return event, added


def respond_to_calendar_invite(
    db: Session,
    *,
    event: CalendarEvent,
    current_user,
    response_status: str,
) -> CalendarEvent:
    owner_participant = next((item for item in event.participants if item.user_id == current_user.id and item.is_owner), None)
    if event.owner_user_id == current_user.id or owner_participant:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Event owners do not need to respond to their own invite.")

    participant = next(
        (
            item
            for item in event.participants
            if item.participant_type == "user" and item.user_id == current_user.id and not item.is_owner
        ),
        None,
    )
    if not participant:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invite response is not available for this event.")

    participant.response_status = response_status
    participant.responded_at = _utcnow()
    db.add(participant)
    db.commit()
    db.refresh(event)

    if response_status == "accepted":
        _sync_participant_event(db, event=event, participant=participant)
    elif response_status == "declined":
        _delete_participant_event(db, participant)

    return event


def delete_calendar_event(db: Session, *, event: CalendarEvent) -> CalendarEvent:
    event.deleted_at = _utcnow()
    db.add(event)
    db.commit()
    db.refresh(event)
    for participant in event.participants:
        _delete_participant_event(db, participant)
    return event


def list_deleted_calendar_events(db: Session, *, tenant_id: int, pagination) -> tuple[list[CalendarEvent], int]:
    return calendar_repository.list_deleted_calendar_events(db, tenant_id=tenant_id, pagination=pagination)


def restore_calendar_event(db: Session, *, event: CalendarEvent) -> CalendarEvent:
    event.deleted_at = None
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def build_calendar_context(db: Session, *, tenant_id: int, current_user) -> dict:
    users = calendar_repository.list_context_users(db, tenant_id=tenant_id)
    teams = calendar_repository.list_context_teams(db, tenant_id=tenant_id)
    connections = calendar_repository.list_user_calendar_connections(db, tenant_id=tenant_id, user_id=current_user.id)
    recent_sync_jobs = calendar_repository.list_recent_calendar_sync_jobs(db, tenant_id=tenant_id, actor_user_id=current_user.id)
    pending_invite_count = calendar_repository.pending_invite_count(db, tenant_id=tenant_id, user_id=current_user.id)
    return {
        "users": [
            {
                "id": user.id,
                "name": _display_user_name(user) or f"User {user.id}",
                "email": user.email,
                "team_id": user.team_id,
                "team_name": getattr(getattr(user, "team", None), "name", None),
            }
            for user in users
        ],
        "teams": [
            {
                "id": team.id,
                "name": team.name,
                "department_id": team.department_id,
            }
            for team in teams
        ],
        "connections": [_serialize_connection(connection, current_user=current_user) for connection in connections],
        "recent_sync_jobs": recent_sync_jobs,
        "pending_invite_count": pending_invite_count,
    }


def get_calendar_event_from_task(
    db: Session,
    *,
    task_id: int,
    current_user,
    include_deleted: bool = False,
) -> CalendarEvent | None:
    linked_events = _list_duplicate_task_events(
        db,
        task_id=task_id,
        current_user=current_user,
        include_deleted=include_deleted,
    )
    return linked_events[0] if linked_events else None


def _list_duplicate_task_events(
    db: Session,
    *,
    task_id: int,
    current_user,
    include_deleted: bool = False,
) -> list[CalendarEvent]:
    return calendar_repository.list_duplicate_task_events(
        db,
        task_id=task_id,
        current_user=current_user,
        include_deleted=include_deleted,
    )


def _dedupe_calendar_events_from_task(db: Session, *, task_id: int, current_user) -> CalendarEvent | None:
    linked_events = _list_duplicate_task_events(db, task_id=task_id, current_user=current_user)
    if not linked_events:
        return None
    canonical = linked_events[0]
    for duplicate in linked_events[1:]:
        delete_calendar_event(db, event=duplicate)
    if len(linked_events) > 1:
        db.refresh(canonical)
    return canonical


def delete_calendar_event_from_task(db: Session, *, task_id: int, current_user) -> dict | None:
    linked_events = _list_duplicate_task_events(db, task_id=task_id, current_user=current_user)
    if not linked_events:
        return None
    deleted_snapshot = serialize_calendar_event(linked_events[0], current_user=current_user)
    for event in linked_events:
        delete_calendar_event(db, event=event)
    return deleted_snapshot


def enqueue_current_user_calendar_sync(db: Session, *, current_user):
    provider = current_user.last_login_provider
    connection = _calendar_connection_for_user(db, tenant_id=current_user.tenant_id, user_id=current_user.id, provider=provider)
    if not connection:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Calendar sync is only available for users currently signed in with a connected calendar provider.",
        )
    if connection.status != "connected":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Connect Google Calendar before syncing.")

    from app.modules.platform.services.data_transfer_jobs import create_data_transfer_job, mark_job_failed

    job = create_data_transfer_job(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        module_key="calendar",
        operation_type="sync",
        payload={"provider": provider},
    )
    try:
        from app.tasks.calendar_tasks import process_calendar_full_sync_job_task

        process_calendar_full_sync_job_task.delay(job.id)
    except Exception as exc:
        logger.warning(
            "Calendar full sync enqueue failed",
            extra={"tenant_id": current_user.tenant_id, "user_id": current_user.id, "job_id": job.id},
            exc_info=True,
        )
        mark_job_failed(db, job, error_message="Calendar sync could not be queued.")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Calendar sync could not be queued.") from exc
    return job


def sync_current_user_calendar(
    db: Session,
    *,
    current_user,
    progress_callback: Callable[[int, int, str], None] | None = None,
) -> dict:
    provider = current_user.last_login_provider
    connection = _calendar_connection_for_user(db, tenant_id=current_user.tenant_id, user_id=current_user.id, provider=provider)
    if not connection:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Calendar sync is only available for users currently signed in with a connected calendar provider.",
        )
    if connection.status != "connected":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Connect Google Calendar before syncing.")

    calendar_id = _ensure_google_app_calendar(db, connection) if provider == CalendarProvider.google.value else _ensure_microsoft_default_calendar(db, connection)
    if not calendar_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=connection.last_error or "Calendar sync failed.")

    base_query = calendar_repository.build_user_sync_query(db, current_user=current_user)

    total_count = base_query.order_by(None).count()
    synced_count = 0
    processed_count = 0
    last_event_id = 0
    while True:
        events = (
            base_query
            .filter(CalendarEvent.id > last_event_id)
            .order_by(CalendarEvent.id.asc())
            .limit(CALENDAR_SYNC_BATCH_SIZE)
            .all()
        )
        if not events:
            break
        for event in events:
            last_event_id = max(last_event_id, event.id)
            processed_count += 1
            participant = next((item for item in event.participants if item.user_id == current_user.id), None)
            if not participant:
                continue
            if participant.response_status not in {"accepted", "shared"}:
                continue
            _sync_participant_event(db, event=event, participant=participant)
            participant = next((item for item in event.participants if item.user_id == current_user.id), participant)
            if not participant.last_sync_error:
                synced_count += 1
        if progress_callback:
            progress_callback(processed_count, total_count, f"Synced {processed_count} of {total_count} calendar events.")

    db.refresh(connection)
    return {
        "provider": provider,
        "synced_event_count": synced_count,
        "provider_calendar_id": connection.provider_calendar_id,
        "provider_calendar_name": connection.provider_calendar_name,
        "last_synced_at": connection.last_synced_at,
        "status": connection.status,
        "last_error": connection.last_error,
    }


def process_calendar_sync_job(*, job_id: int) -> None:
    from app.modules.platform.services.data_transfer_jobs import (
        get_data_transfer_job_or_404,
        mark_job_completed,
        mark_job_running,
        update_job_progress,
    )

    db = SessionLocal()
    try:
        job = get_data_transfer_job_or_404(db, job_id=job_id, actor_user_id=None, is_admin=True)
        mark_job_running(db, job)
        update_job_progress(db, job, progress_percent=10, progress_message="Preparing calendar sync.")

        if job.module_key != "calendar" or job.operation_type != "sync":
            raise ValueError("Unsupported calendar sync job.")
        current_user = calendar_repository.get_sync_job_actor(db, user_id=job.actor_user_id, tenant_id=job.tenant_id)
        if current_user is None:
            raise ValueError("Calendar sync job actor was not found.")

        def progress_callback(processed_count: int, total_count: int, message: str) -> None:
            if total_count <= 0:
                update_job_progress(db, job, progress_percent=90, progress_message="No calendar events to sync.")
                return
            progress = 10 + int((min(processed_count, total_count) / total_count) * 80)
            update_job_progress(db, job, progress_percent=progress, progress_message=message)

        summary = sync_current_user_calendar(db, current_user=current_user, progress_callback=progress_callback)
        update_job_progress(db, job, progress_percent=95, progress_message="Finalizing calendar sync.")
        mark_job_completed(db, job, summary=summary)
    finally:
        db.close()


def create_calendar_event_from_task(db: Session, *, task_id: int, current_user) -> tuple[CalendarEvent, bool]:
    task = get_task_or_404(db, task_id, tenant_id=current_user.tenant_id, current_user=current_user)
    existing_event = _dedupe_calendar_events_from_task(db, task_id=task_id, current_user=current_user)
    if existing_event:
        return existing_event, True

    start_at = task.start_at or task.due_at or _utcnow()
    end_at = task.due_at or (start_at + timedelta(minutes=30))
    if end_at <= start_at:
        end_at = start_at + timedelta(minutes=30)

    participants_payload: list[dict] = []
    for assignee in task.assignees:
        if assignee.assignee_type == "user" and assignee.user_id:
            participants_payload.append({"participant_type": "user", "user_id": assignee.user_id})
        elif assignee.assignee_type == "team" and assignee.team_id:
            participants_payload.append({"participant_type": "team", "team_id": assignee.team_id})

    event, _ = create_calendar_event(
        db,
        payload={
            "title": task.title,
            "description": task.description,
            "start_at": start_at,
            "end_at": end_at,
            "is_all_day": False,
            "location": None,
            "meeting_url": None,
            "participants": participants_payload,
            "source_module_key": "tasks",
            "source_entity_id": str(task.id),
            "source_label": task.title,
        },
        current_user=current_user,
    )
    return event, False
