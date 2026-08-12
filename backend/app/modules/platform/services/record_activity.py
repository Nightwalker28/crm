"""Normalized relationship activity projection.

Each supported interaction keeps living in its own source-domain table. This
module only *reads* those tables and merges them into one chronological feed.
There is no canonical activity table and no second event store.

Immutable audit history (``activity_logs``) is deliberately excluded: it is
served separately by ``platform/routes/activity_logs.py`` and rendered in its
own UI region.

Linkage is always explicit. An adapter matches a source row to a record through
linkage the source domain writes on purpose: ``source_module_key`` /
``source_entity_id``, ``module_key`` / ``entity_id``, or — for mail — the
``mail_record_associations`` rows owned by the mail domain. Nothing is inferred
from email addresses or phone numbers.

Record access is not source access. Each adapter declares the module a viewer
additionally needs ``view`` on, and mail narrows further to the viewer's own
mailbox.
"""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, joinedload

from app.core.access_control import PermissionPolicy
from app.modules.calendar.models import CalendarEvent
from app.modules.mail.models import MailMessage, MailRecordAssociation
from app.modules.platform.models import RecordComment, RecordFollowUp
from app.modules.platform.services.record_comments import get_record_reference
from app.modules.tasks.models import Task
from app.modules.user_management.models import User
from app.modules.whatsapp.models import WhatsAppInteraction

DEFAULT_LIMIT = 25
MAX_LIMIT = 100
SUMMARY_LENGTH = 280

CHANNEL_LABELS = {
    "whatsapp": "WhatsApp",
    "email": "Email",
    "call": "Call",
}


@dataclass(frozen=True)
class ActivityItem:
    """One normalized envelope over a source-domain row."""

    type: str
    source_id: int
    source_module_key: str
    occurred_at: datetime
    title: str
    summary: str | None = None
    actor_user_id: int | None = None
    actor_name: str | None = None
    direction: str | None = None
    status: str | None = None
    capabilities: tuple[str, ...] = ()
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def sort_key(self) -> tuple[datetime, str, int]:
        # Descending on occurred_at and source_id, ascending on type. Negation
        # is handled by the comparator, not here; this is the raw tuple.
        return (self.occurred_at, self.type, self.source_id)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _clip(value: str | None) -> str | None:
    text = (value or "").strip()
    if not text:
        return None
    if len(text) <= SUMMARY_LENGTH:
        return text
    return f"{text[: SUMMARY_LENGTH - 1].rstrip()}…"


def _user_label(user: User | None) -> str | None:
    if user is None:
        return None
    full_name = " ".join(part for part in [user.first_name, user.last_name] if part).strip()
    return full_name or user.email or None


# --------------------------------------------------------------------------- #
# Cursor
# --------------------------------------------------------------------------- #


def encode_cursor(item: ActivityItem) -> str:
    """Opaque cursor over the full ordering tuple.

    Ordering is (occurred_at DESC, type ASC, source_id DESC). ``type`` plus
    ``source_id`` is unique across the feed, so the order is total and the
    cursor never skips or repeats an item when rows share a timestamp.
    """

    occurred_at = _as_utc(item.occurred_at)
    micros = int(occurred_at.timestamp() * 1_000_000)
    raw = f"{micros}:{item.type}:{item.source_id}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii").rstrip("=")


def decode_cursor(value: str | None) -> tuple[datetime, str, int] | None:
    if not value:
        return None
    padded = value + "=" * (-len(value) % 4)
    try:
        raw = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
        micros_text, item_type, source_id_text = raw.split(":", 2)
        occurred_at = datetime.fromtimestamp(int(micros_text) / 1_000_000, tz=timezone.utc)
        return occurred_at, item_type, int(source_id_text)
    except (binascii.Error, UnicodeDecodeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid activity cursor.",
        ) from exc


def _bind_datetime(db: Session, value: datetime) -> datetime:
    """Match the bind parameter to how the dialect stores timestamps.

    PostgreSQL columns are ``timestamptz`` and compare correctly against an
    aware value. SQLite stores naive strings, so an aware bind would compare a
    ``+00:00`` suffix against a value that has none.
    """

    normalized = _as_utc(value)
    if db.get_bind().dialect.name == "sqlite":
        return normalized.replace(tzinfo=None)
    return normalized


def _keyset_filter(occurred_expr, id_expr, *, item_type: str, cursor):
    """Translate the global ordering tuple into a per-adapter predicate.

    Within one adapter ``type`` is constant, so the three-part tuple comparison
    collapses to a comparison the composite index can serve.
    """

    if cursor is None:
        return None
    cursor_time, cursor_type, cursor_id = cursor
    if item_type > cursor_type:
        return occurred_expr <= cursor_time
    if item_type < cursor_type:
        return occurred_expr < cursor_time
    return or_(
        occurred_expr < cursor_time,
        and_(occurred_expr == cursor_time, id_expr < cursor_id),
    )


# --------------------------------------------------------------------------- #
# Adapters
# --------------------------------------------------------------------------- #


def _fetch_follow_ups(db, *, tenant_id, module_key, entity_id, limit, cursor, viewer_user_id) -> list[ActivityItem]:
    occurred = RecordFollowUp.occurred_at
    query = (
        db.query(RecordFollowUp)
        .options(joinedload(RecordFollowUp.actor))
        .filter(
            RecordFollowUp.tenant_id == tenant_id,
            RecordFollowUp.module_key == module_key,
            RecordFollowUp.entity_id == entity_id,
        )
    )
    predicate = _keyset_filter(occurred, RecordFollowUp.id, item_type="follow_up", cursor=cursor)
    if predicate is not None:
        query = query.filter(predicate)
    rows = query.order_by(None).order_by(occurred.desc(), RecordFollowUp.id.desc()).limit(limit).all()

    items = []
    for row in rows:
        channel_label = CHANNEL_LABELS.get(row.channel, row.channel)
        items.append(
            ActivityItem(
                type="follow_up",
                source_id=row.id,
                source_module_key=row.module_key,
                occurred_at=_as_utc(row.occurred_at),
                title=f"{channel_label} follow-up logged",
                summary=_clip(row.note),
                actor_user_id=row.actor_user_id,
                actor_name=_user_label(row.actor),
                direction="outbound",
                capabilities=("open_task",) if row.follow_up_task_id else (),
                meta={
                    "channel": row.channel,
                    "follow_up_task_id": row.follow_up_task_id,
                },
            )
        )
    return items


def _fetch_notes(db, *, tenant_id, module_key, entity_id, limit, cursor, viewer_user_id) -> list[ActivityItem]:
    occurred = RecordComment.created_at
    query = (
        db.query(RecordComment)
        .options(joinedload(RecordComment.actor))
        .filter(
            RecordComment.tenant_id == tenant_id,
            RecordComment.module_key == module_key,
            RecordComment.entity_id == entity_id,
        )
    )
    predicate = _keyset_filter(occurred, RecordComment.id, item_type="note", cursor=cursor)
    if predicate is not None:
        query = query.filter(predicate)
    rows = query.order_by(None).order_by(occurred.desc(), RecordComment.id.desc()).limit(limit).all()

    return [
        ActivityItem(
            type="note",
            source_id=row.id,
            source_module_key=row.module_key,
            occurred_at=_as_utc(row.created_at),
            title="Note added",
            summary=_clip(row.body),
            actor_user_id=row.actor_user_id,
            actor_name=_user_label(row.actor),
            capabilities=("open",),
            meta={"edited": row.updated_at is not None and row.updated_at != row.created_at},
        )
        for row in rows
    ]


def _fetch_tasks(db, *, tenant_id, module_key, entity_id, limit, cursor, viewer_user_id) -> list[ActivityItem]:
    occurred = Task.created_at
    query = db.query(Task).filter(
        Task.tenant_id == tenant_id,
        Task.source_module_key == module_key,
        Task.source_entity_id == entity_id,
        Task.deleted_at.is_(None),
    )
    predicate = _keyset_filter(occurred, Task.id, item_type="task", cursor=cursor)
    if predicate is not None:
        query = query.filter(predicate)
    rows = query.order_by(None).order_by(occurred.desc(), Task.id.desc()).limit(limit).all()

    return [
        ActivityItem(
            type="task",
            source_id=row.id,
            source_module_key="tasks",
            occurred_at=_as_utc(row.created_at),
            title=row.title,
            summary=_clip(row.description),
            actor_user_id=row.created_by_user_id,
            actor_name=_user_label(row.creator),
            status=row.status,
            capabilities=("open", "complete") if row.status != "completed" else ("open",),
            meta={
                "priority": row.priority,
                "due_at": _as_utc(row.due_at),
                "completed_at": _as_utc(row.completed_at),
                "assignees": [assignee.label for assignee in row.assignees],
            },
        )
        for row in rows
    ]


def _fetch_meetings(db, *, tenant_id, module_key, entity_id, limit, cursor, viewer_user_id) -> list[ActivityItem]:
    occurred = CalendarEvent.start_at
    query = db.query(CalendarEvent).filter(
        CalendarEvent.tenant_id == tenant_id,
        CalendarEvent.source_module_key == module_key,
        CalendarEvent.source_entity_id == entity_id,
        CalendarEvent.deleted_at.is_(None),
    )
    predicate = _keyset_filter(occurred, CalendarEvent.id, item_type="meeting", cursor=cursor)
    if predicate is not None:
        query = query.filter(predicate)
    rows = query.order_by(None).order_by(occurred.desc(), CalendarEvent.id.desc()).limit(limit).all()

    return [
        ActivityItem(
            type="meeting",
            source_id=row.id,
            source_module_key="calendar",
            occurred_at=_as_utc(row.start_at),
            title=row.title,
            summary=_clip(row.description),
            actor_user_id=row.owner_user_id,
            actor_name=_user_label(row.owner),
            status=row.status,
            capabilities=("open",),
            meta={
                "start_at": _as_utc(row.start_at),
                "end_at": _as_utc(row.end_at),
                "is_all_day": bool(row.is_all_day),
                "location": row.location,
                "participants": [participant.label for participant in row.participants],
            },
        )
        for row in rows
    ]


def _fetch_emails(db, *, tenant_id, module_key, entity_id, limit, cursor, viewer_user_id) -> list[ActivityItem]:
    # Mail record association is owned by the mail domain
    # (`mail/services/mail_associations.py`). This adapter only reads the links
    # that domain persisted; it never matches on sender address or subject.
    occurred = func.coalesce(MailMessage.sent_at, MailMessage.received_at, MailMessage.created_at)
    query = (
        db.query(MailMessage, MailRecordAssociation.association_type)
        .join(MailRecordAssociation, MailRecordAssociation.message_id == MailMessage.id)
        .filter(
            MailMessage.tenant_id == tenant_id,
            # Mailbox content is private to the connected user. Viewing a
            # record someone else linked their mail to must not expose that
            # mailbox, so record access alone does not surface the message.
            MailMessage.owner_user_id == viewer_user_id,
            MailMessage.deleted_at.is_(None),
            MailRecordAssociation.tenant_id == tenant_id,
            MailRecordAssociation.module_key == module_key,
            MailRecordAssociation.entity_id == entity_id,
        )
    )
    predicate = _keyset_filter(occurred, MailMessage.id, item_type="email", cursor=cursor)
    if predicate is not None:
        query = query.filter(predicate)
    # One association row per (message, record) is guaranteed by
    # uq_mail_record_associations_link, so the join cannot duplicate a message.
    rows = query.order_by(None).order_by(occurred.desc(), MailMessage.id.desc()).limit(limit).all()

    items = []
    for row, association_type in rows:
        occurred_at = _as_utc(row.sent_at or row.received_at or row.created_at)
        items.append(
            ActivityItem(
                type="email",
                source_id=row.id,
                source_module_key="mail",
                occurred_at=occurred_at,
                title=row.subject or "(no subject)",
                summary=_clip(row.snippet),
                actor_user_id=row.owner_user_id,
                actor_name=row.from_name or row.from_email,
                direction=row.direction,
                # Outbound mail carries its send outcome so a failed attempt is
                # never rendered as a delivered email. Inbound mail has none.
                status=row.send_status,
                capabilities=("open", "reply"),
                meta={
                    "from_email": row.from_email,
                    "to_recipients": row.to_recipients or [],
                    "folder": row.folder,
                    "thread_key": row.provider_thread_id,
                    "association_type": association_type,
                },
            )
        )
    return items


def _fetch_whatsapp(db, *, tenant_id, module_key, entity_id, limit, cursor, viewer_user_id) -> list[ActivityItem]:
    occurred = WhatsAppInteraction.sent_at
    query = (
        db.query(WhatsAppInteraction)
        .options(joinedload(WhatsAppInteraction.actor))
        .filter(
            WhatsAppInteraction.tenant_id == tenant_id,
            WhatsAppInteraction.source_module_key == module_key,
            WhatsAppInteraction.source_entity_id == entity_id,
        )
    )
    predicate = _keyset_filter(occurred, WhatsAppInteraction.id, item_type="whatsapp", cursor=cursor)
    if predicate is not None:
        query = query.filter(predicate)
    rows = query.order_by(None).order_by(occurred.desc(), WhatsAppInteraction.id.desc()).limit(limit).all()

    return [
        ActivityItem(
            type="whatsapp",
            source_id=row.id,
            source_module_key="whatsapp",
            occurred_at=_as_utc(row.sent_at),
            title="WhatsApp message prepared",
            summary=_clip(row.message_body),
            actor_user_id=row.actor_user_id,
            actor_name=_user_label(row.actor),
            direction="outbound",
            # external_link mode: the CRM prepared the message, it cannot
            # confirm delivery, so no provider status is claimed here.
            status="external_link",
            capabilities=(),
            meta={"phone_number": row.phone_number},
        )
        for row in rows
    ]


@dataclass(frozen=True)
class _Adapter:
    type: str
    fetch: Callable[..., list[ActivityItem]]
    # Module the viewer additionally needs `view` on. None means the item is
    # record-scoped and inherits the record's own module permission.
    permission_module_key: str | None


ADAPTERS: tuple[_Adapter, ...] = (
    _Adapter("email", _fetch_emails, "mail"),
    _Adapter("follow_up", _fetch_follow_ups, None),
    _Adapter("meeting", _fetch_meetings, "calendar"),
    _Adapter("note", _fetch_notes, None),
    _Adapter("task", _fetch_tasks, "tasks"),
    # WhatsApp interactions are gated by the contacts module, matching the
    # permission the whatsapp routes already enforce.
    _Adapter("whatsapp", _fetch_whatsapp, "sales_contacts"),
)

ACTIVITY_TYPES: tuple[str, ...] = tuple(adapter.type for adapter in ADAPTERS)


# --------------------------------------------------------------------------- #
# Projection
# --------------------------------------------------------------------------- #


def parse_types(value: str | None) -> tuple[str, ...]:
    if not value or not value.strip():
        return ACTIVITY_TYPES
    requested = [part.strip() for part in value.split(",") if part.strip()]
    unknown = sorted(set(requested) - set(ACTIVITY_TYPES))
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported activity type(s): {', '.join(unknown)}",
        )
    return tuple(item_type for item_type in ACTIVITY_TYPES if item_type in set(requested))


def _order_key(item: ActivityItem):
    # occurred_at DESC, type ASC, source_id DESC
    return (-item.occurred_at.timestamp(), item.type, -item.source_id)


def serialize_activity_item(item: ActivityItem, *, module_key: str, entity_id: str) -> dict[str, Any]:
    meta = {
        key: (value.isoformat() if isinstance(value, datetime) else value)
        for key, value in item.meta.items()
    }
    return {
        "id": f"{item.type}:{item.source_id}",
        "type": item.type,
        "occurred_at": item.occurred_at.isoformat(),
        "title": item.title,
        "summary": item.summary,
        "direction": item.direction,
        "status": item.status,
        "actor": (
            {"user_id": item.actor_user_id, "name": item.actor_name}
            if item.actor_user_id is not None or item.actor_name
            else None
        ),
        "source": {"module_key": item.source_module_key, "record_id": str(item.source_id)},
        "record": {"module_key": module_key, "entity_id": entity_id},
        "capabilities": list(item.capabilities),
        "meta": meta,
    }


def list_record_activity(
    db: Session,
    *,
    user,
    module_key: str,
    entity_id: str | int,
    types: str | None = None,
    limit: int = DEFAULT_LIMIT,
    cursor: str | None = None,
) -> dict[str, Any]:
    """Merge the source adapters into one deterministic, tenant-scoped page.

    Each adapter is bounded to ``limit + 1`` rows, so the merge never loads an
    unbounded collection. Because every adapter returns its own top slice under
    the same global ordering, the union is guaranteed to contain the global top
    ``limit + 1`` items.
    """

    if limit < 1 or limit > MAX_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"limit must be between 1 and {MAX_LIMIT}.",
        )

    tenant_id = user.tenant_id
    policy = PermissionPolicy(db, user)

    # Record visibility first: tenant module enablement, department/team
    # availability, then the role's view action, then that the record exists in
    # this tenant.
    if not policy.can_view_module(module_key):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Record module access denied.")
    if not policy.can_perform_action(module_key, "view"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Record view permission denied.")
    get_record_reference(db, tenant_id=tenant_id, module_key=module_key, entity_id=entity_id)

    normalized_entity_id = str(entity_id)
    requested_types = set(parse_types(types))
    decoded_cursor = decode_cursor(cursor)
    if decoded_cursor is not None:
        decoded_cursor = (
            _bind_datetime(db, decoded_cursor[0]),
            decoded_cursor[1],
            decoded_cursor[2],
        )

    collected: list[ActivityItem] = []
    omitted_types: list[str] = []
    for adapter in ADAPTERS:
        if adapter.type not in requested_types:
            continue
        if adapter.permission_module_key and not (
            policy.can_view_module(adapter.permission_module_key)
            and policy.can_perform_action(adapter.permission_module_key, "view")
        ):
            # Record access does not grant source-domain access. Drop the whole
            # adapter rather than leaking a redacted stub.
            omitted_types.append(adapter.type)
            continue
        collected.extend(
            adapter.fetch(
                db,
                tenant_id=tenant_id,
                module_key=module_key,
                entity_id=normalized_entity_id,
                limit=limit + 1,
                cursor=decoded_cursor,
                # Only the mail adapter narrows by viewer; the other sources are
                # shared record data gated by their module permission above.
                viewer_user_id=user.id,
            )
        )

    collected.sort(key=_order_key)

    # (type, source_id) is unique per item, so this only guards against an
    # adapter returning the same row twice, never against two distinct sources
    # describing the same interaction.
    seen: set[tuple[str, int]] = set()
    ordered: list[ActivityItem] = []
    for item in collected:
        key = (item.type, item.source_id)
        if key in seen:
            continue
        seen.add(key)
        ordered.append(item)

    has_more = len(ordered) > limit
    page = ordered[:limit]
    next_cursor = encode_cursor(page[-1]) if has_more and page else None

    return {
        "items": [
            serialize_activity_item(item, module_key=module_key, entity_id=normalized_entity_id)
            for item in page
        ],
        "next_cursor": next_cursor,
        "has_more": has_more,
        "limit": limit,
        "available_types": list(ACTIVITY_TYPES),
        "omitted_types": omitted_types,
    }
