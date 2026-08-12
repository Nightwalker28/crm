"""Query construction for opportunity <-> contact associations."""

from __future__ import annotations

from sqlalchemy.orm import Session, contains_eager

from app.modules.sales.models import SalesContact, SalesOpportunityContact


def _base_query(db: Session, *, tenant_id: int, include_deleted_contacts: bool):
    query = (
        db.query(SalesOpportunityContact)
        .join(SalesContact, SalesContact.contact_id == SalesOpportunityContact.contact_id)
        .options(contains_eager(SalesOpportunityContact.contact))
        .filter(SalesOpportunityContact.tenant_id == tenant_id)
    )
    if not include_deleted_contacts:
        query = query.filter(SalesContact.deleted_at.is_(None))
    return query


def list_for_opportunity(
    db: Session,
    *,
    tenant_id: int,
    opportunity_id: int,
    include_deleted_contacts: bool = False,
) -> list[SalesOpportunityContact]:
    """Participants on one deal, primary first, then oldest link first."""

    return (
        _base_query(db, tenant_id=tenant_id, include_deleted_contacts=include_deleted_contacts)
        .filter(SalesOpportunityContact.opportunity_id == opportunity_id)
        .order_by(
            SalesOpportunityContact.is_primary.desc(),
            SalesOpportunityContact.id.asc(),
        )
        .all()
    )


def get_link(
    db: Session,
    *,
    tenant_id: int,
    opportunity_id: int,
    contact_id: int,
) -> SalesOpportunityContact | None:
    return (
        db.query(SalesOpportunityContact)
        .filter(
            SalesOpportunityContact.tenant_id == tenant_id,
            SalesOpportunityContact.opportunity_id == opportunity_id,
            SalesOpportunityContact.contact_id == contact_id,
        )
        .first()
    )


def list_primary_links(
    db: Session,
    *,
    tenant_id: int,
    opportunity_id: int,
) -> list[SalesOpportunityContact]:
    """Every row currently flagged primary.

    Returns a list rather than one row so the compatibility sync can demote
    whatever it finds, even if older data somehow carries more than one.
    """

    return (
        db.query(SalesOpportunityContact)
        .filter(
            SalesOpportunityContact.tenant_id == tenant_id,
            SalesOpportunityContact.opportunity_id == opportunity_id,
            SalesOpportunityContact.is_primary.is_(True),
        )
        .order_by(SalesOpportunityContact.id.asc())
        .all()
    )


def contact_belongs_to_tenant(db: Session, *, tenant_id: int, contact_id: int) -> bool:
    """Tenant ownership check that deliberately ignores soft deletion.

    The legacy `contact_id` column can already point at a contact that is in the
    recycle bin; the association has to keep that reference rather than drop it.
    """

    return bool(
        db.query(SalesContact.contact_id)
        .filter(
            SalesContact.contact_id == contact_id,
            SalesContact.tenant_id == tenant_id,
        )
        .first()
    )
