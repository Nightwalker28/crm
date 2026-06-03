from __future__ import annotations

from datetime import datetime

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session, selectinload

from app.modules.calendar.models import CalendarEvent, CalendarEventParticipant, UserCalendarConnection
from app.modules.calendar.schema import CalendarProvider
from app.modules.user_management.models import Team, User


def event_load_options():
    return (
        selectinload(CalendarEvent.owner),
        selectinload(CalendarEvent.participants).selectinload(CalendarEventParticipant.user),
        selectinload(CalendarEvent.participants).selectinload(CalendarEventParticipant.team),
    )


def existing_participant_user_ids(db: Session, *, tenant_id: int, user_ids: set[int]) -> set[int]:
    if not user_ids:
        return set()
    return {
        user_id
        for (user_id,) in db.query(User.id).filter(User.tenant_id == tenant_id, User.id.in_(user_ids)).all()
    }


def existing_participant_team_ids(db: Session, *, tenant_id: int, team_ids: set[int]) -> set[int]:
    if not team_ids:
        return set()
    return {
        team_id
        for (team_id,) in db.query(Team.id).filter(Team.tenant_id == tenant_id, Team.id.in_(team_ids)).all()
    }


def list_calendar_events(db: Session, *, tenant_id: int, current_user, start_at: datetime, end_at: datetime) -> list[CalendarEvent]:
    query = build_visible_calendar_events_query(db, tenant_id=tenant_id, current_user=current_user).filter(
        CalendarEvent.start_at < end_at,
        CalendarEvent.end_at > start_at,
    )
    return query.order_by(CalendarEvent.start_at.asc(), CalendarEvent.id.asc()).all()


def build_visible_calendar_events_query(db: Session, *, tenant_id: int, current_user):
    query = (
        db.query(CalendarEvent)
        .options(*event_load_options())
        .filter(
            CalendarEvent.tenant_id == tenant_id,
            CalendarEvent.deleted_at.is_(None),
        )
        .outerjoin(CalendarEventParticipant, CalendarEventParticipant.event_id == CalendarEvent.id)
    )
    visibility_filters = [
        CalendarEvent.owner_user_id == current_user.id,
        and_(
            CalendarEventParticipant.user_id == current_user.id,
            CalendarEventParticipant.response_status != "declined",
        ),
    ]
    if getattr(current_user, "team_id", None):
        visibility_filters.append(
            and_(
                CalendarEventParticipant.team_id == current_user.team_id,
                CalendarEventParticipant.response_status == "shared",
            )
        )

    return query.filter(or_(*visibility_filters)).distinct()


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
    query = build_visible_calendar_events_query(db, tenant_id=tenant_id, current_user=current_user)
    if start_at is not None:
        query = query.filter(CalendarEvent.end_at > start_at)
    if end_at is not None:
        query = query.filter(CalendarEvent.start_at < end_at)
    if cursor is not None:
        query = query.filter(CalendarEvent.id < cursor)
    return query.order_by(None).order_by(CalendarEvent.id.desc()).limit(limit + 1).all()


def list_pending_invites(db: Session, *, tenant_id: int, current_user) -> list[CalendarEvent]:
    return (
        db.query(CalendarEvent)
        .options(*event_load_options())
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


def get_visible_calendar_event(
    db: Session,
    *,
    event_id: int,
    tenant_id: int,
    current_user,
    include_deleted: bool = False,
) -> CalendarEvent | None:
    query = db.query(CalendarEvent).options(*event_load_options()).filter(CalendarEvent.id == event_id, CalendarEvent.tenant_id == tenant_id)
    if include_deleted:
        query = query.filter(CalendarEvent.deleted_at.is_not(None))
    else:
        query = query.filter(CalendarEvent.deleted_at.is_(None))
    visibility_filters = [
        CalendarEvent.owner_user_id == current_user.id,
        CalendarEvent.participants.any(CalendarEventParticipant.user_id == current_user.id),
    ]
    if getattr(current_user, "team_id", None):
        visibility_filters.append(CalendarEvent.participants.any(CalendarEventParticipant.team_id == current_user.team_id))
    return query.filter(or_(*visibility_filters)).first()


def google_connection_for_user(
    db: Session,
    *,
    tenant_id: int,
    user_id: int,
    include_non_connected: bool = False,
) -> UserCalendarConnection | None:
    query = db.query(UserCalendarConnection).filter(
        UserCalendarConnection.tenant_id == tenant_id,
        UserCalendarConnection.user_id == user_id,
        UserCalendarConnection.provider == CalendarProvider.google.value,
    )
    if not include_non_connected:
        query = query.filter(UserCalendarConnection.status == "connected")
    return query.order_by(UserCalendarConnection.id.asc()).first()


def microsoft_connection_for_user(
    db: Session,
    *,
    tenant_id: int,
    user_id: int,
    include_non_connected: bool = False,
) -> UserCalendarConnection | None:
    query = db.query(UserCalendarConnection).filter(
        UserCalendarConnection.tenant_id == tenant_id,
        UserCalendarConnection.user_id == user_id,
        UserCalendarConnection.provider == CalendarProvider.microsoft.value,
    )
    if not include_non_connected:
        query = query.filter(UserCalendarConnection.status == "connected")
    return query.order_by(UserCalendarConnection.id.asc()).first()


def get_event_for_external_sync(db: Session, *, event_id: int) -> CalendarEvent | None:
    return db.query(CalendarEvent).options(*event_load_options()).filter(CalendarEvent.id == event_id, CalendarEvent.deleted_at.is_(None)).first()


def team_member_ids(db: Session, *, tenant_id: int, team_ids: list[int]) -> list[tuple[int]]:
    return db.query(User.id).filter(User.tenant_id == tenant_id, User.team_id.in_(team_ids)).all()


def list_deleted_calendar_events(db: Session, *, tenant_id: int, pagination) -> tuple[list[CalendarEvent], int]:
    query = db.query(CalendarEvent).options(*event_load_options()).filter(CalendarEvent.tenant_id == tenant_id, CalendarEvent.deleted_at.is_not(None))
    total_count = query.count()
    items = query.order_by(CalendarEvent.deleted_at.desc(), CalendarEvent.start_at.asc()).offset(pagination.offset).limit(pagination.limit).all()
    return items, total_count


def list_context_users(db: Session, *, tenant_id: int) -> list[User]:
    return (
        db.query(User)
        .options(selectinload(User.team))
        .filter(User.tenant_id == tenant_id)
        .order_by(User.first_name.asc(), User.last_name.asc(), User.email.asc())
        .limit(500)
        .all()
    )


def list_context_teams(db: Session, *, tenant_id: int) -> list[Team]:
    return db.query(Team).filter(Team.tenant_id == tenant_id).order_by(Team.name.asc()).all()


def list_user_calendar_connections(db: Session, *, tenant_id: int, user_id: int) -> list[UserCalendarConnection]:
    return (
        db.query(UserCalendarConnection)
        .filter(UserCalendarConnection.tenant_id == tenant_id, UserCalendarConnection.user_id == user_id)
        .order_by(UserCalendarConnection.provider.asc())
        .all()
    )


def pending_invite_count(db: Session, *, tenant_id: int, user_id: int) -> int:
    return (
        db.query(CalendarEventParticipant)
        .join(CalendarEvent, CalendarEvent.id == CalendarEventParticipant.event_id)
        .filter(
            CalendarEventParticipant.tenant_id == tenant_id,
            CalendarEventParticipant.user_id == user_id,
            CalendarEventParticipant.response_status == "pending",
            CalendarEvent.deleted_at.is_(None),
        )
        .count()
    )


def list_duplicate_task_events(db: Session, *, task_id: int, current_user, include_deleted: bool = False) -> list[CalendarEvent]:
    query = (
        db.query(CalendarEvent)
        .options(*event_load_options())
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
    return query.order_by(CalendarEvent.id.asc()).all()


def build_user_sync_query(db: Session, *, current_user):
    return (
        db.query(CalendarEvent)
        .options(*event_load_options())
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
    )


def get_sync_job_actor(db: Session, *, tenant_id: int, user_id: int) -> User | None:
    return db.query(User).filter(User.id == user_id, User.tenant_id == tenant_id).first()
