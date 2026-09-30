from sqlalchemy.orm import Session

from app.modules.sales.models import SalesContact


def get_active_contact(db: Session, *, tenant_id: int, contact_id: int) -> SalesContact | None:
    return (
        db.query(SalesContact)
        .filter(
            SalesContact.tenant_id == tenant_id,
            SalesContact.contact_id == contact_id,
            SalesContact.deleted_at.is_(None),
        )
        .first()
    )
