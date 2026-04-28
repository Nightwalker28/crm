from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.whatsapp.schema import WhatsAppContactClickRequest, WhatsAppContactClickResponse
from app.modules.whatsapp.services.whatsapp_services import record_contact_whatsapp_click


router = APIRouter(prefix="/whatsapp", tags=["WhatsApp"])


@router.post("/contacts/{contact_id}/click", response_model=WhatsAppContactClickResponse, status_code=status.HTTP_201_CREATED)
def click_to_chat_contact(
    contact_id: int,
    payload: WhatsAppContactClickRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_whatsapp_module=Depends(require_module_access("whatsapp")),
    require_whatsapp_permission=Depends(require_action_access("whatsapp", "create")),
    require_contacts_module=Depends(require_module_access("sales_contacts")),
    require_contacts_permission=Depends(require_action_access("sales_contacts", "view")),
):
    return record_contact_whatsapp_click(
        db,
        current_user=current_user,
        contact_id=contact_id,
        template_id=payload.template_id,
        variables=payload.variables,
        create_follow_up_task_flag=payload.create_follow_up_task,
        follow_up_due_at=payload.follow_up_due_at,
        follow_up_title=payload.follow_up_title,
    )
