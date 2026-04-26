from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.modules.user_management.models import (
    DepartmentModulePermission,
    Module,
    Role,
    RoleModulePermission,
    Team,
    TeamModulePermission,
    User,
)
from app.modules.user_management.services.admin_modules import is_module_enabled_for_tenant


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

    query = db.query(Team.department_id).filter(Team.id == user.team_id)
    tenant_id = getattr(user, "tenant_id", None)
    if tenant_id is not None:
        query = query.filter(Team.tenant_id == tenant_id)
    return query.scalar()


def get_user_team_id(user: User | None) -> int | None:
    if not user:
        return None
    return getattr(user, "team_id", None)


def _get_module_or_404(db: Session, module_key: str) -> Module:
    module = (
        db.query(Module)
        .filter(or_(Module.name == module_key, Module.base_route == module_key))
        .first()
    )
    if not module:
        raise ValueError("module not found")
    return module


def user_has_module_assignment(
    db: Session,
    *,
    user: User,
    module: Module,
) -> bool:
    role_level = get_user_role_level(db, user)
    if role_level is not None and role_level >= ADMIN_MIN_ROLE_LEVEL:
        return is_module_enabled_for_tenant(db, tenant_id=user.tenant_id, module=module)

    role_id = getattr(user, "role_id", None)
    if not role_id:
        return False

    role_permission = (
        db.query(RoleModulePermission)
        .filter(
            RoleModulePermission.role_id == role_id,
            RoleModulePermission.module_id == module.id,
        )
        .first()
    )
    if not bool(role_permission and role_permission.can_view):
        return False

    team_id = get_user_team_id(user)
    department_id = get_user_department_id(db, user)
    if not team_id and not department_id:
        return False

    if team_id:
        team_permission = (
            db.query(TeamModulePermission)
            .join(Team, Team.id == TeamModulePermission.team_id)
            .filter(
                Team.tenant_id == user.tenant_id,
                TeamModulePermission.team_id == team_id,
                TeamModulePermission.module_id == module.id,
            )
            .first()
        )
        if team_permission:
            return True

    if department_id:
        department_permission = (
            db.query(DepartmentModulePermission)
            .filter(
                DepartmentModulePermission.department_id == department_id,
                DepartmentModulePermission.module_id == module.id,
            )
            .first()
        )
        if department_permission:
            return True

    return False


def require_department_module_access(
    db: Session,
    *,
    user: User,
    module_key: str,
) -> None:
    module = _get_module_or_404(db, module_key)
    if not is_module_enabled_for_tenant(db, tenant_id=user.tenant_id, module=module):
        raise PermissionError("This module is disabled")
    if not user_has_module_assignment(db, user=user, module=module):
        raise PermissionError("Access to this module is forbidden")


def require_role_module_action_access(
    db: Session,
    *,
    user: User,
    module_key: str,
    action: str,
) -> None:
    module = _get_module_or_404(db, module_key)

    role_level = get_user_role_level(db, user)
    if role_level is not None and role_level >= ADMIN_MIN_ROLE_LEVEL:
        if not is_module_enabled_for_tenant(db, tenant_id=user.tenant_id, module=module):
            raise PermissionError("This module is disabled")
        return

    require_department_module_access(db, user=user, module_key=module_key)

    if not user.role_id:
        raise PermissionError("User is not assigned to a role")

    permission = (
        db.query(RoleModulePermission)
        .filter(
            RoleModulePermission.role_id == user.role_id,
            RoleModulePermission.module_id == module.id,
        )
        .first()
    )
    if not permission:
        raise PermissionError("Action is not allowed for this role")

    field_map = {
        "view": "can_view",
        "create": "can_create",
        "edit": "can_edit",
        "delete": "can_delete",
        "restore": "can_restore",
        "export": "can_export",
        "configure": "can_configure",
    }
    attr = field_map.get(action)
    if not attr:
        raise ValueError("unknown action")

    if not bool(getattr(permission, attr)):
        raise PermissionError("Action is not allowed for this role")


def get_finance_user_scope(db: Session, user: User | None) -> UserDepartmentScope:
    role_level = get_user_role_level(db, user)
    if role_level is not None and role_level >= ADMIN_MIN_ROLE_LEVEL:
        return UserDepartmentScope(department_id=get_user_department_id(db, user), user_id_filter=None)

    department_id = get_user_department_id(db, user)
    if department_id == FINANCE_FULL_ACCESS_DEPARTMENT_ID:
        return UserDepartmentScope(department_id=department_id, user_id_filter=None)

    return UserDepartmentScope(
        department_id=department_id,
        user_id_filter=user.id if user else None,
    )


def get_user_role_level(db: Session, user: User | None) -> int | None:
    role_id = getattr(user, "role_id", None)
    if not user or not role_id:
        return None

    return (
        db.query(Role.level)
        .filter(Role.id == role_id, Role.tenant_id == user.tenant_id)
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
