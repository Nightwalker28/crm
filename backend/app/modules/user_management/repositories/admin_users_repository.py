from __future__ import annotations

from typing import Optional

from sqlalchemy import and_, func
from sqlalchemy.orm import Session, contains_eager

from app.core.module_filters import apply_filter_conditions
from app.core.module_search import apply_ranked_search
from app.core.postgres_search import searchable_text
from app.modules.user_management.models import Role, Team, User, UserStatus


USER_FILTER_FIELD_MAP = {
    "first_name": {"expression": User.first_name, "type": "text"},
    "last_name": {"expression": User.last_name, "type": "text"},
    "email": {"expression": User.email, "type": "text"},
    "team_name": {"expression": Team.name, "type": "text"},
    "role_name": {"expression": Role.name, "type": "text"},
    "auth_mode": {"expression": User.auth_mode, "type": "text"},
    "is_active": {"expression": User.is_active, "type": "text"},
}


def build_user_query(db: Session, *, tenant_id: int):
    return (
        db.query(User)
        .outerjoin(Team, and_(Team.id == User.team_id, Team.tenant_id == User.tenant_id))
        .outerjoin(Role, and_(Role.id == User.role_id, Role.tenant_id == User.tenant_id))
        .options(contains_eager(User.team), contains_eager(User.role))
        .filter(User.tenant_id == tenant_id)
    )


def apply_user_search_filters(
    query,
    *,
    q: Optional[str],
    teams: Optional[str],
    roles: Optional[str],
    status_filter: Optional[str],
    sort_by: str,
    sort_order: str,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
):
    if teams and teams.lower() != "all":
        ids = [int(value) for value in teams.split(",") if value.strip().isdigit()]
        if ids:
            query = query.filter(User.team_id.in_(ids))

    if roles and roles.lower() != "all":
        ids = [int(value) for value in roles.split(",") if value.strip().isdigit()]
        if ids:
            query = query.filter(User.role_id.in_(ids))

    if status_filter:
        valid_statuses = []
        for current_status in [item.strip().lower() for item in status_filter.split(",") if item.strip()]:
            try:
                valid_statuses.append(UserStatus(current_status))
            except ValueError:
                pass
        if valid_statuses:
            query = query.filter(User.is_active.in_(valid_statuses))

    query = apply_filter_conditions(
        query,
        conditions=all_filter_conditions,
        logic="all",
        field_map=USER_FILTER_FIELD_MAP,
    )
    query = apply_filter_conditions(
        query,
        conditions=any_filter_conditions,
        logic="any",
        field_map=USER_FILTER_FIELD_MAP,
    )

    unassigned_label = "Unassigned"
    team_sort = func.coalesce(Team.name, unassigned_label)
    if sort_by == "email":
        user_sort = User.email
    elif sort_by == "role":
        user_sort = Role.name
    elif sort_by == "status":
        user_sort = User.is_active
    else:
        user_sort = User.first_name

    if sort_order == "desc":
        default_order_by = [team_sort.asc(), user_sort.desc(), User.id.desc()]
    else:
        default_order_by = [team_sort.asc(), user_sort.asc(), User.id.asc()]

    return apply_ranked_search(
        query,
        search=q,
        document=searchable_text(User.first_name, User.last_name, User.email),
        default_order_by=default_order_by,
    )


def count_user_query(db: Session, query) -> int:
    count_source = query.order_by(None).with_entities(User.id).subquery()
    return int(db.query(func.count()).select_from(count_source).scalar() or 0)


def list_users(db: Session, *, tenant_id: int, offset: int, limit: int) -> tuple[list[User], int]:
    unassigned_label = "Unassigned"
    team_sort = func.coalesce(Team.name, unassigned_label)
    query = build_user_query(db, tenant_id=tenant_id).order_by(
        team_sort.asc(),
        User.first_name.asc(),
        User.id.asc(),
    )
    total_count = count_user_query(db, query)
    return query.offset(offset).limit(limit).all(), total_count


def list_users_cursor(db: Session, *, tenant_id: int, limit: int, cursor: int | None = None) -> list[User]:
    query = build_user_query(db, tenant_id=tenant_id)
    if cursor is not None:
        query = query.filter(User.id < cursor)
    return query.order_by(None).order_by(User.id.desc()).limit(limit + 1).all()


def search_users(
    db: Session,
    *,
    tenant_id: int,
    offset: int,
    limit: int,
    q: Optional[str],
    teams: Optional[str],
    roles: Optional[str],
    status_filter: Optional[str],
    sort_by: str,
    sort_order: str,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> tuple[list[User], int]:
    query = apply_user_search_filters(
        build_user_query(db, tenant_id=tenant_id),
        q=q,
        teams=teams,
        roles=roles,
        status_filter=status_filter,
        sort_by=sort_by,
        sort_order=sort_order,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    total_count = count_user_query(db, query)
    return query.offset(offset).limit(limit).all(), total_count


def search_users_cursor(
    db: Session,
    *,
    tenant_id: int,
    limit: int,
    cursor: int | None = None,
    q: Optional[str] = None,
    teams: Optional[str] = None,
    roles: Optional[str] = None,
    status_filter: Optional[str] = None,
    sort_by: str = "name",
    sort_order: str = "asc",
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> list[User]:
    query = apply_user_search_filters(
        build_user_query(db, tenant_id=tenant_id),
        q=q,
        teams=teams,
        roles=roles,
        status_filter=status_filter,
        sort_by=sort_by,
        sort_order=sort_order,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    if cursor is not None:
        query = query.filter(User.id < cursor)
    return query.order_by(None).order_by(User.id.desc()).limit(limit + 1).all()
