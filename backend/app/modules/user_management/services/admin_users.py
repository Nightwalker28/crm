from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import case, func
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.pagination import Pagination, build_paged_response
from app.core.postgres_search import apply_trigram_search, searchable_text
from app.modules.user_management.models import Role, Team, User, UserStatus
from app.modules.user_management.schema import (
    ApproveUserRequest,
    UpdateUserRequest,
    UserProfile,
    UserUpdateOptions,
)


def list_all_users(db: Session, pagination: Pagination):
    query = (
        db.query(User)
        .options(joinedload(User.team), selectinload(User.role))
        .outerjoin(Team)
    )

    unassigned_label = "Action Required"

    attention_sort = case(
        (
            (User.is_active == UserStatus.pending)
            & (User.role_id.is_(None))
            & (User.team_id.is_(None)),
            0,
        ),
        else_=1,
    )

    team_sort = func.coalesce(Team.name, unassigned_label)
    query = query.order_by(
        attention_sort.asc(),
        team_sort.asc(),
        User.first_name.asc(),
        User.id.asc(),
    )

    total_count = query.count()
    items = query.offset(pagination.offset).limit(pagination.limit).all()
    serialized = _serialize_user_profiles(items, unassigned_label)
    return build_paged_response(serialized, total_count, pagination)


def search_users(
    db: Session,
    pagination: Pagination,
    q: Optional[str],
    teams: Optional[str],
    roles: Optional[str],
    status_filter: Optional[str],
    sort_by: str,
    sort_order: str,
):
    query = (
        db.query(User)
        .options(joinedload(User.team), selectinload(User.role))
        .outerjoin(Team)
    )

    unassigned_label = "Action Required"

    if q:
        document = searchable_text(User.first_name, User.last_name, User.email)
        query, rank = apply_trigram_search(query, search=q, document=document)
    else:
        rank = None

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

    attention_sort = case(
        (
            (User.is_active == UserStatus.pending)
            & (User.role_id.is_(None))
            & (User.team_id.is_(None)),
            0,
        ),
        else_=1,
    )

    team_sort = func.coalesce(Team.name, unassigned_label)

    if sort_by == "email":
        user_sort = User.email
    elif sort_by == "role":
        query = query.outerjoin(Role)
        user_sort = Role.name
    elif sort_by == "status":
        user_sort = User.is_active
    else:
        user_sort = User.first_name

    if rank is not None:
        if sort_order == "desc":
            query = query.order_by(attention_sort.asc(), team_sort.asc(), rank.asc(), User.id.desc())
        else:
            query = query.order_by(attention_sort.asc(), team_sort.asc(), rank.desc(), User.id.asc())
    elif sort_order == "desc":
        query = query.order_by(attention_sort.asc(), team_sort.asc(), user_sort.desc(), User.id.desc())
    else:
        query = query.order_by(attention_sort.asc(), team_sort.asc(), user_sort.asc(), User.id.asc())

    total_count = query.count()
    items = query.offset(pagination.offset).limit(pagination.limit).all()
    serialized = _serialize_user_profiles(items, unassigned_label)
    return build_paged_response(serialized, total_count, pagination)


def list_user_update_options(db: Session) -> UserUpdateOptions:
    roles = db.query(Role).order_by(Role.name.asc()).all()
    teams = db.query(Team).order_by(Team.name.asc()).all()
    statuses = [s.value for s in UserStatus]
    return UserUpdateOptions(roles=roles, teams=teams, statuses=statuses)


def list_pending_users(db: Session, limit: int, offset: int) -> list[User]:
    return (
        db.query(User)
        .options(selectinload(User.team), selectinload(User.role))
        .filter(User.is_active == UserStatus.pending)
        .offset(offset)
        .limit(limit)
        .all()
    )


def update_user(db: Session, user_id: int, payload: UpdateUserRequest) -> User:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    update_data = payload.model_dump(exclude_unset=True)
    if "role_id" in update_data and update_data["role_id"] is not None:
        _get_role_or_404(db, update_data["role_id"])
    if "team_id" in update_data and update_data["team_id"] is not None:
        _get_team_or_404(db, update_data["team_id"])

    for field, value in update_data.items():
        setattr(user, field, value)

    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def approve_user(db: Session, user_id: int, payload: ApproveUserRequest) -> dict[str, str]:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    _get_role_or_404(db, payload.role_id)
    _get_team_or_404(db, payload.team_id)

    user.role_id = payload.role_id
    user.team_id = payload.team_id
    user.is_active = UserStatus.active

    db.commit()
    return {"message": "User approved successfully"}


def reject_pending_user(db: Session, user_id: int) -> dict[str, str]:
    user = db.query(User).filter(User.id == user_id).first()
    if not user or user.is_active != UserStatus.pending:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pending user not found",
        )

    db.delete(user)
    db.commit()
    return {"message": "Pending user rejected and removed"}


def _serialize_user_profiles(users: list[User], unassigned_label: str):
    serialized = []
    for user in users:
        profile = UserProfile.model_validate(user)
        if not profile.team_name:
            profile.team_name = unassigned_label
        if not profile.role_name:
            profile.role_name = "Unassigned"
        serialized.append(profile)

    return serialized


def _get_role_or_404(db: Session, role_id: int) -> Role:
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
    return role


def _get_team_or_404(db: Session, team_id: int) -> Team:
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    return team
