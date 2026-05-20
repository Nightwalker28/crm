from __future__ import annotations

from sqlalchemy.orm import Session

from app.modules.sales.models import SalesContact
from app.modules.user_management.models import CompanyProfile


def get_active_contact(db: Session, *, tenant_id: int, contact_id: int) -> SalesContact | None:
    return (
        db.query(SalesContact)
        .filter(
            SalesContact.contact_id == contact_id,
            SalesContact.tenant_id == tenant_id,
            SalesContact.deleted_at.is_(None),
        )
        .first()
    )


def get_company_country(db: Session, *, tenant_id: int) -> str | None:
    return db.query(CompanyProfile.country).filter(CompanyProfile.tenant_id == tenant_id).scalar()
