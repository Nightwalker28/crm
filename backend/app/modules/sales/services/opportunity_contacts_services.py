"""Domain rules for the contacts involved in an opportunity.

Phase 1 of the relationships workstream (`docs/crm-evolution/05-relationships-data-model.md`)
landed the association model and the mirror that keeps it synchronized with the
legacy `sales_opportunities.contact_id` column. Phase 2 adds the explicit
participant operations — add, remove, restore, change role, change primary — as the
first writers other than that mirror.

Compatibility period
--------------------
`sales_opportunities.contact_id` stays the source of truth for the primary contact
and remains readable and writable through every existing API, import, and export.
`sync_primary_contact_association` is the mirror from that column onto this table,
so a client that knows nothing about participants still produces correct
association data.

Phase 2 makes the primary relationship writable from the participant side too, so
the two representations are now kept in step in both directions:

- legacy write (`contact_id` set on create/update) -> `sync_primary_contact_association`
  moves the primary flag;
- participant write (`set_primary_participant`) -> writes `contact_id` and the
  denormalized `client` display name back onto the deal.

Both paths converge on the same invariant — exactly one primary association, and it
is the contact in `contact_id` — so neither representation can go stale. Nothing
else here writes `contact_id`: adding, removing, restoring, or re-roling a
non-primary participant leaves the legacy field untouched, which is what keeps
single-contact clients unaffected by participant management.

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

from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.crm_events import actor_payload, safe_emit_crm_event
from app.modules.sales.models import SalesContact, SalesOpportunity, SalesOpportunityContact
from app.modules.sales.opportunity_contact_roles import (
    DEFAULT_OPPORTUNITY_CONTACT_ROLE,
    normalize_opportunity_contact_role,
    opportunity_contact_role_label,
)
from app.modules.sales.repositories import opportunities_repository, opportunity_contacts_repository

CROSS_TENANT_CONTACT_DETAIL = "Contact not found"
LEGACY_CLIENT_FALLBACK = "Unnamed Contact"

MODULE_KEY = "sales_opportunities"
ENTITY_TYPE = "sales_opportunity"

PARTICIPANT_NOT_FOUND_DETAIL = "Participant not found"
REMOVED_PARTICIPANT_NOT_FOUND_DETAIL = "Removed participant not found"
DUPLICATE_PARTICIPANT_DETAIL = "That contact is already a participant on this deal."
REMOVE_PRIMARY_DETAIL = (
    "Set another participant as the primary contact before removing this one."
)
DELETED_CONTACT_RESTORE_DETAIL = (
    "That contact is in the recycle bin. Restore the contact before restoring this participant."
)
DELETED_OPPORTUNITY_DETAIL = "Opportunity is in the recycle bin"
CONCURRENT_CHANGE_DETAIL = (
    "The participants on this deal changed while you were editing. Reload and try again."
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


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
        # Null on an active participant; set on rows returned by the removed list,
        # which is what makes a removal recoverable rather than just reversible.
        "removed_at": link.deleted_at,
        "removed_by_user_id": link.deleted_by_user_id,
    }


def serialize_participants(links: list[SalesOpportunityContact]) -> list[dict]:
    return [serialize_participant(link) for link in links]


def list_removed_opportunity_participants(
    db: Session,
    *,
    tenant_id: int,
    opportunity_id: int,
) -> list[SalesOpportunityContact]:
    """Participants that were removed from a deal and can be restored."""

    return opportunity_contacts_repository.list_removed_for_opportunity(
        db, tenant_id=tenant_id, opportunity_id=opportunity_id
    )


def legacy_client_name(contact: SalesContact | None) -> str:
    """`sales_opportunities.client` exactly as the legacy create/update path writes it.

    `opportunities_services` imports this module, so the shared helper lives here to
    keep that dependency one-way and to guarantee a primary change made from the
    participant side produces the same denormalized display name as one made
    through the legacy `contact_id` field.
    """

    return contact_display_name(contact) or LEGACY_CLIENT_FALLBACK


# ---------------------------------------------------------------------------
# Phase 2 — explicit participant operations
#
# Every operation below follows the same shape, and the order matters:
#
# 1. lock the parent deal so concurrent relationship writes serialize;
# 2. validate tenant ownership of both records and the caller's intent;
# 3. mutate, keeping the legacy primary contact in step;
# 4. write the audit entry in the same transaction as the mutation;
# 5. commit once, then emit the domain event best-effort.
#
# Permission checks are not here: they are route concerns and are enforced before
# the service is reached (opportunity `view`/`edit`/`restore` plus Contacts
# view/link access). Tenant scoping is here, because it is a domain invariant and
# must hold for every caller including background and test callers.
# ---------------------------------------------------------------------------


def _lock_opportunity(db: Session, opportunity: SalesOpportunity) -> SalesOpportunity:
    """Serialize relationship writes for one deal, and refuse a deleted one.

    The route already loaded the deal; re-reading it under a row lock closes the
    window between that read and this write, in which the deal could have been
    moved to the recycle bin or had its primary contact changed by someone else.
    """

    locked = opportunities_repository.lock_opportunity(
        db, tenant_id=opportunity.tenant_id, opportunity_id=opportunity.opportunity_id
    )
    if locked is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Opportunity not found")
    if locked.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=DELETED_OPPORTUNITY_DETAIL)
    return locked


def _normalize_role_or_400(role_key: str | None) -> str:
    try:
        return normalize_opportunity_contact_role(role_key)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


def _require_active_contact(db: Session, *, tenant_id: int, contact_id: int) -> SalesContact:
    """Resolve a contact the caller is deliberately linking.

    Cross-tenant and recycled contacts fail the same way, so the error cannot be
    used to prove that a contact id exists in another tenant.
    """

    contact = opportunity_contacts_repository.get_active_contact(
        db, tenant_id=tenant_id, contact_id=contact_id
    )
    if contact is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=CROSS_TENANT_CONTACT_DETAIL
        )
    return contact


def _get_participant_or_404(
    db: Session,
    *,
    opportunity: SalesOpportunity,
    link_id: int,
    include_removed: bool = False,
) -> SalesOpportunityContact:
    link = opportunity_contacts_repository.get_link_by_id(
        db,
        tenant_id=opportunity.tenant_id,
        opportunity_id=opportunity.opportunity_id,
        link_id=link_id,
        include_removed=include_removed,
    )
    if link is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=REMOVED_PARTICIPANT_NOT_FOUND_DETAIL if include_removed else PARTICIPANT_NOT_FOUND_DETAIL,
        )
    return link


def _flush_or_conflict(db: Session) -> None:
    """Turn a lost race into a 409 instead of a 500.

    The row lock serializes callers that go through this service, but the database
    constraints — one link per contact, one primary per deal — are the real
    guarantee, and they also cover writers that predate this API.
    """

    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=CONCURRENT_CHANGE_DETAIL
        ) from exc


def _audit_snapshot(link: SalesOpportunityContact | None) -> dict | None:
    """Compact relationship state for the audit trail.

    Deliberately not `serialize_participant`: the audit records the relationship,
    not a copy of the contact record, which has its own history and its own
    field-level permissions.
    """

    if link is None:
        return None
    return {
        "id": link.id,
        "opportunity_id": link.opportunity_id,
        "contact_id": link.contact_id,
        "contact_name": contact_display_name(link.contact),
        "role_key": link.role_key,
        "role_label": opportunity_contact_role_label(link.role_key),
        "is_primary": bool(link.is_primary),
        "removed_at": link.deleted_at,
    }


def _log_participant_change(
    db: Session,
    *,
    opportunity: SalesOpportunity,
    actor_user_id: int | None,
    action: str,
    description: str,
    before_state: dict | None,
    after_state: dict | None,
) -> None:
    """Audit a relationship change against the deal it belongs to.

    `commit=False` so the history entry and the relationship change land in one
    transaction: an audited change that rolled back, or a change with no history,
    would both be worse than failing the request.
    """

    log_activity(
        db,
        tenant_id=opportunity.tenant_id,
        actor_user_id=actor_user_id,
        module_key=MODULE_KEY,
        entity_type=ENTITY_TYPE,
        entity_id=opportunity.opportunity_id,
        action=action,
        description=description,
        before_state=before_state,
        after_state=after_state,
        commit=False,
    )


def _emit_participant_event(
    db: Session,
    *,
    opportunity: SalesOpportunity,
    current_user,
    event_type: str,
    link: SalesOpportunityContact,
    extra: dict | None = None,
) -> None:
    """Announce a relationship change after it is durable.

    Emitted post-commit and best-effort: `safe_emit_crm_event` rolls back on
    failure, which must never be able to undo the relationship change itself.
    Role changes emit nothing — the workstream asks for added/removed/primary
    events and explicitly warns against noisy derived-display events.
    """

    safe_emit_crm_event(
        db,
        tenant_id=opportunity.tenant_id,
        actor_user_id=getattr(current_user, "id", None),
        event_type=event_type,
        entity_type=ENTITY_TYPE,
        entity_id=opportunity.opportunity_id,
        payload={
            **actor_payload(current_user),
            "opportunity_id": opportunity.opportunity_id,
            "deal_name": opportunity.opportunity_name,
            "contact_id": link.contact_id,
            "contact_name": contact_display_name(link.contact),
            "role_key": link.role_key,
            "is_primary": bool(link.is_primary),
            "href": f"/dashboard/sales/opportunities/{opportunity.opportunity_id}",
            **(extra or {}),
        },
    )


def _promote_to_primary(
    db: Session,
    *,
    opportunity: SalesOpportunity,
    link: SalesOpportunityContact,
    contact: SalesContact,
) -> None:
    """Move the primary flag onto `link` and carry the legacy field with it.

    Demotion is flushed before promotion because the partial unique index allows
    only one primary row per deal at a time. The previous primary keeps its
    association row: losing the primary title is not leaving the deal.

    `organization_id` is deliberately not touched. The legacy create path fills a
    blank organization from the contact; doing that here would silently move a
    deal to a different account as a side effect of a participant change, which is
    downstream propagation and belongs to a later phase.
    """

    for existing_primary in opportunity_contacts_repository.list_primary_links(
        db, tenant_id=opportunity.tenant_id, opportunity_id=opportunity.opportunity_id
    ):
        if existing_primary.id == link.id:
            continue
        existing_primary.is_primary = False
        db.add(existing_primary)
    _flush_or_conflict(db)

    link.is_primary = True
    db.add(link)
    opportunity.contact_id = link.contact_id
    opportunity.client = legacy_client_name(contact)
    db.add(opportunity)
    _flush_or_conflict(db)


def add_participant(
    db: Session,
    *,
    opportunity: SalesOpportunity,
    contact_id: int,
    role_key: str | None = None,
    is_primary: bool = False,
    current_user=None,
) -> SalesOpportunityContact:
    """Put a contact on a deal in a stated role.

    A contact previously removed from this deal is revived rather than re-created:
    the unique link constraint counts removed rows, and reviving preserves who
    first established the relationship and when.
    """

    opportunity = _lock_opportunity(db, opportunity)
    role = _normalize_role_or_400(role_key)
    contact = _require_active_contact(
        db, tenant_id=opportunity.tenant_id, contact_id=contact_id
    )
    actor_user_id = getattr(current_user, "id", None)

    existing = opportunity_contacts_repository.get_link(
        db,
        tenant_id=opportunity.tenant_id,
        opportunity_id=opportunity.opportunity_id,
        contact_id=contact_id,
    )
    if existing is not None and existing.deleted_at is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=DUPLICATE_PARTICIPANT_DETAIL
        )

    before_state = _audit_snapshot(existing)
    if existing is not None:
        existing.deleted_at = None
        existing.deleted_by_user_id = None
        existing.role_key = role
        link = existing
    else:
        link = SalesOpportunityContact(
            tenant_id=opportunity.tenant_id,
            opportunity_id=opportunity.opportunity_id,
            contact_id=contact_id,
            role_key=role,
            is_primary=False,
            created_by_user_id=actor_user_id,
        )
    db.add(link)
    _flush_or_conflict(db)

    if is_primary:
        _promote_to_primary(db, opportunity=opportunity, link=link, contact=contact)

    name = contact_display_name(contact) or f"contact {contact_id}"
    _log_participant_change(
        db,
        opportunity=opportunity,
        actor_user_id=actor_user_id,
        action="participant_add",
        description=f"Added {name} to opportunity {opportunity.opportunity_name} as {opportunity_contact_role_label(role)}",
        before_state=before_state,
        after_state=_audit_snapshot(link),
    )
    db.commit()
    db.refresh(link)

    _emit_participant_event(
        db,
        opportunity=opportunity,
        current_user=current_user,
        event_type="opportunity.participant_added",
        link=link,
        extra={"restored": before_state is not None},
    )
    return link


def change_participant_role(
    db: Session,
    *,
    opportunity: SalesOpportunity,
    link_id: int,
    role_key: str,
    current_user=None,
) -> SalesOpportunityContact:
    """Change the role a participant plays, primary or not.

    Role and primary are independent: the primary contact can be the technical
    evaluator, and changing a role never moves the primary flag or the legacy
    `contact_id`.
    """

    opportunity = _lock_opportunity(db, opportunity)
    role = _normalize_role_or_400(role_key)
    link = _get_participant_or_404(db, opportunity=opportunity, link_id=link_id)

    if link.role_key == role:
        return link

    before_state = _audit_snapshot(link)
    link.role_key = role
    db.add(link)
    _flush_or_conflict(db)

    name = contact_display_name(link.contact) or f"contact {link.contact_id}"
    _log_participant_change(
        db,
        opportunity=opportunity,
        actor_user_id=getattr(current_user, "id", None),
        action="participant_role_change",
        description=(
            f"Changed {name}'s role on opportunity {opportunity.opportunity_name} to "
            f"{opportunity_contact_role_label(role)}"
        ),
        before_state=before_state,
        after_state=_audit_snapshot(link),
    )
    db.commit()
    db.refresh(link)
    return link


def set_primary_participant(
    db: Session,
    *,
    opportunity: SalesOpportunity,
    link_id: int,
    current_user=None,
) -> SalesOpportunityContact:
    """Make an existing participant the deal's primary contact.

    This is the participant-side writer of the legacy `contact_id` field, so the
    compatibility mirror and this operation agree on the same single-primary
    invariant from either direction.
    """

    opportunity = _lock_opportunity(db, opportunity)
    link = _get_participant_or_404(db, opportunity=opportunity, link_id=link_id)
    if link.is_primary and opportunity.contact_id == link.contact_id:
        return link

    # A participant whose contact has since been recycled cannot become the face of
    # the deal; the legacy field and every downstream reader would point at a
    # deleted record.
    contact = _require_active_contact(
        db, tenant_id=opportunity.tenant_id, contact_id=link.contact_id
    )

    before_state = _audit_snapshot(link)
    previous_contact_id = opportunity.contact_id
    _promote_to_primary(db, opportunity=opportunity, link=link, contact=contact)

    name = contact_display_name(contact) or f"contact {link.contact_id}"
    _log_participant_change(
        db,
        opportunity=opportunity,
        actor_user_id=getattr(current_user, "id", None),
        action="participant_primary_change",
        description=f"Made {name} the primary contact on opportunity {opportunity.opportunity_name}",
        before_state={"primary_contact_id": previous_contact_id, "participant": before_state},
        after_state={"primary_contact_id": opportunity.contact_id, "participant": _audit_snapshot(link)},
    )
    db.commit()
    db.refresh(link)

    _emit_participant_event(
        db,
        opportunity=opportunity,
        current_user=current_user,
        event_type="opportunity.primary_contact_changed",
        link=link,
        extra={"previous_contact_id": previous_contact_id},
    )
    return link


def remove_participant(
    db: Session,
    *,
    opportunity: SalesOpportunity,
    link_id: int,
    current_user=None,
) -> SalesOpportunityContact:
    """Take a contact off a deal, recoverably.

    The primary participant cannot be removed. A deal always has a primary contact
    — `contact_id` is required on create and cannot be nulled on update — so
    removing it would either break that invariant or silently pick a successor.
    Promoting the intended replacement first is the explicit alternative.
    """

    opportunity = _lock_opportunity(db, opportunity)
    link = _get_participant_or_404(db, opportunity=opportunity, link_id=link_id)

    if link.is_primary or opportunity.contact_id == link.contact_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=REMOVE_PRIMARY_DETAIL)

    before_state = _audit_snapshot(link)
    link.deleted_at = _utc_now()
    link.deleted_by_user_id = getattr(current_user, "id", None)
    db.add(link)
    _flush_or_conflict(db)

    name = contact_display_name(link.contact) or f"contact {link.contact_id}"
    _log_participant_change(
        db,
        opportunity=opportunity,
        actor_user_id=getattr(current_user, "id", None),
        action="participant_remove",
        description=f"Removed {name} from opportunity {opportunity.opportunity_name}",
        before_state=before_state,
        after_state=_audit_snapshot(link),
    )
    db.commit()
    db.refresh(link)

    _emit_participant_event(
        db,
        opportunity=opportunity,
        current_user=current_user,
        event_type="opportunity.participant_removed",
        link=link,
    )
    return link


def restore_participant(
    db: Session,
    *,
    opportunity: SalesOpportunity,
    link_id: int,
    current_user=None,
) -> SalesOpportunityContact:
    """Put a removed participant back on the deal in the role it had.

    A restored participant never comes back as primary — it could not have been
    primary when it was removed — so the single-primary invariant is untouched.
    """

    opportunity = _lock_opportunity(db, opportunity)
    link = _get_participant_or_404(
        db, opportunity=opportunity, link_id=link_id, include_removed=True
    )
    if link.deleted_at is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Participant is already on this deal"
        )
    # Restoring a link to a recycled contact would produce a participant that
    # cannot be shown, so the contact has to be restored first.
    contact = opportunity_contacts_repository.get_active_contact(
        db, tenant_id=opportunity.tenant_id, contact_id=link.contact_id
    )
    if contact is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=DELETED_CONTACT_RESTORE_DETAIL
        )

    before_state = _audit_snapshot(link)
    link.deleted_at = None
    link.deleted_by_user_id = None
    db.add(link)
    _flush_or_conflict(db)

    name = contact_display_name(contact) or f"contact {link.contact_id}"
    _log_participant_change(
        db,
        opportunity=opportunity,
        actor_user_id=getattr(current_user, "id", None),
        action="participant_restore",
        description=f"Restored {name} as a participant on opportunity {opportunity.opportunity_name}",
        before_state=before_state,
        after_state=_audit_snapshot(link),
    )
    db.commit()
    db.refresh(link)

    _emit_participant_event(
        db,
        opportunity=opportunity,
        current_user=current_user,
        event_type="opportunity.participant_added",
        link=link,
        extra={"restored": True},
    )
    return link
