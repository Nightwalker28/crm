from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_admin, require_user
from app.modules.platform.schema import ModuleFieldConfigResponse, ModuleFieldConfigUpdateRequest
from app.modules.platform.services import module_fields


admin_router = APIRouter(prefix="/admin/module-fields", tags=["Module Fields"])
router = APIRouter(prefix="/module-fields", tags=["Module Fields"])


@router.get("/{module_key}", response_model=list[ModuleFieldConfigResponse])
def list_runtime_module_field_configs(
    module_key: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    return module_fields.list_module_field_configs(db, tenant_id=current_user.tenant_id, module_key=module_key)


@admin_router.get("/{module_key}", response_model=list[ModuleFieldConfigResponse])
def list_admin_module_field_configs(
    module_key: str,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    return module_fields.list_module_field_configs(db, tenant_id=admin.tenant_id, module_key=module_key)


@admin_router.put("/{module_key}/{field_key:path}", response_model=ModuleFieldConfigResponse)
def update_admin_module_field_config(
    module_key: str,
    field_key: str,
    payload: ModuleFieldConfigUpdateRequest,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    return module_fields.update_module_field_config(
        db,
        tenant_id=admin.tenant_id,
        module_key=module_key,
        field_key=field_key,
        payload=payload,
    )
