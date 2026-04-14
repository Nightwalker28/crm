from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.access_control import require_department_module_access
from app.core.database import get_db
from app.core.security import require_admin, require_user
from app.modules.platform.schema import (
    CustomFieldDefinitionCreateRequest,
    CustomFieldDefinitionResponse,
    CustomFieldDefinitionUpdateRequest,
)
from app.modules.platform.services import custom_fields

router = APIRouter(prefix="/admin/custom-fields", tags=["Custom Fields"])


public_router = APIRouter(prefix="/custom-fields", tags=["Custom Fields"])


@public_router.get("/{module_key}", response_model=list[CustomFieldDefinitionResponse])
def list_active_module_custom_fields(
    module_key: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    require_department_module_access(db, user=current_user, module_key=module_key)
    return custom_fields.list_custom_field_definitions(db, module_key=module_key, include_inactive=False)


@router.get("/{module_key}", response_model=list[CustomFieldDefinitionResponse])
def list_module_custom_fields(
    module_key: str,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    return custom_fields.list_custom_field_definitions(db, module_key=module_key, include_inactive=True)


@router.post("/{module_key}", response_model=CustomFieldDefinitionResponse, status_code=status.HTTP_201_CREATED)
def create_module_custom_field(
    module_key: str,
    payload: CustomFieldDefinitionCreateRequest,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    return custom_fields.create_custom_field_definition(db, module_key=module_key, payload=payload)


@router.put("/{field_id}", response_model=CustomFieldDefinitionResponse)
def update_module_custom_field(
    field_id: int,
    payload: CustomFieldDefinitionUpdateRequest,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    return custom_fields.update_custom_field_definition(db, field_id=field_id, payload=payload)
