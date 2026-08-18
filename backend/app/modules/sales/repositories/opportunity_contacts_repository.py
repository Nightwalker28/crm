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
    """Participants on one deal, primary first, then oldest link first.

    Removed associations are excluded; `list_removed_for_opportunity` is the only
    reader that returns them.
    """

    return (
        _base_query(db, tenant_id=tenant_id, include_deleted_contacts=include_deleted_contacts)
        .filter(
            SalesOpportunityContact.opportunity_id == opportunity_id,
            SalesOpportunityContact.deleted_at.is_(None),
        )
        .order_by(
            SalesOpportunityContact.is_primary.desc(),
            SalesOpportunityContact.id.asc(),
        )
        .all()
    )


def list_removed_for_opportunity(
    db: Session,
    *,
    tenant_id: int,
    opportunity_id: int,
) -> list[SalesOpportunityContact]:
    """Removed associations on one deal, most recently removed first.

    A removed participant whose contact is itself in the recycle bin still has to
    appear here, otherwise the row could not be recovered at all, so deleted
    contacts are included.
    """

    return (
        _base_query(db, tenant_id=tenant_id, include_deleted_contacts=True)
        .filter(
            SalesOpportunityContact.opportunity_id == opportunity_id,
            SalesOpportunityContact.deleted_at.is_not(None),
        )
        .order_by(
            SalesOpportunityContact.deleted_at.desc(),
            SalesOpportunityContact.id.desc(),
        )
        .all()
    )


def get_link(
    db: Session,
    *,
    tenant_id: int,
    opportunity_id: int,
    contact_id: int,
    include_removed: bool = True,
) -> SalesOpportunityContact | None:
    """Look up the association for one contact on one deal.

    Removed rows are included by default because the unique link constraint counts
    them: re-adding a contact has to find and revive the existing row rather than
    collide with it.
    """

    query = db.query(SalesOpportunityContact).filter(
        SalesOpportunityContact.tenant_id == tenant_id,
        SalesOpportunityContact.opportunity_id == opportunity_id,
        SalesOpportunityContact.contact_id == contact_id,
    )
    if not include_removed:
        query = query.filter(SalesOpportunityContact.deleted_at.is_(None))
    return query.first()


def get_link_by_id(
    db: Session,
    *,
    tenant_id: int,
    opportunity_id: int,
    link_id: int,
    include_removed: bool = False,
) -> SalesOpportunityContact | None:
    """Fetch one association by its own id, scoped to tenant and parent deal.

    The opportunity id is part of the filter rather than trusted from the caller's
    path alone, so an association id from another deal cannot be operated on
    through a deal the caller happens to have access to.
    """

    query = db.query(SalesOpportunityContact).filter(
        SalesOpportunityContact.tenant_id == tenant_id,
        SalesOpportunityContact.opportunity_id == opportunity_id,
        SalesOpportunityContact.id == link_id,
    )
    if not include_removed:
        query = query.filter(SalesOpportunityContact.deleted_at.is_(None))
    return query.first()


def list_primary_links(
    db: Session,
    *,
    tenant_id: int,
    opportunity_id: int,
) -> list[SalesOpportunityContact]:
    """Every row currently flagged primary.

    Returns a list rather than one row so the compatibility sync can demote
    whatever it finds, even if older data somehow carries more than one. Removed
    rows are not filtered out: the flag is what matters here, and a removed row
    holding it would still occupy the partial unique index.
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


def get_active_contact(db: Session, *, tenant_id: int, contact_id: int) -> SalesContact | None:
    """The contact a caller is explicitly linking, within their tenant only.

    Stricter than `contact_belongs_to_tenant`: a deliberate participant operation
    must not resurrect a contact that is sitting in the recycle bin.
    """

    return (
        db.query(SalesContact)
        .filter(
            SalesContact.contact_id == contact_id,
            SalesContact.tenant_id == tenant_id,
            SalesContact.deleted_at.is_(None),
        )
        .first()
    )
