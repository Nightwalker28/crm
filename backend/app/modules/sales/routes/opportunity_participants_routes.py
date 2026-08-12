"""Explicit participant management for an opportunity.

Phase 2 of `docs/crm-evolution/05-relationships-data-model.md`. The routes here own
HTTP, auth, and serialization only; the relationship invariants, tenant scoping,
audit history, and the legacy primary-contact compatibility live in
`opportunity_contacts_services`.

Access is the three standard layers plus one more. Seeing a deal is not permission
to see the people on it, so every route additionally requires the same module
availability and Contacts `view` access as opening the Contacts module directly —
the `require_linked_record_access` bar, applied to reads as well as writes because
a participant list is contact data. Creating a new Contact from a participant
surface is a Contacts `create` concern and stays on the Contacts routes.

Route order matters: this router is mounted before the opportunities router so that
`/opportunities/participant-roles` is matched as a literal rather than swallowed by
`/opportunities/{opportunity_id}`.
"""

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.access_control import PermissionPolicy
from app.core.database import get_db
from app.core.permissions import require_action_access, require_linked_record_access, require_module_access
from app.core.security import require_user
from app.modules.sales.opportunity_contact_roles import opportunity_contact_role_catalog
from app.modules.sales.schema import (
    OpportunityContactParticipant,
    OpportunityContactRoleCatalogResponse,
    OpportunityParticipantCreate,
    OpportunityParticipantListResponse,
    OpportunityParticipantRoleUpdate,
)
from app.modules.sales.services import opportunity_contacts_services
from app.modules.sales.services.opportunities_services import get_opportunity_or_404

router = APIRouter(prefix="/opportunities", tags=["Sales"])

MODULE_KEY = "sales_opportunities"
CONTACTS_MODULE_KEY = "sales_contacts"


def _require_contact_link_access(db: Session, current_user) -> None:
    require_linked_record_access(db, user=current_user, module_key=CONTACTS_MODULE_KEY)


def _can_manage_participants(db: Session, current_user) -> bool:
    """Whether this reader could act on the list they are being shown."""

    if current_user is None:
        return False
    return PermissionPolicy(db, current_user).can_perform_action(MODULE_KEY, "edit")


def _serialize(link) -> OpportunityContactParticipant:
    return OpportunityContactParticipant.model_validate(
        opportunity_contacts_services.serialize_participant(link)
    )


@router.get("/participant-roles", response_model=OpportunityContactRoleCatalogResponse)
def list_opportunity_participant_roles(
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(MODULE_KEY)),
    require_permission=Depends(require_action_access(MODULE_KEY, "view")),
):
    """The sales-domain role catalog, so clients do not hardcode the labels."""

    return OpportunityContactRoleCatalogResponse(results=opportunity_contact_role_catalog())


@router.get("/{opportunity_id}/participants", response_model=OpportunityParticipantListResponse)
def list_opportunity_participants(
    opportunity_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(MODULE_KEY)),
    require_permission=Depends(require_action_access(MODULE_KEY, "view")),
):
    _require_contact_link_access(db, current_user)
    opportunity = get_opportunity_or_404(db, opportunity_id, tenant_id=current_user.tenant_id)
    links = opportunity_contacts_services.list_opportunity_participants(
        db, tenant_id=opportunity.tenant_id, opportunity_id=opportunity.opportunity_id
    )
    return OpportunityParticipantListResponse(
        results=[_serialize(link) for link in links],
        can_manage=_can_manage_participants(db, current_user),
    )


@router.get("/{opportunity_id}/participants/recycle", response_model=OpportunityParticipantListResponse)
def list_removed_opportunity_participants(
    opportunity_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(MODULE_KEY)),
    require_permission=Depends(require_action_access(MODULE_KEY, "restore")),
):
    """Removed participants, gated on `restore` like the module's recycle bin."""

    _require_contact_link_access(db, current_user)
    opportunity = get_opportunity_or_404(db, opportunity_id, tenant_id=current_user.tenant_id)
    links = opportunity_contacts_services.list_removed_opportunity_participants(
        db, tenant_id=opportunity.tenant_id, opportunity_id=opportunity.opportunity_id
    )
    return OpportunityParticipantListResponse(
        results=[_serialize(link) for link in links],
        can_manage=_can_manage_participants(db, current_user),
    )


@router.post(
    "/{opportunity_id}/participants",
    response_model=OpportunityContactParticipant,
    status_code=status.HTTP_201_CREATED,
)
def add_opportunity_participant(
    opportunity_id: int,
    payload: OpportunityParticipantCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(MODULE_KEY)),
    require_permission=Depends(require_action_access(MODULE_KEY, "edit")),
):
    _require_contact_link_access(db, current_user)
    opportunity = get_opportunity_or_404(db, opportunity_id, tenant_id=current_user.tenant_id)
    link = opportunity_contacts_services.add_participant(
        db,
        opportunity=opportunity,
        contact_id=payload.contact_id,
        role_key=payload.role_key,
        is_primary=payload.is_primary,
        current_user=current_user,
    )
    return _serialize(link)


@router.patch(
    "/{opportunity_id}/participants/{participant_id}/role",
    response_model=OpportunityContactParticipant,
)
def change_opportunity_participant_role(
    opportunity_id: int,
    participant_id: int,
    payload: OpportunityParticipantRoleUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(MODULE_KEY)),
    require_permission=Depends(require_action_access(MODULE_KEY, "edit")),
):
    _require_contact_link_access(db, current_user)
    opportunity = get_opportunity_or_404(db, opportunity_id, tenant_id=current_user.tenant_id)
    link = opportunity_contacts_services.change_participant_role(
        db,
        opportunity=opportunity,
        link_id=participant_id,
        role_key=payload.role_key,
        current_user=current_user,
    )
    return _serialize(link)


@router.post(
    "/{opportunity_id}/participants/{participant_id}/primary",
    response_model=OpportunityContactParticipant,
)
def set_primary_opportunity_participant(
    opportunity_id: int,
    participant_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(MODULE_KEY)),
    require_permission=Depends(require_action_access(MODULE_KEY, "edit")),
):
    """Promote a participant, which also moves the legacy `contact_id` on the deal."""

    _require_contact_link_access(db, current_user)
    opportunity = get_opportunity_or_404(db, opportunity_id, tenant_id=current_user.tenant_id)
    link = opportunity_contacts_services.set_primary_participant(
        db,
        opportunity=opportunity,
        link_id=participant_id,
        current_user=current_user,
    )
    return _serialize(link)


@router.delete(
    "/{opportunity_id}/participants/{participant_id}",
    response_model=OpportunityContactParticipant,
)
def remove_opportunity_participant(
    opportunity_id: int,
    participant_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(MODULE_KEY)),
    require_permission=Depends(require_action_access(MODULE_KEY, "delete")),
):
    """Remove a participant recoverably.

    Gated on `delete` rather than `edit`: this is the operation the recycle-bin
    routes below undo, and it should require the same authority as any other
    recoverable delete in the module.
    """

    _require_contact_link_access(db, current_user)
    opportunity = get_opportunity_or_404(db, opportunity_id, tenant_id=current_user.tenant_id)
    link = opportunity_contacts_services.remove_participant(
        db,
        opportunity=opportunity,
        link_id=participant_id,
        current_user=current_user,
    )
    return _serialize(link)


@router.post(
    "/{opportunity_id}/participants/{participant_id}/restore",
    response_model=OpportunityContactParticipant,
)
def restore_opportunity_participant(
    opportunity_id: int,
    participant_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(MODULE_KEY)),
    require_permission=Depends(require_action_access(MODULE_KEY, "restore")),
):
    _require_contact_link_access(db, current_user)
    opportunity = get_opportunity_or_404(db, opportunity_id, tenant_id=current_user.tenant_id)
    link = opportunity_contacts_services.restore_participant(
        db,
        opportunity=opportunity,
        link_id=participant_id,
        current_user=current_user,
    )
    return _serialize(link)
