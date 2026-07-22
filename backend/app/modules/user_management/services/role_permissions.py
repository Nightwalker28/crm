from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.modules.platform.services.activity_logs import safe_log_activity
from app.modules.user_management.models import Module, Role, RoleModulePermission, TenantModuleConfig
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
from app.modules.user_management.services.admin_modules import (
    _module_belongs_to_tenant_or_global,
    default_sidebar_tab_key,
    is_module_enabled_for_tenant,
    normalize_sidebar_tab_key,
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


def list_role_permission_overview(db: Session, *, tenant_id: int) -> RolePermissionOverviewResponse:
    roles = db.query(Role).filter(Role.tenant_id == tenant_id).order_by(Role.level.desc(), Role.name.asc()).all()
    modules = [
        module
        for module in db.query(Module).order_by(Module.name.asc()).all()
        if _module_belongs_to_tenant_or_global(db, module=module, tenant_id=tenant_id)
    ]
    product_areas = _product_areas_by_module(db, modules=modules, tenant_id=tenant_id)

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
                product_area=product_areas[module.id],
                actions=RolePermissionActions(),
            )
            for module in modules
        ],
    )


def get_role_permissions(db: Session, role_id: int, *, tenant_id: int) -> list[ModulePermissionSchema]:
    role = _get_role_or_404(db, role_id, tenant_id=tenant_id)
    modules = [
        module
        for module in db.query(Module).order_by(Module.name.asc()).all()
        if _module_belongs_to_tenant_or_global(db, module=module, tenant_id=tenant_id)
    ]
    product_areas = _product_areas_by_module(db, modules=modules, tenant_id=tenant_id)
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
            product_area=product_areas[module.id],
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


def create_role(
    db: Session,
    payload: RoleCreateRequest,
    *,
    tenant_id: int,
    actor_user_id: int,
) -> Role:
    template = ROLE_TEMPLATES.get(payload.template_key)
    if not template:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown role template")

    existing = db.query(Role).filter(Role.tenant_id == tenant_id, Role.name == payload.name.strip()).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Role already exists")

    role = Role(
        tenant_id=tenant_id,
        name=payload.name.strip(),
        description=payload.description.strip() if payload.description else template["description"],
        level=payload.level if payload.level is not None else template["level"],
    )
    db.add(role)
    db.flush()

    modules = [
        module
        for module in db.query(Module).all()
        if _module_belongs_to_tenant_or_global(db, module=module, tenant_id=tenant_id)
        and is_module_enabled_for_tenant(db, tenant_id=tenant_id, module=module)
    ]
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
    safe_log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key="security",
        entity_type="role",
        entity_id=role.id,
        action="role.created",
        description="Role created",
        after_state={
            "name": role.name,
            "level": role.level,
            "template_key": payload.template_key,
        },
    )
    return role


def update_role(
    db: Session,
    role_id: int,
    payload: RoleUpdateRequest,
    *,
    tenant_id: int,
    actor_user_id: int,
) -> Role:
    role = _get_role_or_404(db, role_id, tenant_id=tenant_id)
    before = {"name": role.name, "description": role.description, "level": role.level}
    update_data = payload.model_dump(exclude_unset=True)

    if "name" in update_data and update_data["name"]:
        duplicate = (
            db.query(Role)
            .filter(Role.tenant_id == tenant_id, Role.name == update_data["name"].strip(), Role.id != role.id)
            .first()
        )
        if duplicate:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Role name already exists")

    for field, value in update_data.items():
        setattr(role, field, value.strip() if isinstance(value, str) else value)

    db.add(role)
    db.commit()
    db.refresh(role)
    safe_log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key="security",
        entity_type="role",
        entity_id=role.id,
        action="role.updated",
        description="Role updated",
        before_state=before,
        after_state={
            "name": role.name,
            "description": role.description,
            "level": role.level,
        },
    )
    return role


def update_role_permissions(
    db: Session,
    role_id: int,
    payload: RolePermissionUpdateRequest,
    *,
    tenant_id: int,
    actor_user_id: int,
) -> list[ModulePermissionSchema]:
    role = _get_role_or_404(db, role_id, tenant_id=tenant_id)
    modules = {
        module.id: module
        for module in db.query(Module).all()
        if _module_belongs_to_tenant_or_global(db, module=module, tenant_id=tenant_id)
    }

    requested_module_ids = {item.module_id for item in payload.permissions}
    missing_module_ids = sorted(requested_module_ids.difference(modules))
    if missing_module_ids:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Module {missing_module_ids[0]} not found",
        )

    existing_permissions = {
        permission.module_id: permission
        for permission in db.query(RoleModulePermission)
        .filter(
            RoleModulePermission.role_id == role.id,
            RoleModulePermission.module_id.in_(requested_module_ids),
        )
        .all()
    }
    before_state = {
        "permissions": [
            _permission_audit_state(
                module_id=item.module_id,
                actions=(
                    RolePermissionActions(
                        can_view=bool(existing_permissions[item.module_id].can_view),
                        can_create=bool(existing_permissions[item.module_id].can_create),
                        can_edit=bool(existing_permissions[item.module_id].can_edit),
                        can_delete=bool(existing_permissions[item.module_id].can_delete),
                        can_restore=bool(existing_permissions[item.module_id].can_restore),
                        can_export=bool(existing_permissions[item.module_id].can_export),
                        can_configure=bool(existing_permissions[item.module_id].can_configure),
                    )
                    if item.module_id in existing_permissions
                    else RolePermissionActions()
                ),
            )
            for item in payload.permissions
        ]
    }

    for item in payload.permissions:
        permission = existing_permissions.get(item.module_id)
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
    updated = get_role_permissions(db, role_id, tenant_id=tenant_id)
    updated_by_module = {permission.module_id: permission for permission in updated}
    safe_log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key="security",
        entity_type="role",
        entity_id=role.id,
        action="role.permissions.updated",
        description="Role permissions updated",
        before_state=before_state,
        after_state={
            "permissions": [
                _permission_audit_state(
                    module_id=module_id,
                    actions=updated_by_module[module_id].actions,
                )
                for module_id in sorted(requested_module_ids)
            ]
        },
    )
    return updated


def _permission_audit_state(
    *,
    module_id: int,
    actions: RolePermissionActions,
) -> dict:
    return {
        "module_id": module_id,
        "actions": actions.model_dump(),
    }


def _product_areas_by_module(
    db: Session,
    *,
    modules: list[Module],
    tenant_id: int,
) -> dict[int, str]:
    module_ids = {module.id for module in modules}
    configured_areas = {
        config.module_id: normalize_sidebar_tab_key(config.sidebar_tab_key)
        for config in db.query(TenantModuleConfig)
        .filter(
            TenantModuleConfig.tenant_id == tenant_id,
            TenantModuleConfig.module_id.in_(module_ids),
        )
        .all()
        if config.sidebar_tab_key
    }
    return {
        module.id: configured_areas.get(module.id, default_sidebar_tab_key(module.name))
        for module in modules
    }


def _get_role_or_404(db: Session, role_id: int, *, tenant_id: int) -> Role:
    role = db.query(Role).filter(Role.id == role_id, Role.tenant_id == tenant_id).first()
    if not role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
    return role
