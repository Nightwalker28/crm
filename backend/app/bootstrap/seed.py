from __future__ import annotations

from sqlalchemy import func, text

from app.core.database import SessionLocal
from app.core.passwords import hash_password
from app.modules.user_management.models import (
    Department,
    DepartmentModulePermission,
    Module,
    Role,
    Team,
    User,
    UserAuthMode,
    UserStatus,
)


DEFAULT_ROLES = [
    {"name": "Admin", "level": 100, "description": "Full administrative access"},
    {"name": "Superuser", "level": 90, "description": "Elevated operational access"},
    {"name": "User", "level": 10, "description": "Standard user access"},
]

DEFAULT_MODULES = [
    {"name": "finance_io", "base_route": "/dashboard/finance/insertion-orders", "description": "Finance insertion orders"},
    {"name": "sales_contacts", "base_route": "/dashboard/sales/contacts", "description": "Sales contacts"},
    {"name": "sales_organizations", "base_route": "/dashboard/sales/organizations", "description": "Sales organizations"},
    {"name": "sales_opportunities", "base_route": "/dashboard/sales/opportunities", "description": "Sales opportunities"},
]

DEFAULT_DEPARTMENT = {"name": "Administration", "description": "Initial system administration department"}
DEFAULT_TEAM = {"name": "Platform Admins", "description": "Initial platform administration team"}


def _sync_pk_sequence(db, table_name: str, sequence_name: str) -> None:
    max_id = db.execute(text(f"SELECT COALESCE(MAX(id), 0) FROM {table_name}")).scalar()
    if max_id is None:
        max_id = 0
    db.execute(text("SELECT setval(:sequence_name, :value, :is_called)"), {
        "sequence_name": sequence_name,
        "value": max(max_id, 1),
        "is_called": max_id > 0,
    })


def _sync_named_pk_sequence(db, table_name: str, pk_name: str, sequence_name: str) -> None:
    max_id = db.execute(text(f"SELECT COALESCE(MAX({pk_name}), 0) FROM {table_name}")).scalar()
    if max_id is None:
        max_id = 0
    db.execute(text("SELECT setval(:sequence_name, :value, :is_called)"), {
        "sequence_name": sequence_name,
        "value": max(max_id, 1),
        "is_called": max_id > 0,
    })


def seed_initial_data(
    *,
    admin_email: str | None,
    admin_password: str | None,
    admin_first_name: str = "System",
    admin_last_name: str = "Admin",
) -> dict[str, bool]:
    if not admin_email or not admin_password:
        return {"seeded": False, "reason": "missing_admin_env"}

    admin_email = admin_email.strip().lower()

    db = SessionLocal()
    try:
        _sync_pk_sequence(db, "roles", "roles_id_seq")
        _sync_pk_sequence(db, "departments", "departments_id_seq")
        _sync_pk_sequence(db, "teams", "teams_id_seq")
        _sync_pk_sequence(db, "users", "users_id_seq")
        _sync_pk_sequence(db, "modules", "modules_id_seq")
        _sync_pk_sequence(db, "department_module_permissions", "department_module_permissions_id_seq")

        roles_by_name: dict[str, Role] = {}
        for payload in DEFAULT_ROLES:
            role = db.query(Role).filter(Role.name == payload["name"]).first()
            if not role:
                role = Role(**payload)
                db.add(role)
                db.flush()
            roles_by_name[payload["name"]] = role

        department = db.query(Department).filter(Department.name == DEFAULT_DEPARTMENT["name"]).first()
        if not department:
            department = Department(**DEFAULT_DEPARTMENT)
            db.add(department)
            db.flush()

        team = db.query(Team).filter(Team.name == DEFAULT_TEAM["name"]).first()
        if not team:
            team = Team(department_id=department.id, **DEFAULT_TEAM)
            db.add(team)
            db.flush()
        elif team.department_id != department.id:
            team.department_id = department.id

        module_ids: list[int] = []
        for payload in DEFAULT_MODULES:
            module = db.query(Module).filter(Module.name == payload["name"]).first()
            if not module:
                module = Module(**payload)
                db.add(module)
                db.flush()
            else:
                module.base_route = payload["base_route"]
                module.description = payload["description"]
            module_ids.append(module.id)

        for module_id in module_ids:
            permission = (
                db.query(DepartmentModulePermission)
                .filter(
                    DepartmentModulePermission.department_id == department.id,
                    DepartmentModulePermission.module_id == module_id,
                )
                .first()
            )
            if not permission:
                db.add(
                    DepartmentModulePermission(
                        department_id=department.id,
                        module_id=module_id,
                    )
                )

        admin_role = roles_by_name["Admin"]
        admin_user = db.query(User).filter(func.lower(User.email) == admin_email).first()
        if not admin_user:
            admin_user = User(
                email=admin_email,
                first_name=admin_first_name.strip() or None,
                last_name=admin_last_name.strip() or None,
                password_hash=hash_password(admin_password),
                role_id=admin_role.id,
                team_id=team.id,
                auth_mode=UserAuthMode.manual_or_google,
                is_active=UserStatus.active,
            )
            db.add(admin_user)
        else:
            if not admin_user.password_hash:
                admin_user.password_hash = hash_password(admin_password)
            admin_user.role_id = admin_role.id
            admin_user.team_id = team.id
            admin_user.auth_mode = UserAuthMode.manual_or_google
            admin_user.is_active = UserStatus.active
            if not admin_user.first_name:
                admin_user.first_name = admin_first_name.strip() or None
            if not admin_user.last_name:
                admin_user.last_name = admin_last_name.strip() or None

        db.commit()
        return {"seeded": True, "reason": "ok"}
    finally:
        db.close()
