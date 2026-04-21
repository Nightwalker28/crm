from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.core.pagination import Pagination
from app.modules.platform.models import RecordComment
from app.modules.sales.models import SalesContact, SalesOpportunity, SalesOrganization

RECORD_COMMENT_MODULES = {
    "sales_contacts": {
        "model": SalesContact,
        "id_field": "contact_id",
        "entity_type": "sales_contact",
        "label_field": "primary_email",
    },
    "sales_organizations": {
        "model": SalesOrganization,
        "id_field": "org_id",
        "entity_type": "sales_organization",
        "label_field": "org_name",
    },
    "sales_opportunities": {
        "model": SalesOpportunity,
        "id_field": "opportunity_id",
        "entity_type": "sales_opportunity",
        "label_field": "opportunity_name",
    },
}


def get_record_comment_module_config(module_key: str) -> dict:
    config = RECORD_COMMENT_MODULES.get(module_key)
    if not config:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported record comments module.")
    return config


def get_record_reference(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    entity_id: str | int,
):
    config = get_record_comment_module_config(module_key)
    model = config["model"]
    id_field = getattr(model, config["id_field"])
    try:
        normalized_entity_id = int(entity_id)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid record identifier.") from exc
    record = (
        db.query(model)
        .filter(
            model.tenant_id == tenant_id,
            id_field == normalized_entity_id,
            model.deleted_at.is_(None),
        )
        .first()
    )
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found.")
    return record


def list_record_comments(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    entity_id: str | int,
    pagination: Pagination,
) -> tuple[list[RecordComment], int]:
    get_record_reference(db, tenant_id=tenant_id, module_key=module_key, entity_id=entity_id)

    query = (
        db.query(RecordComment)
        .options(joinedload(RecordComment.actor))
        .filter(
            RecordComment.tenant_id == tenant_id,
            RecordComment.module_key == module_key,
            RecordComment.entity_id == str(entity_id),
        )
    )
    total = query.count()
    items = (
        query.order_by(RecordComment.created_at.desc(), RecordComment.id.desc())
        .offset(pagination.offset)
        .limit(pagination.limit)
        .all()
    )
    return items, total


def create_record_comment(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int | None,
    module_key: str,
    entity_id: str | int,
    body: str,
) -> tuple[RecordComment, object]:
    normalized_body = body.strip()
    if not normalized_body:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Note body cannot be empty.")

    record = get_record_reference(db, tenant_id=tenant_id, module_key=module_key, entity_id=entity_id)
    comment = RecordComment(
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key=module_key,
        entity_id=str(entity_id),
        body=normalized_body,
    )
    db.add(comment)
    db.commit()
    comment = (
        db.query(RecordComment)
        .options(joinedload(RecordComment.actor))
        .filter(RecordComment.id == comment.id, RecordComment.tenant_id == tenant_id)
        .first()
    )
    return comment, record


def get_record_comment_or_404(
    db: Session,
    *,
    comment_id: int,
    tenant_id: int,
) -> RecordComment:
    comment = (
        db.query(RecordComment)
        .options(joinedload(RecordComment.actor))
        .filter(
            RecordComment.id == comment_id,
            RecordComment.tenant_id == tenant_id,
        )
        .first()
    )
    if not comment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record comment not found.")
    return comment


def delete_record_comment(
    db: Session,
    *,
    comment: RecordComment,
    tenant_id: int,
):
    record = get_record_reference(
        db,
        tenant_id=tenant_id,
        module_key=comment.module_key,
        entity_id=comment.entity_id,
    )
    db.delete(comment)
    db.commit()
    return record
