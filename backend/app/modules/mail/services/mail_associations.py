"""CRM record associations for mail messages.

This module owns mail/message linkage persistence and its invariants:

- a link exists only because someone created it deliberately (sending with
  record context, or an explicit link action) — never because an address
  matched;
- a link always points at a record in the same tenant that the acting user is
  allowed to view;
- a message may carry several links, of which at most one is ``primary``;
- the primary link is mirrored onto ``MailMessage.source_*`` so inbox rendering
  and search keep working without a join.

Consumers (the activity projection, and later the contextual composer) read
these rows; they do not create competing link models.
"""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.access_control import require_role_module_action_access
from app.modules.mail.models import MailMessage, MailRecordAssociation
from app.modules.mail.repositories import mail_repository
from app.modules.platform.services.record_comments import (
    get_record_comment_module_config,
    get_record_reference,
)
from app.modules.user_management.models import User

PRIMARY = "primary"
RELATED = "related"
ASSOCIATION_TYPES = (PRIMARY, RELATED)

UNAVAILABLE_RECORD_DETAIL = "Selected record is not available."


def normalize_link_value(value) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def record_label(record, config: dict) -> str:
    label = getattr(record, config["label_field"], None)
    if label:
        return str(label)
    return f"{config['entity_type']} #{getattr(record, config['id_field'])}"


def resolve_link_target(db: Session, *, current_user: User, module_key: str, entity_id: str) -> dict:
    """Validate a link target: supported module, viewer permission, same tenant.

    Every failure collapses to one message. Distinguishing "no permission" from
    "wrong tenant" here would confirm that a record id exists elsewhere.
    """

    try:
        require_role_module_action_access(db, user=current_user, module_key=module_key, action="view")
        config = get_record_comment_module_config(module_key)
        record = get_record_reference(
            db,
            tenant_id=current_user.tenant_id,
            module_key=module_key,
            entity_id=entity_id,
        )
    except HTTPException as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=UNAVAILABLE_RECORD_DETAIL) from exc
    except (PermissionError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=UNAVAILABLE_RECORD_DETAIL) from exc

    return {
        "module_key": module_key,
        "entity_id": str(entity_id),
        "entity_type": config["entity_type"],
        "label": record_label(record, config),
    }


def get_owned_message_or_404(db: Session, *, current_user: User, message_id: int) -> MailMessage:
    """Mailbox content stays private to the connected user.

    Being able to see a CRM record that someone else linked mail to does not
    grant access to that mailbox, so the owner check is part of the lookup.
    """

    message = mail_repository.get_message(
        db,
        tenant_id=current_user.tenant_id,
        owner_user_id=current_user.id,
        message_id=message_id,
    )
    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mail message not found")
    return message


def serialize_mail_association(association: MailRecordAssociation) -> dict:
    return {
        "id": association.id,
        "message_id": association.message_id,
        "module_key": association.module_key,
        "entity_id": association.entity_id,
        "association_type": association.association_type,
        "record_label": association.record_label,
        "created_by_user_id": association.created_by_user_id,
        "created_at": association.created_at,
    }


def _apply_primary_mirror(message: MailMessage, target: dict | None) -> None:
    message.source_module_key = target["module_key"] if target else None
    message.source_entity_id = target["entity_id"] if target else None
    message.source_label = target["label"] if target else None


def upsert_association(
    db: Session,
    *,
    current_user: User,
    message: MailMessage,
    target: dict,
    association_type: str = RELATED,
) -> MailRecordAssociation:
    """Create or update one link. Flushes; the caller owns the transaction."""

    if association_type not in ASSOCIATION_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported association type.")

    if association_type == PRIMARY:
        # A message has one primary. Any earlier primary keeps its link and is
        # demoted, so designating a new contextual record never silently drops
        # an association a user made on purpose.
        for existing in mail_repository.list_message_associations(
            db,
            tenant_id=current_user.tenant_id,
            message_id=message.id,
        ):
            if existing.association_type == PRIMARY and (
                existing.module_key != target["module_key"] or existing.entity_id != target["entity_id"]
            ):
                existing.association_type = RELATED
                db.add(existing)
        db.flush()

    association = mail_repository.find_message_association(
        db,
        tenant_id=current_user.tenant_id,
        message_id=message.id,
        module_key=target["module_key"],
        entity_id=target["entity_id"],
    )
    if association is None:
        association = MailRecordAssociation(
            tenant_id=current_user.tenant_id,
            message_id=message.id,
            module_key=target["module_key"],
            entity_id=target["entity_id"],
            created_by_user_id=current_user.id,
        )
    # Re-linking an existing pair refreshes the label and may promote it, but
    # never creates a second row: the unique constraint is the contract.
    association.association_type = association_type
    association.record_label = target["label"]
    db.add(association)

    if association_type == PRIMARY:
        _apply_primary_mirror(message, target)
        db.add(message)
    db.flush()
    return association


def list_mail_message_associations(
    db: Session,
    *,
    current_user: User,
    message_id: int,
) -> list[MailRecordAssociation]:
    message = get_owned_message_or_404(db, current_user=current_user, message_id=message_id)
    return mail_repository.list_message_associations(
        db,
        tenant_id=current_user.tenant_id,
        message_id=message.id,
    )


def associate_mail_message(
    db: Session,
    *,
    current_user: User,
    message_id: int,
    payload: dict,
) -> list[MailRecordAssociation]:
    """Link a message — or its whole thread — to a CRM record."""

    message = get_owned_message_or_404(db, current_user=current_user, message_id=message_id)
    module_key = normalize_link_value(payload.get("module_key"))
    entity_id = normalize_link_value(payload.get("entity_id"))
    if not module_key or not entity_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Choose a record to link this mail message.",
        )
    association_type = normalize_link_value(payload.get("association_type")) or RELATED
    target = resolve_link_target(db, current_user=current_user, module_key=module_key, entity_id=entity_id)

    messages = [message]
    if payload.get("apply_to_thread"):
        # Thread membership is provider-stated, not guessed: same mailbox, same
        # provider thread id. Messages the provider never threaded stay alone.
        thread_messages = mail_repository.list_thread_messages(
            db,
            tenant_id=current_user.tenant_id,
            owner_user_id=current_user.id,
            connection_id=message.connection_id,
            provider_thread_id=message.provider_thread_id,
        )
        messages = thread_messages or [message]

    associations = [
        upsert_association(
            db,
            current_user=current_user,
            message=thread_message,
            target=target,
            association_type=association_type,
        )
        for thread_message in messages
    ]
    db.commit()
    for association in associations:
        db.refresh(association)
    return associations


def disassociate_mail_message(
    db: Session,
    *,
    current_user: User,
    message_id: int,
    association_id: int,
) -> MailMessage:
    """Remove one link.

    Removing the primary clears the mirror without promoting a replacement: the
    product must not choose a contextual record on the user's behalf.
    """

    message = get_owned_message_or_404(db, current_user=current_user, message_id=message_id)
    association = mail_repository.get_message_association(
        db,
        tenant_id=current_user.tenant_id,
        message_id=message.id,
        association_id=association_id,
    )
    if association is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mail association not found")

    was_primary = association.association_type == PRIMARY
    db.delete(association)
    if was_primary:
        _apply_primary_mirror(message, None)
        db.add(message)
    db.commit()
    db.refresh(message)
    return message
