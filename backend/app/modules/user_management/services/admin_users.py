from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.cache import cache_delete, cache_get_json, cache_set_json
from app.core.pagination import Pagination, build_paged_response
from app.modules.user_management.repositories import admin_users_repository
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
UNSET_ASSIGNMENT = object()


def list_all_users(db: Session, *, tenant_id: int, pagination: Pagination):
    items, total_count = admin_users_repository.list_users(
        db,
        tenant_id=tenant_id,
        offset=pagination.offset,
        limit=pagination.limit,
    )
    serialized = _serialize_user_profiles(items)
    return build_paged_response(serialized, total_count, pagination)


def list_all_users_cursor(db: Session, *, tenant_id: int, limit: int, cursor: int | None = None):
    return admin_users_repository.list_users_cursor(db, tenant_id=tenant_id, limit=limit, cursor=cursor)


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
    items, total_count = admin_users_repository.search_users(
        db,
        tenant_id=tenant_id,
        offset=pagination.offset,
        limit=pagination.limit,
        q=q,
        teams=teams,
        roles=roles,
        status_filter=status_filter,
        sort_by=sort_by,
        sort_order=sort_order,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    serialized = _serialize_user_profiles(items)
    return build_paged_response(serialized, total_count, pagination)


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
):
    return admin_users_repository.search_users_cursor(
        db,
        tenant_id=tenant_id,
        limit=limit,
        cursor=cursor,
        q=q,
        teams=teams,
        roles=roles,
        status_filter=status_filter,
        sort_by=sort_by,
        sort_order=sort_order,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )


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

    role, team = _load_user_assignment_refs_or_404(
        db,
        tenant_id=tenant_id,
        role_id=payload.role_id,
        team_id=payload.team_id,
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

    loaded_role, loaded_team = _load_user_assignment_refs_or_404(
        db,
        tenant_id=tenant_id,
        role_id=update_data["role_id"] if "role_id" in update_data else UNSET_ASSIGNMENT,
        team_id=update_data["team_id"] if "team_id" in update_data else UNSET_ASSIGNMENT,
    )
    if "team_id" in update_data:
        if update_data["team_id"] is None:
            update_data["department_id"] = None
        else:
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


def _load_user_assignment_refs_or_404(
    db: Session,
    *,
    tenant_id: int,
    role_id: int | object = UNSET_ASSIGNMENT,
    team_id: int | None | object = UNSET_ASSIGNMENT,
) -> tuple[Role | None, Team | None]:
    role = None
    team = None
    if role_id is not UNSET_ASSIGNMENT and role_id is not None:
        role = _get_role_or_404(db, role_id, tenant_id=tenant_id)
    if team_id is not UNSET_ASSIGNMENT and team_id is not None:
        team = _get_team_or_404(db, team_id, tenant_id=tenant_id)
    return role, team
