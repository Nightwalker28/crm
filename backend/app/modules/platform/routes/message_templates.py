from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.platform.schema import (
    MessageTemplateCreateRequest,
    MessageTemplateListResponse,
    MessageTemplateResponse,
    MessageTemplateUpdateRequest,
)
from app.modules.platform.services.message_templates import (
    create_message_template,
    get_message_template_or_404,
    list_message_templates,
    serialize_message_template,
    soft_delete_message_template,
    update_message_template,
)


router = APIRouter(prefix="/message-templates", tags=["Message Templates"])


@router.get("", response_model=MessageTemplateListResponse)
def list_templates(
    channel: str | None = Query(default=None),
    module_key: str | None = Query(default=None),
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("message_templates")),
    require_permission=Depends(require_action_access("message_templates", "view")),
):
    templates = list_message_templates(
        db,
        tenant_id=current_user.tenant_id,
        channel=channel,
        module_key=module_key,
        include_inactive=include_inactive,
    )
    return {"results": [MessageTemplateResponse.model_validate(serialize_message_template(template)) for template in templates]}


@router.post("", response_model=MessageTemplateResponse, status_code=status.HTTP_201_CREATED)
def create_template(
    payload: MessageTemplateCreateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("message_templates")),
    require_permission=Depends(require_action_access("message_templates", "create")),
):
    template = create_message_template(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        payload=payload.model_dump(),
    )
    return MessageTemplateResponse.model_validate(serialize_message_template(template))


@router.put("/{template_id}", response_model=MessageTemplateResponse)
def update_template(
    template_id: int,
    payload: MessageTemplateUpdateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("message_templates")),
    require_permission=Depends(require_action_access("message_templates", "edit")),
):
    template = get_message_template_or_404(db, tenant_id=current_user.tenant_id, template_id=template_id)
    template = update_message_template(
        db,
        template=template,
        actor_user_id=current_user.id,
        payload=payload.model_dump(exclude_unset=True),
    )
    return MessageTemplateResponse.model_validate(serialize_message_template(template))


@router.delete("/{template_id}", response_model=MessageTemplateResponse)
def delete_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("message_templates")),
    require_permission=Depends(require_action_access("message_templates", "delete")),
):
    template = get_message_template_or_404(db, tenant_id=current_user.tenant_id, template_id=template_id)
    template = soft_delete_message_template(db, template=template, actor_user_id=current_user.id)
    return MessageTemplateResponse.model_validate(serialize_message_template(template))
