from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import and_, func
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.module_filters import apply_filter_conditions
from app.core.module_search import apply_ranked_search
from app.core.pagination import Pagination, build_paged_response
from app.core.postgres_search import searchable_text
from app.modules.user_management.models import Role, Team, User, UserAuthMode, UserStatus
from app.modules.user_management.schema import (
    AdminCreateUserRequest,
    AdminCreateUserResponse,
    UpdateUserRequest,
    UserProfile,
    UserUpdateOptions,
)
from app.modules.user_management.services.auth import create_user_setup_link


USER_FILTER_FIELD_MAP = {
    "first_name": {"expression": User.first_name, "type": "text"},
    "last_name": {"expression": User.last_name, "type": "text"},
    "email": {"expression": User.email, "type": "text"},
    "team_name": {"expression": Team.name, "type": "text"},
    "role_name": {"expression": Role.name, "type": "text"},
    "auth_mode": {"expression": User.auth_mode, "type": "text"},
    "is_active": {"expression": User.is_active, "type": "text"},
}


def list_all_users(db: Session, *, tenant_id: int, pagination: Pagination):
    query = (
        db.query(User)
        .options(joinedload(User.team), selectinload(User.role))
        .outerjoin(Team, and_(Team.id == User.team_id, Team.tenant_id == User.tenant_id))
        .outerjoin(Role, and_(Role.id == User.role_id, Role.tenant_id == User.tenant_id))
        .filter(User.tenant_id == tenant_id)
    )
    unassigned_label = "Unassigned"

    team_sort = func.coalesce(Team.name, unassigned_label)
    query = query.order_by(
        team_sort.asc(),
        User.first_name.asc(),
        User.id.asc(),
    )

    total_count = query.count()
    items = query.offset(pagination.offset).limit(pagination.limit).all()
    serialized = _serialize_user_profiles(items)
    return build_paged_response(serialized, total_count, pagination)


def search_users(
    db: Session,
    *,
    tenant_id: int,
    pagination: Pagination,
    q: Optional[str],
    teams: Optional[str],
    roles: Optional[str],
    status_filter: Optional[str],
    sort_by: str,
    sort_order: str,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
):
    query = (
        db.query(User)
        .options(joinedload(User.team), selectinload(User.role))
        .outerjoin(Team, and_(Team.id == User.team_id, Team.tenant_id == User.tenant_id))
        .outerjoin(Role, and_(Role.id == User.role_id, Role.tenant_id == User.tenant_id))
        .filter(User.tenant_id == tenant_id)
    )

    unassigned_label = "Unassigned"

    if teams and teams.lower() != "all":
        try:
            ids = [int(x) for x in teams.split(",") if x.strip().isdigit()]
            if ids:
                query = query.filter(User.team_id.in_(ids))
        except ValueError:
            pass

    if roles and roles.lower() != "all":
        try:
            ids = [int(x) for x in roles.split(",") if x.strip().isdigit()]
            if ids:
                query = query.filter(User.role_id.in_(ids))
        except ValueError:
            pass

    if status_filter:
        raw_statuses = [s.strip().lower() for s in status_filter.split(",") if s.strip()]
        valid_statuses = []
        for current_status in raw_statuses:
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

    query = apply_ranked_search(
        query,
        search=q,
        document=searchable_text(User.first_name, User.last_name, User.email),
        default_order_by=default_order_by,
    )

    total_count = query.count()
    items = query.offset(pagination.offset).limit(pagination.limit).all()
    serialized = _serialize_user_profiles(items)
    return build_paged_response(serialized, total_count, pagination)


def list_user_update_options(db: Session, *, tenant_id: int) -> UserUpdateOptions:
    roles = db.query(Role).filter(Role.tenant_id == tenant_id).order_by(Role.name.asc()).all()
    teams = db.query(Team).filter(Team.tenant_id == tenant_id).order_by(Team.name.asc()).all()
    statuses = [UserStatus.active.value, UserStatus.inactive.value]
    return UserUpdateOptions(roles=roles, teams=teams, statuses=statuses)

def create_user(
    db: Session,
    payload: AdminCreateUserRequest,
    *,
    tenant_id: int,
    frontend_origin: str | None = None,
) -> AdminCreateUserResponse:
    if payload.is_active == UserStatus.pending:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Pending status is no longer supported",
        )

    normalized_email = payload.email.strip().lower()
    existing_user = (
        db.query(User)
        .filter(
            User.tenant_id == tenant_id,
            func.lower(User.email) == normalized_email,
        )
        .first()
    )
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists",
        )

    _get_role_or_404(db, payload.role_id, tenant_id=tenant_id)
    _get_team_or_404(db, payload.team_id, tenant_id=tenant_id)

    user = User(
        tenant_id=tenant_id,
        email=normalized_email,
        first_name=payload.first_name.strip() if payload.first_name else None,
        last_name=payload.last_name.strip() if payload.last_name else None,
        role_id=payload.role_id,
        team_id=payload.team_id,
        auth_mode=payload.auth_mode,
        is_active=payload.is_active,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    setup_link = None
    if payload.auth_mode in {UserAuthMode.manual_only, UserAuthMode.manual_or_google}:
        setup_link = create_user_setup_link(
            db,
            user,
            frontend_origin=frontend_origin,
        )
        db.refresh(user)

    return AdminCreateUserResponse(
        user=UserProfile.model_validate(user),
        setup_link=setup_link,
    )


def update_user(db: Session, user_id: int, payload: UpdateUserRequest, *, tenant_id: int) -> User:
    user = (
        db.query(User)
        .filter(
            User.id == user_id,
            User.tenant_id == tenant_id,
        )
        .first()
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    update_data = payload.model_dump(exclude_unset=True)
    if "role_id" in update_data and update_data["role_id"] is not None:
        _get_role_or_404(db, update_data["role_id"], tenant_id=tenant_id)
    if "team_id" in update_data and update_data["team_id"] is not None:
        _get_team_or_404(db, update_data["team_id"], tenant_id=tenant_id)
    if "is_active" in update_data and update_data["is_active"] == UserStatus.pending:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Pending status is no longer supported",
        )

    for field, value in update_data.items():
        setattr(user, field, value)

    db.add(user)
    db.commit()
    db.refresh(user)
    return user

def _serialize_user_profiles(users: list[User]):
    return [UserProfile.model_validate(user) for user in users]


def _get_role_or_404(db: Session, role_id: int, *, tenant_id: int) -> Role:
    role = db.query(Role).filter(Role.id == role_id, Role.tenant_id == tenant_id).first()
    if not role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
    return role


def _get_team_or_404(db: Session, team_id: int, *, tenant_id: int) -> Team:
    team = db.query(Team).filter(Team.id == team_id, Team.tenant_id == tenant_id).first()
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    return team
