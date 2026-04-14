from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.modules.user_management.models import Module, Role, RoleModulePermission
from app.modules.user_management.schema import (
    ModulePermissionSchema,
    RoleCreateRequest,
    RolePermissionActions,
    RolePermissionOverviewResponse,
    RolePermissionUpdateRequest,
    RoleSchema,
    RoleTemplateSummary,
    RoleUpdateRequest,
)


ROLE_TEMPLATES: dict[str, dict] = {
    "admin": {
        "label": "Admin",
        "description": "Full administrative access across every enabled module.",
        "level": 100,
        "actions": RolePermissionActions(
            can_view=True,
            can_create=True,
            can_edit=True,
            can_delete=True,
            can_restore=True,
            can_export=True,
            can_configure=True,
        ),
    },
    "superuser": {
        "label": "Superuser",
        "description": "Operational access across modules without full configuration control.",
        "level": 90,
        "actions": RolePermissionActions(
            can_view=True,
            can_create=True,
            can_edit=True,
            can_delete=True,
            can_restore=True,
            can_export=True,
            can_configure=False,
        ),
    },
    "user": {
        "label": "User",
        "description": "Standard working access with no destructive or configuration actions by default.",
        "level": 10,
        "actions": RolePermissionActions(
            can_view=True,
            can_create=True,
            can_edit=True,
            can_delete=False,
            can_restore=False,
            can_export=False,
            can_configure=False,
        ),
    },
}


def list_role_permission_overview(db: Session) -> RolePermissionOverviewResponse:
    roles = db.query(Role).order_by(Role.level.desc(), Role.name.asc()).all()
    modules = db.query(Module).order_by(Module.name.asc()).all()

    return RolePermissionOverviewResponse(
        roles=[RoleSchema.model_validate(role) for role in roles],
        templates=[
            RoleTemplateSummary(
                key=key,
                label=value["label"],
                description=value["description"],
            )
            for key, value in ROLE_TEMPLATES.items()
        ],
        modules=[
            ModulePermissionSchema(
                module_id=module.id,
                module_name=module.name,
                module_description=module.description,
                actions=RolePermissionActions(),
            )
            for module in modules
        ],
    )


def get_role_permissions(db: Session, role_id: int) -> list[ModulePermissionSchema]:
    role = _get_role_or_404(db, role_id)
    modules = db.query(Module).order_by(Module.name.asc()).all()
    permissions = {
        permission.module_id: permission
        for permission in db.query(RoleModulePermission)
        .filter(RoleModulePermission.role_id == role.id)
        .all()
    }

    return [
        ModulePermissionSchema(
            module_id=module.id,
            module_name=module.name,
            module_description=module.description,
            actions=RolePermissionActions(
                can_view=bool(permission.can_view) if permission else True,
                can_create=bool(permission.can_create) if permission else False,
                can_edit=bool(permission.can_edit) if permission else False,
                can_delete=bool(permission.can_delete) if permission else False,
                can_restore=bool(permission.can_restore) if permission else False,
                can_export=bool(permission.can_export) if permission else False,
                can_configure=bool(permission.can_configure) if permission else False,
            ),
        )
        for module in modules
        for permission in [permissions.get(module.id)]
    ]


def create_role(db: Session, payload: RoleCreateRequest) -> Role:
    template = ROLE_TEMPLATES.get(payload.template_key)
    if not template:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown role template")

    existing = db.query(Role).filter(Role.name == payload.name.strip()).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Role already exists")

    role = Role(
        name=payload.name.strip(),
        description=payload.description.strip() if payload.description else template["description"],
        level=payload.level if payload.level is not None else template["level"],
    )
    db.add(role)
    db.flush()

    modules = db.query(Module).all()
    template_actions: RolePermissionActions = template["actions"]
    for module in modules:
        db.add(
            RoleModulePermission(
                role_id=role.id,
                module_id=module.id,
                can_view=1 if template_actions.can_view else 0,
                can_create=1 if template_actions.can_create else 0,
                can_edit=1 if template_actions.can_edit else 0,
                can_delete=1 if template_actions.can_delete else 0,
                can_restore=1 if template_actions.can_restore else 0,
                can_export=1 if template_actions.can_export else 0,
                can_configure=1 if template_actions.can_configure else 0,
            )
        )

    db.commit()
    db.refresh(role)
    return role


def update_role(db: Session, role_id: int, payload: RoleUpdateRequest) -> Role:
    role = _get_role_or_404(db, role_id)
    update_data = payload.model_dump(exclude_unset=True)

    if "name" in update_data and update_data["name"]:
        duplicate = (
            db.query(Role)
            .filter(Role.name == update_data["name"].strip(), Role.id != role.id)
            .first()
        )
        if duplicate:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Role name already exists")

    for field, value in update_data.items():
        setattr(role, field, value.strip() if isinstance(value, str) else value)

    db.add(role)
    db.commit()
    db.refresh(role)
    return role


def update_role_permissions(db: Session, role_id: int, payload: RolePermissionUpdateRequest) -> list[ModulePermissionSchema]:
    role = _get_role_or_404(db, role_id)
    modules = {module.id: module for module in db.query(Module).all()}

    for item in payload.permissions:
        module = modules.get(item.module_id)
        if not module:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Module {item.module_id} not found")

        permission = (
            db.query(RoleModulePermission)
            .filter(
                RoleModulePermission.role_id == role.id,
                RoleModulePermission.module_id == item.module_id,
            )
            .first()
        )
        if not permission:
            permission = RoleModulePermission(role_id=role.id, module_id=item.module_id)

        permission.can_view = 1 if item.actions.can_view else 0
        permission.can_create = 1 if item.actions.can_create else 0
        permission.can_edit = 1 if item.actions.can_edit else 0
        permission.can_delete = 1 if item.actions.can_delete else 0
        permission.can_restore = 1 if item.actions.can_restore else 0
        permission.can_export = 1 if item.actions.can_export else 0
        permission.can_configure = 1 if item.actions.can_configure else 0
        db.add(permission)

    db.commit()
    return get_role_permissions(db, role_id)


def _get_role_or_404(db: Session, role_id: int) -> Role:
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
    return role
