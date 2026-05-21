from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.modules.platform.models import ModuleFieldConfig
from app.modules.platform.services.module_fields import is_protected_module_field
from app.modules.platform.system_modules import SYSTEM_MODULES, iter_system_modules
from app.modules.user_management.models import (
    Department,
    DepartmentModulePermission,
    Module,
    Role,
    RoleModulePermission,
    Team,
    TeamModulePermission,
    Tenant,
    TenantModuleConfig,
)


ROLE_ACTION_TEMPLATES = {
    "Admin": {"can_view": 1, "can_create": 1, "can_edit": 1, "can_delete": 1, "can_restore": 1, "can_export": 1, "can_configure": 1},
    "Superuser": {"can_view": 1, "can_create": 1, "can_edit": 1, "can_delete": 1, "can_restore": 1, "can_export": 1, "can_configure": 0},
    "User": {"can_view": 1, "can_create": 1, "can_edit": 1, "can_delete": 0, "can_restore": 0, "can_export": 0, "can_configure": 0},
}


@dataclass(frozen=True)
class SystemModuleSyncResult:
    modules_upserted: int
    tenant_configs_upserted: int
    field_configs_upserted: int
    access_permissions_created: int


def _tenant_ids(db: Session, tenant_id: int | None = None) -> list[int]:
    query = db.query(Tenant.id)
    if tenant_id is not None:
        query = query.filter(Tenant.id == tenant_id)
    return [int(row[0]) for row in query.order_by(Tenant.id.asc()).all()]


def sync_system_modules(db: Session, *, tenant_id: int | None = None, commit: bool = True) -> SystemModuleSyncResult:
    modules_upserted = 0
    tenant_configs_upserted = 0
    field_configs_upserted = 0
    access_permissions_created = 0
    tenants = _tenant_ids(db, tenant_id=tenant_id)

    module_by_key: dict[str, Module] = {}
    for module_key, definition in iter_system_modules():
        module = db.query(Module).filter(Module.name == module_key).first()
        if module is None:
            module = Module(
                name=module_key,
                base_route=definition.get("base_route"),
                description=definition.get("description"),
                is_enabled=1,
            )
            db.add(module)
            db.flush()
        else:
            module.base_route = definition.get("base_route")
            module.description = definition.get("description")
        module_by_key[module_key] = module
        modules_upserted += 1

    for current_tenant_id in tenants:
        for module_key, definition in SYSTEM_MODULES.items():
            module = module_by_key[module_key]
            config = (
                db.query(TenantModuleConfig)
                .filter(
                    TenantModuleConfig.tenant_id == current_tenant_id,
                    TenantModuleConfig.module_id == module.id,
                )
                .first()
            )
            if config is None:
                config = TenantModuleConfig(
                    tenant_id=current_tenant_id,
                    module_id=module.id,
                    is_enabled=1,
                    import_duplicate_mode=module.import_duplicate_mode or "skip",
                    sidebar_tab_key=str(definition.get("sidebar_tab_key") or "other"),
                    display_name=str(definition.get("display_name") or ""),
                )
            else:
                if not config.sidebar_tab_key:
                    config.sidebar_tab_key = str(definition.get("sidebar_tab_key") or "other")
                if not config.display_name:
                    config.display_name = str(definition.get("display_name") or "")
                if not config.import_duplicate_mode:
                    config.import_duplicate_mode = module.import_duplicate_mode or "skip"
            db.add(config)
            tenant_configs_upserted += 1

            for field_definition in definition.get("fields") or []:
                field_key = str(field_definition["field_key"])
                protected = bool(field_definition.get("is_protected")) or is_protected_module_field(field_key, module_key)
                field_config = (
                    db.query(ModuleFieldConfig)
                    .filter(
                        ModuleFieldConfig.tenant_id == current_tenant_id,
                        ModuleFieldConfig.module_key == module_key,
                        ModuleFieldConfig.field_key == field_key,
                    )
                    .first()
                )
                if field_config is None:
                    field_config = ModuleFieldConfig(
                        tenant_id=current_tenant_id,
                        module_key=module_key,
                        field_key=field_key,
                        label=str(field_definition["label"]),
                        field_type=field_definition.get("field_type"),
                        field_source=str(field_definition.get("field_source") or "system"),
                        is_enabled=bool(field_definition.get("is_enabled", True)) or protected,
                        is_protected=protected,
                        sort_order=int(field_definition.get("sort_order") or 0),
                    )
                else:
                    field_config.field_type = field_definition.get("field_type")
                    field_config.field_source = str(field_definition.get("field_source") or field_config.field_source or "system")
                    field_config.is_protected = protected
                    if protected:
                        field_config.is_enabled = True
                    if not field_config.label:
                        field_config.label = str(field_definition["label"])
                    if field_config.sort_order is None:
                        field_config.sort_order = int(field_definition.get("sort_order") or 0)
                db.add(field_config)
                field_configs_upserted += 1

        departments = db.query(Department).filter(Department.tenant_id == current_tenant_id).all()
        teams = db.query(Team).filter(Team.tenant_id == current_tenant_id).all()
        roles = db.query(Role).filter(Role.tenant_id == current_tenant_id).all()
        for module in module_by_key.values():
            for department in departments:
                exists = (
                    db.query(DepartmentModulePermission.id)
                    .filter(
                        DepartmentModulePermission.department_id == department.id,
                        DepartmentModulePermission.module_id == module.id,
                    )
                    .first()
                )
                if not exists:
                    db.add(DepartmentModulePermission(department_id=department.id, module_id=module.id))
                    access_permissions_created += 1
            for team in teams:
                exists = (
                    db.query(TeamModulePermission.id)
                    .filter(
                        TeamModulePermission.team_id == team.id,
                        TeamModulePermission.module_id == module.id,
                    )
                    .first()
                )
                if not exists:
                    db.add(TeamModulePermission(team_id=team.id, module_id=module.id))
                    access_permissions_created += 1
            for role in roles:
                permission = (
                    db.query(RoleModulePermission)
                    .filter(
                        RoleModulePermission.role_id == role.id,
                        RoleModulePermission.module_id == module.id,
                    )
                    .first()
                )
                if permission is not None:
                    continue
                template = ROLE_ACTION_TEMPLATES.get(role.name, ROLE_ACTION_TEMPLATES["User"])
                db.add(RoleModulePermission(role_id=role.id, module_id=module.id, **template))
                access_permissions_created += 1

    if commit:
        db.commit()
    return SystemModuleSyncResult(
        modules_upserted=modules_upserted,
        tenant_configs_upserted=tenant_configs_upserted,
        field_configs_upserted=field_configs_upserted,
        access_permissions_created=access_permissions_created,
    )
