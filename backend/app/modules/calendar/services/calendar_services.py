from __future__ import annotations

from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import requests
from fastapi import HTTPException, status
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session, selectinload

from app.modules.calendar.models import CalendarEvent, CalendarEventParticipant, UserCalendarConnection
from app.modules.calendar.schema import CalendarProvider
from app.modules.platform.services.notifications import create_notification
from app.modules.tasks.services.tasks_services import get_task_or_404
from app.modules.user_management.models import Team, User
from app.core.config import settings


GOOGLE_CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events"
GOOGLE_CALENDAR_METADATA_SCOPE = "https://www.googleapis.com/auth/calendar.calendars"
GOOGLE_CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3"
GOOGLE_CALENDAR_EVENTS_URL = f"{GOOGLE_CALENDAR_API_BASE}/calendars/primary/events"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_APP_CALENDAR_NAME = "CRM"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _display_user_name(user: User | None) -> str | None:
    if not user:
        return None
    full_name = " ".join(part for part in [user.first_name, user.last_name] if part).strip()
    return full_name or user.email or None


def _participant_key(participant_type: str, target_id: int) -> str:
    return f"{participant_type}:{target_id}"


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

    for item in participants_payload or []:
        participant_type = item.get("participant_type")
        if participant_type == "user":
            user_id = item.get("user_id")
            if not user_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User participant requires user_id")
            user = db.query(User).filter(User.id == user_id, User.tenant_id == tenant_id).first()
            if not user:
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
            team = db.query(Team).filter(Team.id == team_id, Team.tenant_id == tenant_id).first()
            if not team:
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
    db.refresh(event)
    return added, removed, changed


def _serialize_connection(connection: UserCalendarConnection, *, current_user) -> dict:
    return {
        "provider": connection.provider,
        "status": connection.status,
        "account_email": connection.account_email,
        "provider_calendar_id": connection.provider_calendar_id,
        "provider_calendar_name": connection.provider_calendar_name,
        "sync_enabled_for_current_session": bool(
            current_user.last_login_provider == connection.provider and connection.status == "connected"
        ),
        "last_synced_at": connection.last_synced_at,
        "last_error": connection.last_error,
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
    query = (
        db.query(CalendarEvent)
        .options(
            selectinload(CalendarEvent.participants).selectinload(CalendarEventParticipant.user),
            selectinload(CalendarEvent.participants).selectinload(CalendarEventParticipant.team),
        )
        .filter(
            CalendarEvent.tenant_id == tenant_id,
            CalendarEvent.deleted_at.is_(None),
            CalendarEvent.start_at < end_at,
            CalendarEvent.end_at > start_at,
        )
    )

    visibility_filters = [
        CalendarEvent.owner_user_id == current_user.id,
        CalendarEvent.participants.any(
            and_(
                CalendarEventParticipant.user_id == current_user.id,
                CalendarEventParticipant.response_status != "declined",
            )
        ),
    ]
    if getattr(current_user, "team_id", None):
        visibility_filters.append(
            CalendarEvent.participants.any(
                and_(
                    CalendarEventParticipant.team_id == current_user.team_id,
                    CalendarEventParticipant.response_status == "shared",
                )
            )
        )

    return (
        query.filter(or_(*visibility_filters))
        .order_by(CalendarEvent.start_at.asc(), CalendarEvent.id.asc())
        .all()
    )


def list_pending_invites(db: Session, *, tenant_id: int, current_user) -> list[CalendarEvent]:
    return (
        db.query(CalendarEvent)
        .options(
            selectinload(CalendarEvent.participants).selectinload(CalendarEventParticipant.user),
            selectinload(CalendarEvent.participants).selectinload(CalendarEventParticipant.team),
        )
        .join(CalendarEventParticipant, CalendarEventParticipant.event_id == CalendarEvent.id)
        .filter(
            CalendarEvent.tenant_id == tenant_id,
            CalendarEvent.deleted_at.is_(None),
            CalendarEventParticipant.user_id == current_user.id,
            CalendarEventParticipant.response_status == "pending",
        )
        .order_by(CalendarEvent.start_at.asc(), CalendarEvent.id.asc())
        .all()
    )


def get_calendar_event_or_404(
    db: Session,
    event_id: int,
    *,
    tenant_id: int,
    current_user,
    include_deleted: bool = False,
    bypass_visibility: bool = False,
) -> CalendarEvent:
    query = (
        db.query(CalendarEvent)
        .options(
            selectinload(CalendarEvent.participants).selectinload(CalendarEventParticipant.user),
            selectinload(CalendarEvent.participants).selectinload(CalendarEventParticipant.team),
        )
        .filter(
            CalendarEvent.id == event_id,
            CalendarEvent.tenant_id == tenant_id,
        )
    )
    if include_deleted:
        query = query.filter(CalendarEvent.deleted_at.is_not(None))
    else:
        query = query.filter(CalendarEvent.deleted_at.is_(None))

    event = None
    if bypass_visibility:
        event = query.first()
    else:
        visibility_filters = [
            CalendarEvent.owner_user_id == current_user.id,
            CalendarEvent.participants.any(CalendarEventParticipant.user_id == current_user.id),
        ]
        if getattr(current_user, "team_id", None):
            visibility_filters.append(CalendarEvent.participants.any(CalendarEventParticipant.team_id == current_user.team_id))
        event = query.filter(or_(*visibility_filters)).first()
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
    query = (
        db.query(UserCalendarConnection)
        .filter(
            UserCalendarConnection.tenant_id == tenant_id,
            UserCalendarConnection.user_id == user_id,
            UserCalendarConnection.provider == CalendarProvider.google.value,
        )
    )
    if not include_non_connected:
        query = query.filter(UserCalendarConnection.status == "connected")
    return (
        query.order_by(UserCalendarConnection.id.asc())
        .first()
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
    connection.access_token = token_json.get("access_token") or connection.access_token
    connection.refresh_token = token_json.get("refresh_token") or connection.refresh_token
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


def _refresh_google_access_token(db: Session, connection: UserCalendarConnection) -> UserCalendarConnection:
    if not connection.refresh_token:
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
            "refresh_token": connection.refresh_token,
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
    connection.access_token = body.get("access_token")
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
    return connection.access_token


def _google_calendar_events_url(calendar_id: str) -> str:
    return f"{GOOGLE_CALENDAR_API_BASE}/calendars/{quote(calendar_id, safe='')}/events"


def _ensure_google_app_calendar(db: Session, connection: UserCalendarConnection) -> str | None:
    granted_scopes = set(connection.scopes or [])
    calendar_management_scopes = {
        GOOGLE_CALENDAR_METADATA_SCOPE,
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/calendar.app.created",
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

    if connection.provider_calendar_id:
        return connection.provider_calendar_id

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

    connection.provider_calendar_id = body.get("id")
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

    if participant.external_event_id:
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


def _sync_external_events_for_event(db: Session, event: CalendarEvent) -> None:
    for participant in event.participants:
        if participant.participant_type != "user":
            continue
        if participant.response_status != "accepted":
            continue
        _sync_google_participant_event(db, event=event, participant=participant)


def _notify_new_participants(db: Session, *, event: CalendarEvent, actor_name: str | None, participants: list[CalendarEventParticipant]) -> None:
    if not participants:
        return

    team_ids = [participant.team_id for participant in participants if participant.participant_type == "team" and participant.team_id]
    invitee_user_ids = {participant.user_id for participant in participants if participant.participant_type == "user" and participant.user_id and not participant.is_owner}
    if team_ids:
        members = (
            db.query(User.id)
            .filter(User.tenant_id == event.tenant_id, User.team_id.in_(team_ids))
            .all()
        )
        invitee_user_ids.update(user_id for (user_id,) in members)

    start_label = event.start_at.strftime("%b %d, %Y %H:%M")
    for user_id in sorted(user_id for user_id in invitee_user_ids if user_id):
        create_notification(
            db,
            tenant_id=event.tenant_id,
            user_id=user_id,
            category="calendar_invite",
            title=f"Calendar event: {event.title}",
            message=f"{actor_name or 'A teammate'} added you or your team to an event starting {start_label}.",
            link_url=f"/dashboard/calendar?eventId={event.id}",
            metadata={
                "calendar_event_id": event.id,
                "start_at": event.start_at.isoformat(),
                "source_module_key": event.source_module_key,
                "source_entity_id": event.source_entity_id,
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
    _sync_external_events_for_event(db, event)
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
        _delete_google_participant_event(db, participant)
    _notify_new_participants(db, event=event, actor_name=_display_user_name(current_user), participants=added)
    _sync_external_events_for_event(db, event)
    return get_calendar_event_or_404(db, event.id, tenant_id=current_user.tenant_id, current_user=current_user), added


def respond_to_calendar_invite(
    db: Session,
    *,
    event: CalendarEvent,
    current_user,
    response_status: str,
) -> CalendarEvent:
    participant = next((item for item in event.participants if item.user_id == current_user.id and not item.is_owner), None)
    if not participant:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invite response is not available for this event.")

    participant.response_status = response_status
    participant.responded_at = _utcnow()
    db.add(participant)
    db.commit()
    db.refresh(event)

    if response_status == "accepted":
        _sync_google_participant_event(db, event=event, participant=participant)
    elif response_status == "declined":
        _delete_google_participant_event(db, participant)

    return get_calendar_event_or_404(db, event.id, tenant_id=current_user.tenant_id, current_user=current_user)


def delete_calendar_event(db: Session, *, event: CalendarEvent) -> CalendarEvent:
    event.deleted_at = _utcnow()
    db.add(event)
    db.commit()
    db.refresh(event)
    for participant in event.participants:
        _delete_google_participant_event(db, participant)
    return event


def list_deleted_calendar_events(db: Session, *, tenant_id: int, pagination) -> tuple[list[CalendarEvent], int]:
    query = (
        db.query(CalendarEvent)
        .options(
            selectinload(CalendarEvent.participants).selectinload(CalendarEventParticipant.user),
            selectinload(CalendarEvent.participants).selectinload(CalendarEventParticipant.team),
        )
        .filter(
            CalendarEvent.tenant_id == tenant_id,
            CalendarEvent.deleted_at.is_not(None),
        )
    )
    total_count = query.count()
    items = (
        query.order_by(CalendarEvent.deleted_at.desc(), CalendarEvent.start_at.asc())
        .offset(pagination.offset)
        .limit(pagination.limit)
        .all()
    )
    return items, total_count


def restore_calendar_event(db: Session, *, event: CalendarEvent) -> CalendarEvent:
    event.deleted_at = None
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def build_calendar_context(db: Session, *, tenant_id: int, current_user) -> dict:
    users = (
        db.query(User)
        .options(selectinload(User.team))
        .filter(User.tenant_id == tenant_id)
        .order_by(User.first_name.asc(), User.last_name.asc(), User.email.asc())
        .all()
    )
    teams = db.query(Team).filter(Team.tenant_id == tenant_id).order_by(Team.name.asc()).all()
    connections = (
        db.query(UserCalendarConnection)
        .filter(UserCalendarConnection.tenant_id == tenant_id, UserCalendarConnection.user_id == current_user.id)
        .order_by(UserCalendarConnection.provider.asc())
        .all()
    )
    pending_invite_count = (
        db.query(CalendarEventParticipant)
        .join(CalendarEvent, CalendarEvent.id == CalendarEventParticipant.event_id)
        .filter(
            CalendarEventParticipant.tenant_id == tenant_id,
            CalendarEventParticipant.user_id == current_user.id,
            CalendarEventParticipant.response_status == "pending",
            CalendarEvent.deleted_at.is_(None),
        )
        .count()
    )
    return {
        "users": [
            {
                "id": user.id,
                "name": _display_user_name(user) or f"User {user.id}",
                "email": user.email,
                "team_id": user.team_id,
                "team_name": user.team_name,
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
        "pending_invite_count": pending_invite_count,
    }


def get_calendar_event_from_task(
    db: Session,
    *,
    task_id: int,
    current_user,
    include_deleted: bool = False,
) -> CalendarEvent | None:
    query = (
        db.query(CalendarEvent)
        .options(
            selectinload(CalendarEvent.participants).selectinload(CalendarEventParticipant.user),
            selectinload(CalendarEvent.participants).selectinload(CalendarEventParticipant.team),
        )
        .filter(
            CalendarEvent.tenant_id == current_user.tenant_id,
            CalendarEvent.owner_user_id == current_user.id,
            CalendarEvent.source_module_key == "tasks",
            CalendarEvent.source_entity_id == str(task_id),
        )
    )
    if include_deleted:
        query = query.filter(CalendarEvent.deleted_at.is_not(None))
    else:
        query = query.filter(CalendarEvent.deleted_at.is_(None))
    return query.order_by(CalendarEvent.id.asc()).first()


def _list_duplicate_task_events(db: Session, *, task_id: int, current_user) -> list[CalendarEvent]:
    return (
        db.query(CalendarEvent)
        .options(
            selectinload(CalendarEvent.participants).selectinload(CalendarEventParticipant.user),
            selectinload(CalendarEvent.participants).selectinload(CalendarEventParticipant.team),
        )
        .filter(
            CalendarEvent.tenant_id == current_user.tenant_id,
            CalendarEvent.owner_user_id == current_user.id,
            CalendarEvent.source_module_key == "tasks",
            CalendarEvent.source_entity_id == str(task_id),
            CalendarEvent.deleted_at.is_(None),
        )
        .order_by(CalendarEvent.id.asc())
        .all()
    )


def delete_calendar_event_from_task(db: Session, *, task_id: int, current_user) -> CalendarEvent | None:
    linked_events = _list_duplicate_task_events(db, task_id=task_id, current_user=current_user)
    if not linked_events:
        return None
    deleted_event = linked_events[0]
    for event in linked_events:
        delete_calendar_event(db, event=event)
    return deleted_event


def sync_current_user_calendar(db: Session, *, current_user) -> dict:
    connection = _google_connection_for_user(db, tenant_id=current_user.tenant_id, user_id=current_user.id)
    if not connection or current_user.last_login_provider != CalendarProvider.google.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google Calendar sync is only available for users currently signed in with Google.",
        )

    calendar_id = _ensure_google_app_calendar(db, connection)
    if not calendar_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=connection.last_error or "Calendar sync failed.")

    events = (
        db.query(CalendarEvent)
        .options(
            selectinload(CalendarEvent.participants).selectinload(CalendarEventParticipant.user),
            selectinload(CalendarEvent.participants).selectinload(CalendarEventParticipant.team),
        )
        .filter(
            CalendarEvent.tenant_id == current_user.tenant_id,
            CalendarEvent.deleted_at.is_(None),
            or_(
                CalendarEvent.owner_user_id == current_user.id,
                CalendarEvent.participants.any(
                    and_(
                        CalendarEventParticipant.user_id == current_user.id,
                        CalendarEventParticipant.response_status != "declined",
                    )
                ),
            ),
        )
        .order_by(CalendarEvent.start_at.asc(), CalendarEvent.id.asc())
        .all()
    )

    synced_count = 0
    for event in events:
        participant = next((item for item in event.participants if item.user_id == current_user.id), None)
        if not participant:
            continue
        if participant.response_status not in {"accepted", "shared"}:
            continue
        _sync_google_participant_event(db, event=event, participant=participant)
        participant = next((item for item in event.participants if item.user_id == current_user.id), participant)
        if not participant.last_sync_error:
            synced_count += 1

    db.refresh(connection)
    return {
        "provider": CalendarProvider.google.value,
        "synced_event_count": synced_count,
        "provider_calendar_id": connection.provider_calendar_id,
        "provider_calendar_name": connection.provider_calendar_name,
        "last_synced_at": connection.last_synced_at,
        "status": connection.status,
        "last_error": connection.last_error,
    }


def create_calendar_event_from_task(db: Session, *, task_id: int, current_user) -> tuple[CalendarEvent, bool]:
    task = get_task_or_404(db, task_id, tenant_id=current_user.tenant_id, current_user=current_user)
    existing_events = _list_duplicate_task_events(db, task_id=task_id, current_user=current_user)
    if existing_events:
        canonical = existing_events[0]
        for duplicate in existing_events[1:]:
            delete_calendar_event(db, event=duplicate)
        return get_calendar_event_or_404(
            db,
            canonical.id,
            tenant_id=current_user.tenant_id,
            current_user=current_user,
        ), True

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
