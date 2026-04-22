from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.duplicates import DuplicateMode
from app.modules.user_management.models import Module, TenantModuleConfig
from app.modules.user_management.schema import ModuleSchema, ModuleUpdateRequest


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


def build_module_schema(module: Module, config: TenantModuleConfig | None) -> ModuleSchema:
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
    return [build_module_schema(module, config_map.get(module.id)) for module in modules]


def update_module(db: Session, module_id: int, payload: ModuleUpdateRequest, *, tenant_id: int) -> ModuleSchema:
    module = db.query(Module).filter(Module.id == module_id).first()
    if not module:
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
        if field in {"is_enabled", "import_duplicate_mode"}:
            if config is None:
                config = TenantModuleConfig(
                    tenant_id=tenant_id,
                    module_id=module.id,
                    is_enabled=module.is_enabled,
                    import_duplicate_mode=module.import_duplicate_mode or DuplicateMode.skip.value,
                )
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
    return build_module_schema(module, config)


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
    config = _get_tenant_module_config(db, tenant_id=tenant_id, module_id=module.id)
    if config is not None:
        return bool(config.is_enabled)
    return bool(module.is_enabled)
