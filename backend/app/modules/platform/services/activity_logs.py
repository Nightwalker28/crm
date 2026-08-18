import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from app.core.pagination import Pagination
from app.modules.platform.models import ActivityLog

logger = logging.getLogger(__name__)

# How long a single-field entry stays open to absorb further edits of the same field.
# Measured from the *first* entry, not the last, so a window is bounded: a field edited
# every twenty seconds for an hour produces an entry every two minutes, not one entry that
# never settles.
COALESCE_WINDOW = timedelta(seconds=120)

# Audit states are whole-record snapshots, so every update also moves the record's own
# bookkeeping. Those keys are not what changed — they are the fact that something did.
_VOLATILE_STATE_KEYS = frozenset({
    "updated_at",
    "modified_at",
    "last_modified_at",
    "updated_by",
    "updated_by_id",
    "updated_by_name",
    "modified_by",
    "modified_by_id",
})


def _as_utc(value: datetime | None) -> datetime | None:
    # Postgres hands back an aware datetime and SQLite a naive one; the comparison below
    # has to work under both, and every timestamp this app writes is UTC.
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _single_changed_field(
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
) -> str | None:
    """The one field an update moved, or `None` if it moved none or several.

    `None` is the answer for a create (no before state) and for a multi-field write, both
    of which are left alone — coalescing is for R1's autosave, where one dropdown is
    changed repeatedly while the operator thinks.
    """
    if not isinstance(before, dict) or not isinstance(after, dict):
        return None
    keys = (set(before) | set(after)) - _VOLATILE_STATE_KEYS
    changed = [key for key in keys if before.get(key) != after.get(key)]
    return changed[0] if len(changed) == 1 else None


def _coalescible_predecessor(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int | None,
    module_key: str,
    entity_type: str,
    entity_id: str,
    action: str,
    field: str,
    now: datetime,
) -> ActivityLog | None:
    """The open entry this write should merge into, if there is one.

    Deliberately narrow. Same tenant, same record, same action, same actor and the same
    single field, or the two writes are separate history and stay separate. The window is
    applied in Python rather than SQL so the naive/aware split between SQLite and Postgres
    cannot change the answer.
    """
    candidate = (
        db.query(ActivityLog)
        .filter(
            ActivityLog.tenant_id == tenant_id,
            ActivityLog.module_key == module_key,
            ActivityLog.entity_type == entity_type,
            ActivityLog.entity_id == entity_id,
            ActivityLog.action == action,
            ActivityLog.actor_user_id.is_(None)
            if actor_user_id is None
            else ActivityLog.actor_user_id == actor_user_id,
        )
        .order_by(ActivityLog.id.desc())
        .first()
    )
    if candidate is None:
        return None
    created_at = _as_utc(candidate.created_at)
    if created_at is None or now - created_at > COALESCE_WINDOW:
        return None
    if _single_changed_field(candidate.before_state, candidate.after_state) != field:
        return None
    return candidate


def log_activity(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int | None,
    module_key: str,
    entity_type: str,
    entity_id: str | int,
    action: str,
    description: str | None = None,
    before_state: dict[str, Any] | None = None,
    after_state: dict[str, Any] | None = None,
    commit: bool = True,
) -> ActivityLog | None:
    """Write one audit entry, coalescing a repeated single-field edit into its predecessor.

    R1 makes a detail page's state fields autosave, and this app renders the record's
    history on every record — so changing a stage three times while thinking would put
    three rows in front of the operator. Consecutive entries for the same tenant + record
    + field + actor inside `COALESCE_WINDOW` become one entry keeping the *original*
    before-state and the *latest* after-state.

    Returns `None` in exactly one case: the field came back to the value it started the
    window at, which is a change that never happened and leaves no row behind. Client-side
    debounce is still worth having, but it cannot cover two operators or one operator
    either side of a debounce boundary — which is why this is here and not there.
    """
    encoded_before = jsonable_encoder(before_state) if before_state is not None else None
    encoded_after = jsonable_encoder(after_state) if after_state is not None else None

    field = _single_changed_field(encoded_before, encoded_after)
    if field is not None:
        predecessor = _coalescible_predecessor(
            db,
            tenant_id=tenant_id,
            actor_user_id=actor_user_id,
            module_key=module_key,
            entity_type=entity_type,
            entity_id=str(entity_id),
            action=action,
            field=field,
            now=datetime.now(timezone.utc),
        )
        if predecessor is not None:
            return _merge_into(db, predecessor, field=field, after_state=encoded_after, commit=commit)

    entry = ActivityLog(
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key=module_key,
        entity_type=entity_type,
        entity_id=str(entity_id),
        action=action,
        description=description,
        before_state=encoded_before,
        after_state=encoded_after,
    )
    db.add(entry)
    if commit:
        db.commit()
        db.refresh(entry)
    return entry


def _merge_into(
    db: Session,
    predecessor: ActivityLog,
    *,
    field: str,
    after_state: dict[str, Any] | None,
    commit: bool,
) -> ActivityLog | None:
    # The predecessor's before-state is the window's starting point and never moves; only
    # where the field ended up does. `created_at` stays put too, so a coalescing entry does
    # not jump to the top of a feed the operator is already reading.
    before = predecessor.before_state or {}
    if before.get(field) == (after_state or {}).get(field):
        db.delete(predecessor)
        if commit:
            db.commit()
        return None

    predecessor.after_state = after_state
    db.add(predecessor)
    if commit:
        db.commit()
        db.refresh(predecessor)
    return predecessor


def safe_log_activity(db: Session, **kwargs: Any) -> ActivityLog | None:
    try:
        return log_activity(db, **kwargs)
    except Exception:
        db.rollback()
        logger.exception(
            "Activity log write failed for %s %s",
            kwargs.get("entity_type"),
            kwargs.get("entity_id"),
        )
        return None


def list_activity_logs(
    db: Session,
    *,
    tenant_id: int,
    pagination: Pagination,
    module_key: str | None = None,
    entity_type: str | None = None,
    entity_id: str | int | None = None,
    action: str | None = None,
) -> tuple[list[ActivityLog], int]:
    query = db.query(ActivityLog).filter(ActivityLog.tenant_id == tenant_id)
    if module_key:
        query = query.filter(ActivityLog.module_key == module_key)
    if entity_type:
        query = query.filter(ActivityLog.entity_type == entity_type)
    if entity_id is not None:
        query = query.filter(ActivityLog.entity_id == str(entity_id))
    if action:
        query = query.filter(ActivityLog.action == action)

    total = query.count()
    items = (
        query
        .order_by(ActivityLog.created_at.desc(), ActivityLog.id.desc())
        .offset(pagination.offset)
        .limit(pagination.limit)
        .all()
    )
    return items, total


def list_activity_logs_cursor(
    db: Session,
    *,
    tenant_id: int,
    limit: int,
    cursor: int | None = None,
    module_key: str | None = None,
    entity_type: str | None = None,
    entity_id: str | int | None = None,
    action: str | None = None,
) -> list[ActivityLog]:
    query = db.query(ActivityLog).filter(ActivityLog.tenant_id == tenant_id)
    if module_key:
        query = query.filter(ActivityLog.module_key == module_key)
    if entity_type:
        query = query.filter(ActivityLog.entity_type == entity_type)
    if entity_id is not None:
        query = query.filter(ActivityLog.entity_id == str(entity_id))
    if action:
        query = query.filter(ActivityLog.action == action)
    if cursor is not None:
        query = query.filter(ActivityLog.id < cursor)
    return query.order_by(None).order_by(ActivityLog.id.desc()).limit(limit + 1).all()
