from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.mail.schema import (
    MailContextResponse,
    MailMessageListResponse,
    MailMessageResponse,
    MailProvider,
    MailProviderConnectResponse,
    MailSendRequest,
    MailSyncResponse,
)
from app.modules.mail.services.mail_services import (
    build_mail_context,
    get_google_mail_connect_url,
    get_mail_message_or_404,
    get_microsoft_mail_connect_url,
    list_mail_messages,
    send_mail_message,
    serialize_mail_message,
    sync_google_inbox,
    sync_microsoft_inbox,
)


router = APIRouter(prefix="/mail", tags=["Mail"])


@router.get("/context", response_model=MailContextResponse)
def get_mail_context(
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("mail")),
    require_permission=Depends(require_action_access("mail", "view")),
):
    return build_mail_context(db, tenant_id=current_user.tenant_id, current_user=current_user)


@router.get("/messages", response_model=MailMessageListResponse)
def get_mail_messages(
    folder: str | None = Query(default=None, max_length=80),
    search: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("mail")),
    require_permission=Depends(require_action_access("mail", "view")),
):
    messages = list_mail_messages(
        db,
        tenant_id=current_user.tenant_id,
        current_user=current_user,
        folder=folder,
        search=search,
        limit=limit,
    )
    return {"results": [MailMessageResponse.model_validate(serialize_mail_message(message)) for message in messages]}


@router.get("/messages/{message_id}", response_model=MailMessageResponse)
def get_mail_message(
    message_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("mail")),
    require_permission=Depends(require_action_access("mail", "view")),
):
    message = get_mail_message_or_404(
        db,
        message_id,
        tenant_id=current_user.tenant_id,
        current_user=current_user,
    )
    return MailMessageResponse.model_validate(serialize_mail_message(message))


@router.post("/send", response_model=MailMessageResponse)
def send_mail(
    payload: MailSendRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("mail")),
    require_permission=Depends(require_action_access("mail", "edit")),
):
    message = send_mail_message(db, current_user=current_user, payload=payload.model_dump(mode="json"))
    return MailMessageResponse.model_validate(serialize_mail_message(message))


@router.post("/connect/{provider}", response_model=MailProviderConnectResponse)
def connect_mail_provider(
    provider: MailProvider,
    request: Request,
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("mail")),
    require_permission=Depends(require_action_access("mail", "edit")),
):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant context missing")
    if provider == MailProvider.google:
        return {
            "provider": provider,
            "auth_url": get_google_mail_connect_url(request=request, tenant=tenant, user=current_user),
        }
    return {
        "provider": provider,
        "auth_url": get_microsoft_mail_connect_url(request=request, tenant=tenant, user=current_user),
    }


@router.post("/sync/{provider}", response_model=MailSyncResponse)
def sync_mail_provider(
    provider: MailProvider,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("mail")),
    require_permission=Depends(require_action_access("mail", "edit")),
):
    if provider == MailProvider.google:
        return MailSyncResponse.model_validate(sync_google_inbox(db, current_user=current_user))
    return MailSyncResponse.model_validate(sync_microsoft_inbox(db, current_user=current_user))
