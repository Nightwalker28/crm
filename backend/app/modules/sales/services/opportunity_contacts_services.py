"""Domain rules for the contacts involved in an opportunity.

Phase 1 of the relationships workstream (`docs/crm-evolution/05-relationships-data-model.md`)
lands the association model and keeps it synchronized with the legacy
`sales_opportunities.contact_id` column. Participant mutation is Phase 2, so the
only writer here is the compatibility mirror.

Compatibility period
--------------------
`sales_opportunities.contact_id` stays the source of truth for the primary contact
and remains readable and writable through every existing API, import, and export.
`sync_primary_contact_association` is the one-way mirror from that column onto this
table, so a client that knows nothing about participants still produces correct
association data. The mirror is deliberately one-way: nothing here writes back to
`contact_id`, so the legacy field cannot be changed by a relationship operation
that predates Phase 2.

Removal criteria for `contact_id` — all must hold before it is dropped:

1. Phase 2 participant APIs are the only way clients set the primary contact, and
   the sync mirror has been inverted or retired.
2. Every reader listed in the Phase 1 inventory reads the association instead:
   `summary_services`, `quotes_services.create_quote`, `opportunities_api`
   (Finance IO), `mail_services` token context, opportunity CSV import/export,
   `opportunities_repository` filters/indexes, and `leads_services` conversion.
3. Opportunity CSV import/export and any external integration using the
   `contact_id` column have a published participant-based replacement.
4. A migration exists that can prove, per tenant, that the association table
   covers every non-null `contact_id` before the column is dropped.
"""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.modules.sales.models import SalesContact, SalesOpportunity, SalesOpportunityContact
from app.modules.sales.opportunity_contact_roles import (
    DEFAULT_OPPORTUNITY_CONTACT_ROLE,
    opportunity_contact_role_label,
)
from app.modules.sales.repositories import opportunity_contacts_repository

CROSS_TENANT_CONTACT_DETAIL = "Contact not found"


def contact_display_name(contact: SalesContact | None) -> str | None:
    if contact is None:
        return None
    full_name = " ".join(part for part in [contact.first_name, contact.last_name] if part).strip()
    return full_name or contact.primary_email


def sync_primary_contact_association(
    db: Session,
    *,
    opportunity: SalesOpportunity,
    actor_user_id: int | None = None,
) -> SalesOpportunityContact | None:
    """Mirror the legacy `contact_id` column onto the association table.

    Called after every write that can set an opportunity's contact, so the two
    representations cannot drift while both are supported. It flushes but never
    commits: lead conversion runs inside a wider transaction.

    Demotion happens before promotion because at most one row per opportunity may
    carry `is_primary` at the database level.
    """

    tenant_id = opportunity.tenant_id
    opportunity_id = opportunity.opportunity_id
    contact_id = opportunity.contact_id

    if contact_id is not None and not opportunity_contacts_repository.contact_belongs_to_tenant(
        db, tenant_id=tenant_id, contact_id=contact_id
    ):
        # A contact from another tenant is never linked, and never silently
        # dropped either: the write that carried it fails.
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=CROSS_TENANT_CONTACT_DETAIL)

    for existing_primary in opportunity_contacts_repository.list_primary_links(
        db, tenant_id=tenant_id, opportunity_id=opportunity_id
    ):
        if existing_primary.contact_id == contact_id:
            continue
        # The participant row survives a change of primary contact; only the flag moves.
        existing_primary.is_primary = False
        db.add(existing_primary)
    db.flush()

    if contact_id is None:
        return None

    link = opportunity_contacts_repository.get_link(
        db, tenant_id=tenant_id, opportunity_id=opportunity_id, contact_id=contact_id
    )
    if link is None:
        link = SalesOpportunityContact(
            tenant_id=tenant_id,
            opportunity_id=opportunity_id,
            contact_id=contact_id,
            role_key=DEFAULT_OPPORTUNITY_CONTACT_ROLE,
            is_primary=True,
            created_by_user_id=actor_user_id,
        )
        db.add(link)
    elif not link.is_primary:
        link.is_primary = True
        db.add(link)
    db.flush()
    return link


def list_opportunity_participants(
    db: Session,
    *,
    tenant_id: int,
    opportunity_id: int,
) -> list[SalesOpportunityContact]:
    """Participants whose contact is still active, primary first.

    A soft-deleted contact keeps its association row — restoring the contact
    restores the relationship — but it is not presented as a participant.
    """

    return opportunity_contacts_repository.list_for_opportunity(
        db, tenant_id=tenant_id, opportunity_id=opportunity_id
    )


def serialize_participant(link: SalesOpportunityContact) -> dict:
    contact = link.contact
    return {
        "id": link.id,
        "opportunity_id": link.opportunity_id,
        "contact_id": link.contact_id,
        "role_key": link.role_key,
        "role_label": opportunity_contact_role_label(link.role_key),
        "is_primary": bool(link.is_primary),
        "contact_name": contact_display_name(contact),
        "contact": contact,
        "created_at": link.created_at,
        "created_by_user_id": link.created_by_user_id,
    }


def serialize_participants(links: list[SalesOpportunityContact]) -> list[dict]:
    return [serialize_participant(link) for link in links]
