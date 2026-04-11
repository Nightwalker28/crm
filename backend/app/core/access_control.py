from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.modules.user_management.models import (
    DepartmentModulePermission,
    Module,
    Role,
    Team,
    User,
)


@dataclass(frozen=True)
class UserDepartmentScope:
    department_id: int | None
    user_id_filter: int | None


FINANCE_FULL_ACCESS_DEPARTMENT_ID = 2
USER_MIN_ROLE_LEVEL = 10
SUPERUSER_MIN_ROLE_LEVEL = 90
ADMIN_MIN_ROLE_LEVEL = 100


def get_user_department_id(db: Session, user: User | None) -> int | None:
    if not user or not getattr(user, "team_id", None):
        return None

    return (
        db.query(Team.department_id)
        .filter(Team.id == user.team_id)
        .scalar()
    )


def require_department_module_access(
    db: Session,
    *,
    user: User,
    module_key: str,
) -> None:
    module = (
        db.query(Module)
        .filter(or_(Module.name == module_key, Module.base_route == module_key))
        .first()
    )
    if not module:
        raise ValueError("module not found")

    department_id = get_user_department_id(db, user)
    if not department_id:
        raise PermissionError("User is not assigned to a department")

    allowed = (
        db.query(DepartmentModulePermission)
        .filter_by(department_id=department_id, module_id=module.id)
        .first()
    )
    if not allowed:
        raise PermissionError("Access to this module is forbidden")


def get_finance_user_scope(db: Session, user: User | None) -> UserDepartmentScope:
    department_id = get_user_department_id(db, user)
    if department_id == FINANCE_FULL_ACCESS_DEPARTMENT_ID:
        return UserDepartmentScope(department_id=department_id, user_id_filter=None)

    return UserDepartmentScope(
        department_id=department_id,
        user_id_filter=user.id if user else None,
    )


def get_user_role_level(db: Session, user: User | None) -> int | None:
    if not user or not user.role_id:
        return None

    return (
        db.query(Role.level)
        .filter(Role.id == user.role_id)
        .scalar()
    )


def require_minimum_role_level(
    db: Session,
    *,
    user: User,
    minimum_level: int,
) -> None:
    role_level = get_user_role_level(db, user)
    if role_level is None or role_level < minimum_level:
        raise PermissionError("insufficient_role_level")
