from __future__ import annotations

import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import urlparse

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, object_session, selectinload

from app.core.access_control import ADMIN_MIN_ROLE_LEVEL, get_user_role_level, user_has_module_assignment
from app.core.module_csv import build_import_summary, rows_from_csv_bytes
from app.core.module_export import dict_rows_to_csv_bytes
from app.core.pagination import Pagination, build_paged_response
from app.modules.platform.custom_modules_schema import (
    CustomModuleCreate,
    CustomModuleFieldCreate,
    CustomModuleFieldUpdate,
    CustomModuleRecordRequest,
    CustomModuleRecordResponse,
    CustomModuleResponse,
    CustomModuleUpdate,
)
from app.modules.platform.models import (
    CustomModuleDefinition,
    CustomModuleFieldDefinition,
    CustomModuleRecord,
    CustomModuleRecordValue,
)
from app.modules.platform.repositories import custom_modules_repository
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.module_fields import is_protected_module_field
from app.modules.user_management.models import (
    Department,
    DepartmentModulePermission,
    Module,
    Role,
    RoleModulePermission,
    Team,
    TeamModulePermission,
    TenantModuleConfig,
    User,
)
from app.modules.user_management.services.admin_modules import is_module_enabled_for_tenant
from app.modules.user_management.services.admin_modules import (
    _custom_tab_labels,
    _ensure_sidebar_tab_exists,
    _sidebar_tab_label,
    default_sidebar_tab_key,
    normalize_sidebar_tab_key,
)
from app.modules.user_management.services.role_permissions import ROLE_TEMPLATES


KEY_RE = re.compile(r"[^a-z0-9_]+")
TEXT_TYPES = {"text", "textarea", "email", "phone", "url", "single_select"}
NUMBER_TYPES = {"number", "currency"}
DATE_TYPES = {"date", "datetime"}


def slug_key(value: str) -> str:
    key = KEY_RE.sub("_", value.strip().lower().replace("-", "_")).strip("_")
    return key[:100] or "custom_module"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _is_protected_field(field: CustomModuleFieldDefinition) -> bool:
    return is_protected_module_field(field.key)


def _serialize_field(field: CustomModuleFieldDefinition) -> dict[str, Any]:
    return {
        "id": field.id,
        "key": field.key,
        "label": field.label,
        "field_type": field.field_type,
        "help_text": field.help_text,
        "placeholder": field.placeholder,
        "is_required": bool(field.is_required),
        "is_unique": bool(field.is_unique),
        "display_in_list": bool(field.display_in_list),
        "default_value": field.default_value,
        "validation_json": field.validation_json,
        "sort_order": field.sort_order or 0,
        "is_active": bool(field.is_active),
        "is_protected": _is_protected_field(field),
        "created_at": field.created_at,
        "updated_at": field.updated_at,
    }


def _serialize_module(module: CustomModuleDefinition) -> CustomModuleResponse:
    fields = sorted(
        [field for field in module.fields if field.deleted_at is None],
        key=lambda field: (field.sort_order, field.id),
    )
    tenant_config = None
    if module.module:
        tenant_config = next(
            (config for config in module.module.tenant_configs if config.tenant_id == module.tenant_id),
            None,
        )
    sidebar_tab_key = (
        normalize_sidebar_tab_key(tenant_config.sidebar_tab_key)
        if tenant_config and tenant_config.sidebar_tab_key
        else default_sidebar_tab_key(module.module.name if module.module else module.key)
    )
    session = object_session(module)
    custom_tab_labels = _custom_tab_labels(session, tenant_id=module.tenant_id) if session else {}
    return CustomModuleResponse.model_validate(
        {
            "id": module.id,
            "name": module.name,
            "key": module.key,
            "description": module.description,
            "icon": module.icon,
            "is_active": bool(module.is_active),
            "module_id": module.module_id,
            "base_route": module.module.base_route if module.module else None,
            "sidebar_tab_key": sidebar_tab_key,
            "sidebar_tab_label": _sidebar_tab_label(sidebar_tab_key, custom_tab_labels),
            "display_name": tenant_config.display_name if tenant_config and tenant_config.display_name else None,
            "created_at": module.created_at,
            "updated_at": module.updated_at,
            "deleted_at": module.deleted_at,
            "fields": [_serialize_field(field) for field in fields],
        }
    )


def _get_module_definition(
    db: Session,
    *,
    tenant_id: int,
    module_id: int | None = None,
    key: str | None = None,
    include_deleted: bool = False,
) -> CustomModuleDefinition:
    query = (
        db.query(CustomModuleDefinition)
        .options(selectinload(CustomModuleDefinition.fields), selectinload(CustomModuleDefinition.module))
        .filter(CustomModuleDefinition.tenant_id == tenant_id)
    )
    if module_id is not None:
        query = query.filter(CustomModuleDefinition.id == module_id)
    if key is not None:
        query = query.filter(CustomModuleDefinition.key == key)
    if not include_deleted:
        query = query.filter(CustomModuleDefinition.deleted_at.is_(None))
    module = query.first()
    if not module:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Custom module not found")
    return module


def _require_module_action(db: Session, *, user: User, definition: CustomModuleDefinition, action: str) -> None:
    module = definition.module
    if not module or not definition.is_active or definition.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This module is disabled")
    if not is_module_enabled_for_tenant(db, tenant_id=user.tenant_id, module=module):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This module is disabled")

    role_level = get_user_role_level(db, user)
    if role_level is not None and role_level >= ADMIN_MIN_ROLE_LEVEL:
        return

    if not user_has_module_assignment(db, user=user, module=module):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access to this module is forbidden")

    if not user.role_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is not assigned to a role")

    permission = (
        db.query(RoleModulePermission)
        .filter(RoleModulePermission.role_id == user.role_id, RoleModulePermission.module_id == module.id)
        .first()
    )
    attr = {
        "view": "can_view",
        "create": "can_create",
        "edit": "can_edit",
        "delete": "can_delete",
        "restore": "can_restore",
        "export": "can_export",
        "configure": "can_configure",
    }.get(action)
    if not attr or not permission or not bool(getattr(permission, attr)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Action is not allowed for this role")


def _seed_access(db: Session, *, tenant_id: int, module: Module) -> None:
    tenant_config = (
        db.query(TenantModuleConfig)
        .filter(TenantModuleConfig.tenant_id == tenant_id, TenantModuleConfig.module_id == module.id)
        .first()
    )
    if tenant_config is None:
        db.add(TenantModuleConfig(tenant_id=tenant_id, module_id=module.id, is_enabled=1, import_duplicate_mode="skip"))
    else:
        tenant_config.is_enabled = 1
        db.add(tenant_config)

    existing_department_ids = {
        department_id
        for (department_id,) in db.query(DepartmentModulePermission.department_id)
        .filter(DepartmentModulePermission.module_id == module.id)
        .all()
    }
    for department in db.query(Department).filter(Department.tenant_id == tenant_id).all():
        if department.id not in existing_department_ids:
            db.add(DepartmentModulePermission(department_id=department.id, module_id=module.id))

    existing_team_ids = {
        team_id
        for (team_id,) in db.query(TeamModulePermission.team_id)
        .filter(TeamModulePermission.module_id == module.id)
        .all()
    }
    for team in db.query(Team).filter(Team.tenant_id == tenant_id).all():
        if team.id not in existing_team_ids:
            db.add(TeamModulePermission(team_id=team.id, module_id=module.id))

    existing_role_ids = {
        role_id
        for (role_id,) in db.query(RoleModulePermission.role_id)
        .filter(RoleModulePermission.module_id == module.id)
        .all()
    }
    for role in db.query(Role).filter(Role.tenant_id == tenant_id).all():
        if role.id in existing_role_ids:
            continue
        template_key = "admin" if role.level >= 100 else "superuser" if role.level >= 90 else "user"
        actions = ROLE_TEMPLATES[template_key]["actions"]
        db.add(
            RoleModulePermission(
                role_id=role.id,
                module_id=module.id,
                can_view=1 if actions.can_view else 0,
                can_create=1 if actions.can_create else 0,
                can_edit=1 if actions.can_edit else 0,
                can_delete=1 if actions.can_delete else 0,
                can_restore=1 if actions.can_restore else 0,
                can_export=1 if actions.can_export else 0,
                can_configure=1 if actions.can_configure else 0,
            )
        )


def _set_tenant_module_enabled(db: Session, *, tenant_id: int, module: Module, enabled: bool) -> None:
    config = (
        db.query(TenantModuleConfig)
        .filter(
            TenantModuleConfig.tenant_id == tenant_id,
            TenantModuleConfig.module_id == module.id,
        )
        .first()
    )
    if config is None:
        config = TenantModuleConfig(
            tenant_id=tenant_id,
            module_id=module.id,
            import_duplicate_mode=module.import_duplicate_mode or "skip",
        )
    config.is_enabled = 1 if enabled else 0
    module.is_enabled = 1 if enabled else 0
    db.add(config)
    db.add(module)


def _field_by_key(definition: CustomModuleDefinition) -> dict[str, CustomModuleFieldDefinition]:
    return {field.key: field for field in definition.fields if field.deleted_at is None and field.is_active}


def _parse_datetime(value: Any, *, date_only: bool) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).strip()
    if date_only and len(text) == 10:
        text = f"{text}T00:00:00+00:00"
    parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _coerce_value(field: CustomModuleFieldDefinition, raw: Any) -> tuple[Any, dict[str, Any]]:
    if raw in (None, "", []):
        if field.is_required:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field.label} is required")
        return None, {}

    options = (field.validation_json or {}).get("options")
    field_type = field.field_type
    if field_type in TEXT_TYPES:
        value = str(raw).strip()
        if field_type == "email" and "@" not in value:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field.label} must be a valid email")
        if field_type == "url" and urlparse(value).scheme not in {"http", "https"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field.label} must be a valid URL")
        if field_type == "single_select" and options and value not in options:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field.label} must use an allowed option")
        return value, {"text_value": value}
    if field_type in NUMBER_TYPES:
        try:
            value = Decimal(str(raw))
        except (InvalidOperation, ValueError) as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field.label} must be a number") from exc
        return value, {"number_value": value}
    if field_type in DATE_TYPES:
        try:
            value = _parse_datetime(raw, date_only=field_type == "date")
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field.label} must be a valid date") from exc
        return value, {"datetime_value": value}
    if field_type == "boolean":
        value = bool(raw) if not isinstance(raw, str) else raw.lower() in {"true", "1", "yes", "on"}
        return value, {"boolean_value": value}
    if field_type == "multi_select":
        value = raw if isinstance(raw, list) else [raw]
        if options and any(item not in options for item in value):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field.label} contains an invalid option")
        return value, {"json_value": value}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported field type")


def _check_unique(db: Session, *, field: CustomModuleFieldDefinition, storage: dict[str, Any], record_id: int | None) -> None:
    if not field.is_unique or not storage:
        return
    attr, value = next(iter(storage.items()))
    query = (
        db.query(CustomModuleRecordValue)
        .join(CustomModuleRecord, CustomModuleRecord.id == CustomModuleRecordValue.record_id)
        .filter(
            CustomModuleRecordValue.tenant_id == field.tenant_id,
            CustomModuleRecordValue.custom_module_id == field.custom_module_id,
            CustomModuleRecordValue.field_id == field.id,
            CustomModuleRecord.deleted_at.is_(None),
            getattr(CustomModuleRecordValue, attr) == value,
        )
    )
    if record_id is not None:
        query = query.filter(CustomModuleRecordValue.record_id != record_id)
    if query.first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"{field.label} must be unique")


def list_modules(db: Session, *, tenant_id: int, include_deleted: bool = False) -> list[CustomModuleResponse]:
    query = (
        db.query(CustomModuleDefinition)
        .options(selectinload(CustomModuleDefinition.fields), selectinload(CustomModuleDefinition.module))
        .filter(CustomModuleDefinition.tenant_id == tenant_id)
    )
    if not include_deleted:
        query = query.filter(CustomModuleDefinition.deleted_at.is_(None))
    return [_serialize_module(module) for module in query.order_by(CustomModuleDefinition.name.asc()).all()]


def get_module(db: Session, *, tenant_id: int, module_id: int, include_deleted: bool = False) -> CustomModuleResponse:
    return _serialize_module(
        _get_module_definition(
            db,
            tenant_id=tenant_id,
            module_id=module_id,
            include_deleted=include_deleted,
        )
    )


def get_runtime_schema(db: Session, *, tenant_id: int, module_key: str, current_user: User) -> CustomModuleResponse:
    definition = _get_module_definition(db, tenant_id=tenant_id, key=module_key)
    _require_module_action(db, user=current_user, definition=definition, action="view")
    return _serialize_module(definition)


def create_module(db: Session, *, tenant_id: int, actor_user_id: int, payload: CustomModuleCreate) -> CustomModuleResponse:
    key = slug_key(payload.key or payload.name)
    if db.query(CustomModuleDefinition).filter(CustomModuleDefinition.tenant_id == tenant_id, CustomModuleDefinition.key == key).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Custom module key already exists")
    if db.query(Module).filter(Module.name == key).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Custom module key is reserved")

    platform_module = Module(
        name=f"custom_{tenant_id}_{key}",
        base_route=f"/dashboard/custom/{key}",
        description=payload.description or f"Custom module: {payload.name.strip()}",
        is_enabled=1,
        import_duplicate_mode="skip",
    )
    db.add(platform_module)
    db.flush()
    sidebar_tab_key = normalize_sidebar_tab_key(payload.sidebar_tab_key) if payload.sidebar_tab_key else default_sidebar_tab_key(platform_module.name)
    _ensure_sidebar_tab_exists(db, tenant_id=tenant_id, tab_key=sidebar_tab_key)

    definition = CustomModuleDefinition(
        tenant_id=tenant_id,
        name=payload.name.strip(),
        key=key,
        description=payload.description.strip() if payload.description else None,
        icon=payload.icon,
        is_active=True,
        module_id=platform_module.id,
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.add(definition)
    db.flush()
    _seed_access(db, tenant_id=tenant_id, module=platform_module)
    config = (
        db.query(TenantModuleConfig)
        .filter(TenantModuleConfig.tenant_id == tenant_id, TenantModuleConfig.module_id == platform_module.id)
        .first()
    )
    if config:
        config.sidebar_tab_key = sidebar_tab_key
        config.display_name = payload.display_name.strip() if payload.display_name and payload.display_name.strip() else payload.name.strip()
        db.add(config)
    for index, field_payload in enumerate(payload.fields):
        _add_field(db, definition=definition, payload=field_payload, sort_order=index)
    try:
        db.commit()
        db.refresh(definition)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Custom module key already exists") from exc
    log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key="module_builder",
        entity_type="custom_module",
        entity_id=definition.id,
        action="create",
        description=f"Created custom module {definition.name}",
        after_state=_serialize_module(definition).model_dump(mode="json"),
    )
    return _serialize_module(_get_module_definition(db, tenant_id=tenant_id, module_id=definition.id))


def update_module(db: Session, *, tenant_id: int, module_id: int, actor_user_id: int, payload: CustomModuleUpdate) -> CustomModuleResponse:
    definition = _get_module_definition(db, tenant_id=tenant_id, module_id=module_id)
    before = _serialize_module(definition).model_dump(mode="json")
    update_data = payload.model_dump(exclude_unset=True)
    config_data = {
        key: update_data.pop(key)
        for key in ["sidebar_tab_key", "display_name"]
        if key in update_data
    }
    for field, value in update_data.items():
        setattr(definition, field, value.strip() if isinstance(value, str) else value)
    definition.updated_by_user_id = actor_user_id
    if definition.module:
        definition.module.description = definition.description
        if "is_active" in update_data and update_data["is_active"] is not None:
            _set_tenant_module_enabled(
                db,
                tenant_id=tenant_id,
                module=definition.module,
                enabled=bool(update_data["is_active"]),
            )
        if config_data:
            config = (
                db.query(TenantModuleConfig)
                .filter(TenantModuleConfig.tenant_id == tenant_id, TenantModuleConfig.module_id == definition.module.id)
                .first()
            )
            if config is None:
                config = TenantModuleConfig(
                    tenant_id=tenant_id,
                    module_id=definition.module.id,
                    is_enabled=definition.module.is_enabled,
                    import_duplicate_mode=definition.module.import_duplicate_mode or "skip",
                )
            if "sidebar_tab_key" in config_data:
                value = config_data["sidebar_tab_key"]
                if value:
                    value = normalize_sidebar_tab_key(value)
                    _ensure_sidebar_tab_exists(db, tenant_id=tenant_id, tab_key=value)
                config.sidebar_tab_key = value
            if "display_name" in config_data:
                value = config_data["display_name"]
                config.display_name = value.strip() if isinstance(value, str) and value.strip() else None
            db.add(config)
    db.add(definition)
    db.commit()
    db.refresh(definition)
    after = _serialize_module(definition).model_dump(mode="json")
    log_activity(db, tenant_id=tenant_id, actor_user_id=actor_user_id, module_key="module_builder", entity_type="custom_module", entity_id=definition.id, action="update", before_state=before, after_state=after)
    return _serialize_module(definition)


def _add_field(db: Session, *, definition: CustomModuleDefinition, payload: CustomModuleFieldCreate, sort_order: int | None = None) -> CustomModuleFieldDefinition:
    key = slug_key(payload.key or payload.label)
    if any(field.key == key and field.deleted_at is None for field in definition.fields):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Field key already exists")
    if payload.is_unique and payload.field_type.value == "multi_select":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Multi-select fields cannot be unique")
    is_protected = is_protected_module_field(key)
    if is_protected and payload.is_active is False:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Protected identifier fields cannot be disabled")
    field = CustomModuleFieldDefinition(
        tenant_id=definition.tenant_id,
        custom_module_id=definition.id,
        key=key,
        label=payload.label.strip(),
        field_type=payload.field_type.value,
        help_text=payload.help_text,
        placeholder=payload.placeholder,
        is_required=payload.is_required,
        is_unique=payload.is_unique,
        display_in_list=payload.display_in_list,
        default_value=payload.default_value,
        validation_json=payload.validation_json,
        sort_order=payload.sort_order if sort_order is None else sort_order,
        is_active=True if is_protected else payload.is_active,
    )
    db.add(field)
    db.flush()
    definition.fields.append(field)
    return field


def create_field(db: Session, *, tenant_id: int, module_id: int, actor_user_id: int, payload: CustomModuleFieldCreate) -> CustomModuleResponse:
    definition = _get_module_definition(db, tenant_id=tenant_id, module_id=module_id)
    _add_field(db, definition=definition, payload=payload)
    definition.updated_by_user_id = actor_user_id
    db.commit()
    db.refresh(definition)
    log_activity(db, tenant_id=tenant_id, actor_user_id=actor_user_id, module_key="module_builder", entity_type="custom_module", entity_id=definition.id, action="field_create", description=f"Added field {payload.label}")
    return _serialize_module(_get_module_definition(db, tenant_id=tenant_id, module_id=module_id))


def update_field(db: Session, *, tenant_id: int, module_id: int, field_id: int, actor_user_id: int, payload: CustomModuleFieldUpdate) -> CustomModuleResponse:
    definition = _get_module_definition(db, tenant_id=tenant_id, module_id=module_id)
    field = next((item for item in definition.fields if item.id == field_id and item.deleted_at is None), None)
    if not field:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Field not found")
    update_data = payload.model_dump(exclude_unset=True)
    if update_data.get("is_unique") is True and field.field_type == "multi_select":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Multi-select fields cannot be unique")
    if update_data.get("is_active") is False and _is_protected_field(field):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Protected identifier fields cannot be disabled")
    for name, value in update_data.items():
        setattr(field, name, value.strip() if isinstance(value, str) else value)
    definition.updated_by_user_id = actor_user_id
    db.commit()
    db.refresh(definition)
    log_activity(db, tenant_id=tenant_id, actor_user_id=actor_user_id, module_key="module_builder", entity_type="custom_module", entity_id=definition.id, action="field_update", description=f"Updated field {field.label}")
    return _serialize_module(_get_module_definition(db, tenant_id=tenant_id, module_id=module_id))


def delete_field(db: Session, *, tenant_id: int, module_id: int, field_id: int, actor_user_id: int) -> CustomModuleResponse:
    definition = _get_module_definition(db, tenant_id=tenant_id, module_id=module_id)
    field = next((item for item in definition.fields if item.id == field_id and item.deleted_at is None), None)
    if not field:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Field not found")
    if _is_protected_field(field):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Protected identifier fields cannot be deleted")
    field.deleted_at = _now()
    field.is_active = False
    definition.updated_by_user_id = actor_user_id
    db.commit()
    db.refresh(definition)
    log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key="module_builder",
        entity_type="custom_module",
        entity_id=definition.id,
        action="field_delete",
        description=f"Deleted field {field.label}",
    )
    return _serialize_module(_get_module_definition(db, tenant_id=tenant_id, module_id=module_id))


def delete_module(db: Session, *, tenant_id: int, module_id: int, actor_user_id: int) -> CustomModuleResponse:
    definition = _get_module_definition(db, tenant_id=tenant_id, module_id=module_id)
    definition.deleted_at = _now()
    definition.is_active = False
    definition.updated_by_user_id = actor_user_id
    if definition.module:
        _set_tenant_module_enabled(db, tenant_id=tenant_id, module=definition.module, enabled=False)
    db.commit()
    log_activity(db, tenant_id=tenant_id, actor_user_id=actor_user_id, module_key="module_builder", entity_type="custom_module", entity_id=definition.id, action="delete", description=f"Deleted custom module {definition.name}")
    return _serialize_module(definition)


def restore_module(db: Session, *, tenant_id: int, module_id: int, actor_user_id: int) -> CustomModuleResponse:
    definition = _get_module_definition(db, tenant_id=tenant_id, module_id=module_id, include_deleted=True)
    if definition.deleted_at is None and definition.is_active:
        return _serialize_module(definition)
    definition.deleted_at = None
    definition.is_active = True
    definition.updated_by_user_id = actor_user_id
    if definition.module:
        _set_tenant_module_enabled(db, tenant_id=tenant_id, module=definition.module, enabled=True)
    db.commit()
    db.refresh(definition)
    log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key="module_builder",
        entity_type="custom_module",
        entity_id=definition.id,
        action="restore",
        description=f"Restored custom module {definition.name}",
        after_state=_serialize_module(definition).model_dump(mode="json"),
    )
    return _serialize_module(definition)


def serialize_record(record: CustomModuleRecord) -> CustomModuleRecordResponse:
    values = {}
    for value in record.values:
        field = value.field
        if field.deleted_at is not None or not field.is_active:
            continue
        if field.field_type in TEXT_TYPES:
            values[field.key] = value.text_value
        elif field.field_type in NUMBER_TYPES:
            values[field.key] = float(value.number_value) if value.number_value is not None else None
        elif field.field_type in DATE_TYPES:
            values[field.key] = value.datetime_value.isoformat() if value.datetime_value else None
        elif field.field_type == "boolean":
            values[field.key] = value.boolean_value
        else:
            values[field.key] = value.json_value
    return CustomModuleRecordResponse(
        id=record.id,
        custom_module_id=record.custom_module_id,
        title=record.title,
        values=values,
        created_by_user_id=record.created_by_user_id,
        updated_by_user_id=record.updated_by_user_id,
        created_at=record.created_at,
        updated_at=record.updated_at,
        deleted_at=record.deleted_at,
    )


def list_records(
    db: Session,
    *,
    module_key: str,
    current_user: User,
    pagination: Pagination,
    search: str | None = None,
    include_deleted: bool = False,
    sort_by: str | None = None,
    sort_direction: str | None = None,
):
    definition = _get_module_definition(db, tenant_id=current_user.tenant_id, key=module_key)
    _require_module_action(db, user=current_user, definition=definition, action="view")
    records, total = custom_modules_repository.list_records(
        db,
        definition=definition,
        offset=pagination.offset,
        limit=pagination.limit,
        search=search,
        include_deleted=include_deleted,
        sort_by=sort_by,
        sort_direction=sort_direction,
    )
    return build_paged_response([serialize_record(record) for record in records], total, pagination)


def list_records_cursor(db: Session, *, module_key: str, current_user: User, limit: int, cursor: int | None = None, search: str | None = None):
    definition = _get_module_definition(db, tenant_id=current_user.tenant_id, key=module_key)
    _require_module_action(db, user=current_user, definition=definition, action="view")
    records = custom_modules_repository.list_records_cursor(
        db,
        definition=definition,
        limit=limit,
        cursor=cursor,
        search=search,
    )
    return [serialize_record(record) for record in records]


def list_deleted_records_for_recycle(db: Session, *, tenant_id: int, module_key: str, pagination: Pagination):
    definition = _get_module_definition(db, tenant_id=tenant_id, key=module_key)
    query = (
        db.query(CustomModuleRecord)
        .options(selectinload(CustomModuleRecord.values).selectinload(CustomModuleRecordValue.field))
        .filter(
            CustomModuleRecord.tenant_id == tenant_id,
            CustomModuleRecord.custom_module_id == definition.id,
            CustomModuleRecord.deleted_at.is_not(None),
        )
    )
    total = query.count()
    records = query.order_by(CustomModuleRecord.deleted_at.desc(), CustomModuleRecord.id.desc()).offset(pagination.offset).limit(pagination.limit).all()
    items = [
        {
            "module_key": module_key,
            "record_id": record.id,
            "title": record.title,
            "subtitle": definition.name,
            "deleted_at": record.deleted_at,
            "details": serialize_record(record).model_dump(mode="json"),
        }
        for record in records
    ]
    return build_paged_response(items, total, pagination)


def is_custom_module_key(db: Session, *, tenant_id: int, module_key: str) -> bool:
    return (
        db.query(CustomModuleDefinition.id)
        .filter(
            CustomModuleDefinition.tenant_id == tenant_id,
            CustomModuleDefinition.key == module_key,
            CustomModuleDefinition.deleted_at.is_(None),
        )
        .first()
        is not None
    )


def _write_values(
    db: Session,
    *,
    definition: CustomModuleDefinition,
    record: CustomModuleRecord,
    payload_values: dict[str, Any],
    partial: bool = False,
) -> None:
    fields = _field_by_key(definition)
    unknown_keys = set(payload_values) - set(fields)
    if unknown_keys:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown field: {sorted(unknown_keys)[0]}",
        )
    existing = {value.field_id: value for value in record.values}
    for field in fields.values():
        if partial and field.key not in payload_values:
            continue
        raw = payload_values[field.key] if field.key in payload_values else field.default_value
        coerced, storage = _coerce_value(field, raw)
        _check_unique(db, field=field, storage=storage, record_id=record.id)
        value = existing.get(field.id) or CustomModuleRecordValue(tenant_id=record.tenant_id, custom_module_id=definition.id, record_id=record.id, field_id=field.id)
        value.text_value = value.number_value = value.datetime_value = value.boolean_value = value.json_value = None
        for attr, stored in storage.items():
            setattr(value, attr, stored)
        if coerced is not None or field.is_required or field.id in existing:
            db.add(value)


def create_record(db: Session, *, module_key: str, current_user: User, payload: CustomModuleRecordRequest) -> CustomModuleRecordResponse:
    definition = _get_module_definition(db, tenant_id=current_user.tenant_id, key=module_key)
    _require_module_action(db, user=current_user, definition=definition, action="create")
    title = (payload.title or "").strip() or str(payload.values.get("name") or payload.values.get("title") or "Untitled")
    record = CustomModuleRecord(tenant_id=current_user.tenant_id, custom_module_id=definition.id, title=title, created_by_user_id=current_user.id, updated_by_user_id=current_user.id)
    db.add(record)
    db.flush()
    _write_values(db, definition=definition, record=record, payload_values=payload.values)
    db.commit()
    db.refresh(record)
    response = serialize_record(_get_record(db, definition=definition, record_id=record.id))
    log_activity(db, tenant_id=current_user.tenant_id, actor_user_id=current_user.id, module_key=definition.key, entity_type="custom_module_record", entity_id=record.id, action="create", after_state=response.model_dump(mode="json"))
    return response


def _get_record(db: Session, *, definition: CustomModuleDefinition, record_id: int, include_deleted: bool = False) -> CustomModuleRecord:
    record = custom_modules_repository.get_record(
        db,
        definition=definition,
        record_id=record_id,
        include_deleted=include_deleted,
    )
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found")
    return record


def get_record(db: Session, *, module_key: str, record_id: int, current_user: User) -> CustomModuleRecordResponse:
    definition = _get_module_definition(db, tenant_id=current_user.tenant_id, key=module_key)
    _require_module_action(db, user=current_user, definition=definition, action="view")
    return serialize_record(_get_record(db, definition=definition, record_id=record_id))


def update_record(db: Session, *, module_key: str, record_id: int, current_user: User, payload: CustomModuleRecordRequest) -> CustomModuleRecordResponse:
    definition = _get_module_definition(db, tenant_id=current_user.tenant_id, key=module_key)
    _require_module_action(db, user=current_user, definition=definition, action="edit")
    record = _get_record(db, definition=definition, record_id=record_id)
    before = serialize_record(record).model_dump(mode="json")
    if payload.title is not None:
        record.title = payload.title.strip() or record.title
    record.updated_by_user_id = current_user.id
    _write_values(db, definition=definition, record=record, payload_values=payload.values, partial=True)
    db.commit()
    after = serialize_record(_get_record(db, definition=definition, record_id=record_id)).model_dump(mode="json")
    log_activity(db, tenant_id=current_user.tenant_id, actor_user_id=current_user.id, module_key=definition.key, entity_type="custom_module_record", entity_id=record.id, action="update", before_state=before, after_state=after)
    return CustomModuleRecordResponse.model_validate(after)


def delete_record(db: Session, *, module_key: str, record_id: int, current_user: User) -> CustomModuleRecordResponse:
    definition = _get_module_definition(db, tenant_id=current_user.tenant_id, key=module_key)
    _require_module_action(db, user=current_user, definition=definition, action="delete")
    record = _get_record(db, definition=definition, record_id=record_id)
    record.deleted_at = _now()
    record.updated_by_user_id = current_user.id
    db.commit()
    response = serialize_record(record)
    log_activity(db, tenant_id=current_user.tenant_id, actor_user_id=current_user.id, module_key=definition.key, entity_type="custom_module_record", entity_id=record.id, action="delete", before_state=response.model_dump(mode="json"))
    return response


def restore_record(db: Session, *, module_key: str, record_id: int, current_user: User) -> CustomModuleRecordResponse:
    definition = _get_module_definition(db, tenant_id=current_user.tenant_id, key=module_key)
    _require_module_action(db, user=current_user, definition=definition, action="restore")
    record = _get_record(db, definition=definition, record_id=record_id, include_deleted=True)
    record.deleted_at = None
    record.updated_by_user_id = current_user.id
    db.commit()
    response = serialize_record(record)
    log_activity(db, tenant_id=current_user.tenant_id, actor_user_id=current_user.id, module_key=definition.key, entity_type="custom_module_record", entity_id=record.id, action="restore", after_state=response.model_dump(mode="json"))
    return response


def export_records(db: Session, *, module_key: str, current_user: User) -> tuple[bytes, str]:
    definition = _get_module_definition(db, tenant_id=current_user.tenant_id, key=module_key)
    _require_module_action(db, user=current_user, definition=definition, action="export")
    records = (
        db.query(CustomModuleRecord)
        .options(selectinload(CustomModuleRecord.values).selectinload(CustomModuleRecordValue.field))
        .filter(CustomModuleRecord.tenant_id == current_user.tenant_id, CustomModuleRecord.custom_module_id == definition.id, CustomModuleRecord.deleted_at.is_(None))
        .order_by(CustomModuleRecord.id.asc())
        .all()
    )
    fields = [
        field
        for field in sorted(definition.fields, key=lambda item: (item.sort_order, item.id))
        if field.deleted_at is None and field.is_active
    ]
    headers = ["id", "title", *[field.key for field in fields], "created_at", "updated_at"]
    rows = []
    for record in records:
        serialized = serialize_record(record)
        rows.append({"id": record.id, "title": record.title, **serialized.values, "created_at": record.created_at, "updated_at": record.updated_at})
    return dict_rows_to_csv_bytes(headers=headers, rows=rows), f"{definition.key}_export.csv"


def import_records_from_csv_bytes(
    db: Session,
    *,
    module_key: str,
    current_user: User,
    file_bytes: bytes,
) -> dict:
    definition = _get_module_definition(db, tenant_id=current_user.tenant_id, key=module_key)
    _require_module_action(db, user=current_user, definition=definition, action="create")
    _, rows = rows_from_csv_bytes(file_bytes)
    fields = _field_by_key(definition)
    failures = []
    new_rows = 0

    for index, row in enumerate(rows, start=2):
        title = (row.get("title") or row.get("name") or "").strip() or "Untitled"
        values = {
            field_key: row.get(field_key)
            for field_key in fields
            if field_key in row
        }
        try:
            create_record(
                db,
                module_key=module_key,
                current_user=current_user,
                payload=CustomModuleRecordRequest(title=title, values=values),
            )
            new_rows += 1
        except HTTPException as exc:
            db.rollback()
            failures.append(
                {
                    "row_number": index,
                    "record_identifier": title,
                    "reason": str(exc.detail),
                }
            )

    return build_import_summary(
        total_rows=len(rows),
        new_rows=new_rows,
        failures=failures,
    )


def import_preview_for_csv_bytes(
    *,
    definition: CustomModuleDefinition,
    file_bytes: bytes,
) -> dict:
    source_headers, _ = rows_from_csv_bytes(file_bytes)
    target_headers = import_target_headers_for_definition(definition)
    required_headers = import_required_headers_for_definition(definition)
    normalized_source = {header.strip().lower(): header for header in source_headers}
    suggested_mapping = {
        target: normalized_source.get(target.lower())
        for target in target_headers
    }
    if suggested_mapping.get("title") is None:
        suggested_mapping["title"] = normalized_source.get("name")
    return {
        "source_headers": source_headers,
        "target_headers": target_headers,
        "required_headers": required_headers,
        "default_duplicate_mode": "skip",
        "suggested_mapping": suggested_mapping,
    }


def import_target_headers_for_definition(definition: CustomModuleDefinition) -> list[str]:
    fields = [field for field in sorted(definition.fields, key=lambda item: (item.sort_order, item.id)) if field.deleted_at is None and field.is_active]
    return ["title", *[field.key for field in fields]]


def import_required_headers_for_definition(definition: CustomModuleDefinition) -> list[str]:
    fields = [field for field in sorted(definition.fields, key=lambda item: (item.sort_order, item.id)) if field.deleted_at is None and field.is_active]
    return [field.key for field in fields if field.is_required]


def import_target_headers(
    db: Session,
    *,
    module_key: str,
    current_user: User,
) -> list[str]:
    definition = _get_module_definition(db, tenant_id=current_user.tenant_id, key=module_key)
    _require_module_action(db, user=current_user, definition=definition, action="create")
    return import_target_headers_for_definition(definition)


def preview_import(
    db: Session,
    *,
    module_key: str,
    current_user: User,
    file_bytes: bytes,
) -> dict:
    definition = _get_module_definition(db, tenant_id=current_user.tenant_id, key=module_key)
    _require_module_action(db, user=current_user, definition=definition, action="create")
    return import_preview_for_csv_bytes(definition=definition, file_bytes=file_bytes)
