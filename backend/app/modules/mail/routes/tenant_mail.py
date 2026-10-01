from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_admin
from app.modules.mail.services import tenant_mail


router = APIRouter(prefix="/admin/tenant-mail", tags=["Tenant Mail"])


class TenantMailSettingsRequest(BaseModel):
    sender_email: EmailStr
    smtp_host: str = Field(min_length=1, max_length=255)
    smtp_port: int = Field(ge=1, le=65535)
    smtp_security: str = Field(pattern="^(ssl|starttls|none)$")
    smtp_username: str = Field(min_length=1, max_length=255)
    password: str | None = Field(default=None, max_length=1024)


@router.get("")
def get_tenant_mail_settings(db: Session = Depends(get_db), admin=Depends(require_admin)):
    return tenant_mail.settings_summary(tenant_mail.get_settings(db, admin.tenant_id))


@router.put("")
def put_tenant_mail_settings(payload: TenantMailSettingsRequest, db: Session = Depends(get_db), admin=Depends(require_admin)):
    return tenant_mail.save_settings(db, admin.tenant_id, actor_user_id=admin.id, **payload.model_dump())
