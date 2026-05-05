from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import and_, func
from sqlalchemy.orm import Session, contains_eager

from app.core.cache import cache_delete, cache_get_json, cache_set_json
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

USER_UPDATE_OPTIONS_CACHE_TTL_SECONDS = 300


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
        .outerjoin(Team, and_(Team.id == User.team_id, Team.tenant_id == User.tenant_id))
        .outerjoin(Role, and_(Role.id == User.role_id, Role.tenant_id == User.tenant_id))
        .options(contains_eager(User.team), contains_eager(User.role))
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
        .outerjoin(Team, and_(Team.id == User.team_id, Team.tenant_id == User.tenant_id))
        .outerjoin(Role, and_(Role.id == User.role_id, Role.tenant_id == User.tenant_id))
        .options(contains_eager(User.team), contains_eager(User.role))
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
    cached = cache_get_json(_user_update_options_cache_key(tenant_id))
    if cached:
        return UserUpdateOptions.model_validate(cached)

    roles = db.query(Role).filter(Role.tenant_id == tenant_id).order_by(Role.name.asc()).all()
    teams = db.query(Team).filter(Team.tenant_id == tenant_id).order_by(Team.name.asc()).all()
    statuses = [UserStatus.active.value, UserStatus.inactive.value]
    result = UserUpdateOptions(roles=roles, teams=teams, statuses=statuses)
    cache_set_json(
        _user_update_options_cache_key(tenant_id),
        result.model_dump(mode="json"),
        ttl_seconds=USER_UPDATE_OPTIONS_CACHE_TTL_SECONDS,
    )
    return result


def invalidate_user_update_options_cache(tenant_id: int) -> None:
    cache_delete(_user_update_options_cache_key(tenant_id))

def create_user(
    db: Session,
    payload: AdminCreateUserRequest,
    *,
    tenant_id: int,
    frontend_origin: str | None = None,
) -> AdminCreateUserResponse:
    is_active = _coerce_user_status(payload.is_active)
    auth_mode = _coerce_auth_mode(payload.auth_mode)
    if is_active == UserStatus.pending:
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

    role, team = _get_role_and_team_or_404(
        db,
        role_id=payload.role_id,
        team_id=payload.team_id,
        tenant_id=tenant_id,
    )

    user = User(
        tenant_id=tenant_id,
        email=normalized_email,
        first_name=payload.first_name.strip() if payload.first_name else None,
        last_name=payload.last_name.strip() if payload.last_name else None,
        role_id=payload.role_id,
        team_id=payload.team_id,
        department_id=getattr(team, "department_id", None),
        auth_mode=auth_mode,
        is_active=is_active,
    )
    db.add(user)
    db.flush()

    setup_link = None
    if auth_mode in {UserAuthMode.manual_only, UserAuthMode.manual_or_google}:
        setup_link = create_user_setup_link(
            db,
            user,
            frontend_origin=frontend_origin,
            commit=False,
        )
    db.commit()
    db.refresh(user)
    user._serialized_team_name = getattr(team, "name", None)
    user._serialized_role_name = getattr(role, "name", None)
    user._serialized_role_level = getattr(role, "level", None)

    return AdminCreateUserResponse(
        user=serialize_user_profile(user),
        setup_link=setup_link,
    )


def update_user(db: Session, user_id: int, payload: UpdateUserRequest, *, tenant_id: int) -> User:
    update_data = payload.model_dump(exclude_unset=True)
    if "is_active" in update_data:
        update_data["is_active"] = _coerce_user_status(update_data["is_active"])
    if "auth_mode" in update_data:
        update_data["auth_mode"] = _coerce_auth_mode(update_data["auth_mode"])
    if update_data.get("is_active") == UserStatus.pending:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Pending status is no longer supported",
        )

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

    loaded_role = None
    loaded_team = None
    if "role_id" in update_data and update_data["role_id"] is not None:
        loaded_role = _get_role_or_404(db, update_data["role_id"], tenant_id=tenant_id)
    if "team_id" in update_data:
        if update_data["team_id"] is None:
            update_data["department_id"] = None
        else:
            loaded_team = _get_team_or_404(db, update_data["team_id"], tenant_id=tenant_id)
            update_data["department_id"] = getattr(loaded_team, "department_id", None)
    for field, value in update_data.items():
        setattr(user, field, value)

    db.add(user)
    db.commit()
    db.refresh(user)
    if loaded_team is not None or update_data.get("team_id") is None:
        user._serialized_team_name = getattr(loaded_team, "name", None)
    if loaded_role is not None:
        user._serialized_role_name = getattr(loaded_role, "name", None)
        user._serialized_role_level = getattr(loaded_role, "level", None)
    return user

def _serialize_user_profiles(users: list[User]):
    return [serialize_user_profile(user) for user in users]


def serialize_user_profile(user: User) -> UserProfile:
    payload = {
        "id": user.id,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "email": user.email,
        "team_id": user.team_id,
        "role_id": user.role_id,
        "team_name": (
            getattr(user, "_serialized_team_name", None)
            or getattr(getattr(user, "team", None), "name", None)
            or "Unassigned"
        ),
        "role_name": (
            getattr(user, "_serialized_role_name", None)
            or getattr(getattr(user, "role", None), "name", None)
            or "Unassigned"
        ),
        "role_level": (
            getattr(user, "_serialized_role_level", None)
            or getattr(getattr(user, "role", None), "level", None)
        ),
        "is_admin": False,
        "photo_url": user.photo_url,
        "phone_number": user.phone_number,
        "job_title": user.job_title,
        "timezone": user.timezone,
        "bio": user.bio,
        "auth_mode": user.auth_mode,
        "last_login_provider": user.last_login_provider,
        "is_active": user.is_active,
    }
    return UserProfile.model_validate(payload)


def _user_update_options_cache_key(tenant_id: int) -> str:
    return f"user-update-options:{tenant_id}"


def _coerce_user_status(value) -> UserStatus:
    return UserStatus(getattr(value, "value", value))


def _coerce_auth_mode(value) -> UserAuthMode:
    return UserAuthMode(getattr(value, "value", value))


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


def _get_role_and_team_or_404(
    db: Session,
    *,
    role_id: int,
    team_id: int,
    tenant_id: int,
) -> tuple[Role, Team]:
    result = (
        db.query(Role, Team)
        .filter(
            Role.id == role_id,
            Role.tenant_id == tenant_id,
            Team.id == team_id,
            Team.tenant_id == tenant_id,
        )
        .first()
    )
    if result:
        return result
    _get_role_or_404(db, role_id, tenant_id=tenant_id)
    _get_team_or_404(db, team_id, tenant_id=tenant_id)
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role or team not found")
