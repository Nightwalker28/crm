from typing import Any

from sqlalchemy.orm import Session

from app.core.pagination import Pagination
from app.modules.platform.models import ActivityLog


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
) -> ActivityLog:
    entry = ActivityLog(
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key=module_key,
        entity_type=entity_type,
        entity_id=str(entity_id),
        action=action,
        description=description,
        before_state=before_state,
        after_state=after_state,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def list_activity_logs(
    db: Session,
    *,
    tenant_id: int,
    pagination: Pagination,
    module_key: str | None = None,
    entity_type: str | None = None,
    action: str | None = None,
) -> tuple[list[ActivityLog], int]:
    query = db.query(ActivityLog).filter(ActivityLog.tenant_id == tenant_id)
    if module_key:
        query = query.filter(ActivityLog.module_key == module_key)
    if entity_type:
        query = query.filter(ActivityLog.entity_type == entity_type)
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
