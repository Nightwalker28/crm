import re

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.duplicates import DuplicateMode
from app.modules.user_management.models import (
    Department,
    DepartmentModulePermission,
    Module,
    Team,
    TeamModulePermission,
    TenantModuleConfig,
    TenantSidebarTab,
)
from app.modules.user_management.schema import (
    ModuleAccessDepartmentOption,
    ModuleAccessSchema,
    ModuleAccessTeamOption,
    ModuleAccessUpdateRequest,
    ModuleSchema,
    ModuleUpdateRequest,
    SidebarTabCreateRequest,
    SidebarTabSchema,
    SidebarTabUpdateRequest,
)

TAB_KEY_RE = re.compile(r"[^a-z0-9_]+")

SYSTEM_SIDEBAR_TABS: tuple[dict[str, object], ...] = (
    {"key": "sales", "label": "Sales", "sort_order": 10},
    {"key": "finance", "label": "Finance", "sort_order": 20},
    {"key": "catalog", "label": "Products & Services", "sort_order": 30},
    {"key": "settings", "label": "Settings", "sort_order": 90},
    {"key": "other", "label": "Other", "sort_order": 100},
)
SYSTEM_TAB_LABELS = {str(tab["key"]): str(tab["label"]) for tab in SYSTEM_SIDEBAR_TABS}
HIDDEN_SIDEBAR_TAB_KEY = "none"
DEFAULT_HIDDEN_SIDEBAR_MODULES = {"mail", "tasks", "documents"}


def normalize_sidebar_tab_key(value: str | None, *, fallback: str = "other") -> str:
    raw = (value or fallback).strip().lower().replace("-", "_")
    key = TAB_KEY_RE.sub("_", raw).strip("_")
    return (key or fallback)[:100]


def default_sidebar_tab_key(module_name: str) -> str:
    if module_name in DEFAULT_HIDDEN_SIDEBAR_MODULES:
        return HIDDEN_SIDEBAR_TAB_KEY
    if module_name.startswith("sales_"):
        return "sales"
    if module_name.startswith("finance_"):
        return "finance"
    if module_name.startswith("catalog_"):
        return "catalog"
    if module_name.startswith("custom_"):
        return "other"
    return "other"


def _get_tenant_module_config(
    db: Session,
    *,
    tenant_id: int,
    module_id: int,
) -> TenantModuleConfig | None:
    return (
        db.query(TenantModuleConfig)
        .filter(
            TenantModuleConfig.tenant_id == tenant_id,
            TenantModuleConfig.module_id == module_id,
        )
        .first()
    )


def _custom_tab_labels(db: Session, *, tenant_id: int) -> dict[str, str]:
    return {
        tab.key: tab.label
        for tab in db.query(TenantSidebarTab).filter(TenantSidebarTab.tenant_id == tenant_id).all()
    }


def _sidebar_tab_label(tab_key: str | None, custom_tab_labels: dict[str, str] | None = None) -> str | None:
    if not tab_key:
        return None
    if tab_key == HIDDEN_SIDEBAR_TAB_KEY:
        return "None"
    custom_tab_labels = custom_tab_labels or {}
    return custom_tab_labels.get(tab_key) or SYSTEM_TAB_LABELS.get(tab_key) or tab_key.replace("_", " ").title()


def build_module_schema(
    module: Module,
    config: TenantModuleConfig | None,
    *,
    custom_tab_labels: dict[str, str] | None = None,
) -> ModuleSchema:
    sidebar_tab_key = (
        normalize_sidebar_tab_key(config.sidebar_tab_key)
        if config and config.sidebar_tab_key
        else default_sidebar_tab_key(module.name)
    )
    return ModuleSchema.model_validate(
        {
            "id": module.id,
            "name": module.name,
            "base_route": module.base_route,
            "description": module.description,
            "is_enabled": bool(config.is_enabled) if config else bool(module.is_enabled),
            "import_duplicate_mode": (
                (config.import_duplicate_mode or DuplicateMode.skip.value)
                if config
                else (module.import_duplicate_mode or DuplicateMode.skip.value)
            ),
            "sidebar_tab_key": sidebar_tab_key,
            "sidebar_tab_label": _sidebar_tab_label(sidebar_tab_key, custom_tab_labels),
            "display_name": config.display_name if config and config.display_name else None,
            "created_at": module.created_at,
        }
    )


def list_modules(db: Session, *, tenant_id: int) -> list[ModuleSchema]:
    modules = db.query(Module).order_by(Module.name.asc()).all()
    configs = (
        db.query(TenantModuleConfig)
        .filter(TenantModuleConfig.tenant_id == tenant_id)
        .all()
    )
    config_map = {config.module_id: config for config in configs}
    custom_tab_labels = _custom_tab_labels(db, tenant_id=tenant_id)
    return [
        build_module_schema(module, config_map.get(module.id), custom_tab_labels=custom_tab_labels)
        for module in modules
        if _module_belongs_to_tenant_or_global(db, module=module, tenant_id=tenant_id)
    ]


def update_module(db: Session, module_id: int, payload: ModuleUpdateRequest, *, tenant_id: int) -> ModuleSchema:
    module = db.query(Module).filter(Module.id == module_id).first()
    if not module or not _module_belongs_to_tenant_or_global(db, module=module, tenant_id=tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Module not found")

    update_data = payload.model_dump(exclude_unset=True)
    if "name" in update_data and update_data["name"]:
        duplicate = (
            db.query(Module)
            .filter(Module.name == update_data["name"].strip(), Module.id != module_id)
            .first()
        )
        if duplicate:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Module name already exists")

    config = _get_tenant_module_config(db, tenant_id=tenant_id, module_id=module.id)
    config_touched = False
    for field, value in update_data.items():
        if field == "import_duplicate_mode" and value is not None:
            try:
                value = DuplicateMode(value).value
            except ValueError as exc:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid duplicate mode") from exc
        if isinstance(value, str):
            value = value.strip() or None
        if field in {"is_enabled", "import_duplicate_mode", "sidebar_tab_key", "display_name"}:
            if config is None:
                config = TenantModuleConfig(
                    tenant_id=tenant_id,
                    module_id=module.id,
                    is_enabled=module.is_enabled,
                    import_duplicate_mode=module.import_duplicate_mode or DuplicateMode.skip.value,
                )
            if field == "is_enabled" and value is not None:
                value = 1 if value else 0
            if field == "sidebar_tab_key" and value is not None:
                value = normalize_sidebar_tab_key(value)
                _ensure_sidebar_tab_exists(db, tenant_id=tenant_id, tab_key=value)
            setattr(config, field, value)
            config_touched = True
        else:
            setattr(module, field, value)

    db.add(module)
    if config_touched and config is not None:
        db.add(config)
    db.commit()
    db.refresh(module)
    if config_touched and config is not None:
        db.refresh(config)
    return build_module_schema(module, config, custom_tab_labels=_custom_tab_labels(db, tenant_id=tenant_id))


def list_sidebar_tabs(db: Session, *, tenant_id: int) -> list[SidebarTabSchema]:
    custom_tabs = (
        db.query(TenantSidebarTab)
        .filter(TenantSidebarTab.tenant_id == tenant_id)
        .order_by(TenantSidebarTab.sort_order.asc(), TenantSidebarTab.label.asc())
        .all()
    )
    system = [
        SidebarTabSchema(id=None, key=str(tab["key"]), label=str(tab["label"]), sort_order=int(tab["sort_order"]), is_system=True)
        for tab in SYSTEM_SIDEBAR_TABS
    ]
    custom = [SidebarTabSchema.model_validate({**tab.__dict__, "is_system": False}) for tab in custom_tabs]
    return sorted(system + custom, key=lambda tab: (tab.sort_order, tab.label.lower()))


def _ensure_sidebar_tab_exists(db: Session, *, tenant_id: int, tab_key: str) -> None:
    if tab_key == HIDDEN_SIDEBAR_TAB_KEY:
        return
    if tab_key in SYSTEM_TAB_LABELS:
        return
    exists = (
        db.query(TenantSidebarTab.id)
        .filter(TenantSidebarTab.tenant_id == tenant_id, TenantSidebarTab.key == tab_key)
        .first()
    )
    if not exists:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sidebar tab does not exist")


def create_sidebar_tab(db: Session, *, tenant_id: int, payload: SidebarTabCreateRequest) -> SidebarTabSchema:
    label = payload.label.strip()
    if not label:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tab label is required")
    key = normalize_sidebar_tab_key(payload.key or label)
    if key in SYSTEM_TAB_LABELS:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Sidebar tab key is reserved")
    tab = TenantSidebarTab(
        tenant_id=tenant_id,
        key=key,
        label=label,
        sort_order=payload.sort_order if payload.sort_order is not None else 80,
    )
    db.add(tab)
    try:
        db.commit()
        db.refresh(tab)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Sidebar tab already exists") from exc
    return SidebarTabSchema.model_validate({**tab.__dict__, "is_system": False})


def update_sidebar_tab(db: Session, *, tenant_id: int, tab_key: str, payload: SidebarTabUpdateRequest) -> SidebarTabSchema:
    key = normalize_sidebar_tab_key(tab_key)
    if key in SYSTEM_TAB_LABELS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="System sidebar tabs cannot be renamed")
    tab = (
        db.query(TenantSidebarTab)
        .filter(TenantSidebarTab.tenant_id == tenant_id, TenantSidebarTab.key == key)
        .first()
    )
    if not tab:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sidebar tab not found")
    data = payload.model_dump(exclude_unset=True)
    if "label" in data and data["label"] is not None:
        label = data["label"].strip()
        if not label:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tab label is required")
        tab.label = label
    if "sort_order" in data and data["sort_order"] is not None:
        tab.sort_order = data["sort_order"]
    db.add(tab)
    db.commit()
    db.refresh(tab)
    return SidebarTabSchema.model_validate({**tab.__dict__, "is_system": False})


def get_module_access(db: Session, module_id: int, *, tenant_id: int) -> ModuleAccessSchema:
    module = db.query(Module).filter(Module.id == module_id).first()
    if not module or not _module_belongs_to_tenant_or_global(db, module=module, tenant_id=tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Module not found")

    department_ids = {
        department_id
        for (department_id,) in (
            db.query(DepartmentModulePermission.department_id)
            .join(Department, Department.id == DepartmentModulePermission.department_id)
            .filter(
                Department.tenant_id == tenant_id,
                DepartmentModulePermission.module_id == module.id,
            )
            .all()
        )
    }
    team_ids = {
        team_id
        for (team_id,) in (
            db.query(TeamModulePermission.team_id)
            .join(Team, Team.id == TeamModulePermission.team_id)
            .filter(
                Team.tenant_id == tenant_id,
                TeamModulePermission.module_id == module.id,
            )
            .all()
        )
    }

    departments = db.query(Department).filter(Department.tenant_id == tenant_id).order_by(Department.name.asc()).all()
    teams = db.query(Team).filter(Team.tenant_id == tenant_id).order_by(Team.name.asc()).all()
    department_name_by_id = {department.id: department.name for department in departments}
    config = _get_tenant_module_config(db, tenant_id=tenant_id, module_id=module.id)

    return ModuleAccessSchema(
        module=build_module_schema(module, config),
        departments=[
            ModuleAccessDepartmentOption(
                id=department.id,
                name=department.name,
                description=department.description,
                has_access=department.id in department_ids,
            )
            for department in departments
        ],
        teams=[
            ModuleAccessTeamOption(
                id=team.id,
                name=team.name,
                description=team.description,
                department_id=team.department_id,
                department_name=department_name_by_id.get(team.department_id),
                has_access=team.id in team_ids,
            )
            for team in teams
        ],
    )


def update_module_access(
    db: Session,
    module_id: int,
    payload: ModuleAccessUpdateRequest,
    *,
    tenant_id: int,
) -> ModuleAccessSchema:
    module = db.query(Module).filter(Module.id == module_id).first()
    if not module or not _module_belongs_to_tenant_or_global(db, module=module, tenant_id=tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Module not found")

    requested_department_ids = set(payload.department_ids)
    requested_team_ids = set(payload.team_ids)

    valid_department_ids = {
        department_id
        for (department_id,) in (
            db.query(Department.id)
            .filter(Department.tenant_id == tenant_id, Department.id.in_(requested_department_ids))
            .all()
        )
    } if requested_department_ids else set()
    valid_team_ids = {
        team_id
        for (team_id,) in (
            db.query(Team.id)
            .filter(Team.tenant_id == tenant_id, Team.id.in_(requested_team_ids))
            .all()
        )
    } if requested_team_ids else set()

    invalid_department_ids = requested_department_ids - valid_department_ids
    invalid_team_ids = requested_team_ids - valid_team_ids
    if invalid_department_ids or invalid_team_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid department or team selection")

    db.query(DepartmentModulePermission).filter(
        DepartmentModulePermission.module_id == module.id,
        DepartmentModulePermission.department_id.in_(
            db.query(Department.id).filter(Department.tenant_id == tenant_id)
        ),
    ).delete(synchronize_session=False)
    db.query(TeamModulePermission).filter(
        TeamModulePermission.module_id == module.id,
        TeamModulePermission.team_id.in_(
            db.query(Team.id).filter(Team.tenant_id == tenant_id)
        ),
    ).delete(synchronize_session=False)

    for department_id in sorted(valid_department_ids):
        db.add(DepartmentModulePermission(department_id=department_id, module_id=module.id))
    for team_id in sorted(valid_team_ids):
        db.add(TeamModulePermission(team_id=team_id, module_id=module.id))

    db.commit()
    return get_module_access(db, module_id, tenant_id=tenant_id)


def get_module_duplicate_mode(db: Session, module_name: str, *, tenant_id: int | None = None) -> str:
    module = db.query(Module).filter(Module.name == module_name).first()
    if not module:
        return DuplicateMode.skip.value
    value = module.import_duplicate_mode or DuplicateMode.skip.value
    if tenant_id is not None:
        config = _get_tenant_module_config(db, tenant_id=tenant_id, module_id=module.id)
        if config and config.import_duplicate_mode:
            value = config.import_duplicate_mode
    value = value.strip().lower()
    try:
        return DuplicateMode(value).value
    except ValueError:
        return DuplicateMode.skip.value


def is_module_enabled_for_tenant(db: Session, *, tenant_id: int, module: Module) -> bool:
    if not _module_belongs_to_tenant_or_global(db, module=module, tenant_id=tenant_id):
        return False
    config = _get_tenant_module_config(db, tenant_id=tenant_id, module_id=module.id)
    if config is not None:
        return bool(config.is_enabled)
    return bool(module.is_enabled)


def _module_belongs_to_tenant_or_global(db: Session, *, module: Module, tenant_id: int) -> bool:
    from app.modules.platform.models import CustomModuleDefinition

    custom_definition = (
        db.query(CustomModuleDefinition.tenant_id, CustomModuleDefinition.deleted_at)
        .filter(CustomModuleDefinition.module_id == module.id)
        .first()
    )
    if custom_definition is None:
        return True
    return custom_definition.tenant_id == tenant_id and custom_definition.deleted_at is None
