import json
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.pagination import Pagination
from app.core.postgres_search import apply_trigram_search, searchable_text
from app.modules.sales.models import SalesOpportunity, SalesContact, SalesOrganization
from app.modules.user_management.models import User

APP_DIR = Path(__file__).resolve().parents[3]
OPPORTUNITY_ATTACHMENTS_DIR = APP_DIR / "uploads" / "opportunities-attachments"
OPPORTUNITY_ATTACHMENTS_DIR.mkdir(parents=True, exist_ok=True)


def parse_attachment_paths(value: str | list[str] | None) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if item]
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return [str(item) for item in parsed if item]
        except json.JSONDecodeError:
            pass
        if value:
            return [value]
    return []


def _serialize_attachment_paths(value: str | list[str] | None) -> str | None:
    paths = parse_attachment_paths(value)
    if not paths:
        return None
    return json.dumps(paths)


def _ensure_user(db: Session, user_id: int):
    exists = db.query(User.id).filter(User.id == user_id).first()
    if not exists:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assigned user not found")


def _ensure_contact(db: Session, contact_id: int):
    exists = db.query(SalesContact.contact_id).filter(SalesContact.contact_id == contact_id).first()
    if not exists:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Contact not found")


def _ensure_organization(db: Session, organization_id: int):
    exists = db.query(SalesOrganization.org_id).filter(SalesOrganization.org_id == organization_id).first()
    if not exists:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Organization not found")


def _apply_search_filter(query, search: str | None):
    if not search:
        return query, None

    document = searchable_text(
        SalesOpportunity.opportunity_name,
        SalesOpportunity.client,
        SalesOpportunity.sales_stage,
        SalesOpportunity.campaign_type,
        SalesOpportunity.target_geography,
        SalesOpportunity.target_audience,
        SalesOpportunity.tactics,
    )
    return apply_trigram_search(query, search=search, document=document)


def list_opportunities(
    db: Session,
    pagination: Pagination,
    search: str | None = None,
) -> tuple[list[SalesOpportunity], int]:
    query, rank = _apply_search_filter(db.query(SalesOpportunity), search)
    total_count = query.count()
    if rank is not None:
        items = (
            query.order_by(rank.desc(), SalesOpportunity.created_time.desc())
            .offset(pagination.offset)
            .limit(pagination.limit)
            .all()
        )
    else:
        items = (
            query.order_by(SalesOpportunity.created_time.desc())
            .offset(pagination.offset)
            .limit(pagination.limit)
            .all()
        )
    return items, total_count


def get_opportunity_or_404(db: Session, opportunity_id: int) -> SalesOpportunity:
    opportunity = (
        db.query(SalesOpportunity)
        .filter(SalesOpportunity.opportunity_id == opportunity_id)
        .first()
    )
    if not opportunity:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Opportunity not found")
    return opportunity


def create_opportunity(db: Session, data: dict) -> SalesOpportunity:
    contact_id = data.get("contact_id")
    if contact_id is not None:
        _ensure_contact(db, contact_id)

    organization_id = data.get("organization_id")
    if organization_id is not None:
        _ensure_organization(db, organization_id)

    assigned_to = data.get("assigned_to")
    if assigned_to is not None:
        _ensure_user(db, assigned_to)

    if "attachments" in data:
        data["attachments"] = _serialize_attachment_paths(data.get("attachments"))

    opportunity = SalesOpportunity(**data)
    db.add(opportunity)
    db.commit()
    db.refresh(opportunity)
    return opportunity


def update_opportunity(db: Session, opportunity: SalesOpportunity, data: dict) -> SalesOpportunity:
    if "contact_id" in data and data["contact_id"] is not None:
        _ensure_contact(db, data["contact_id"])
    if "organization_id" in data and data["organization_id"] is not None:
        _ensure_organization(db, data["organization_id"])
    if "assigned_to" in data and data["assigned_to"] is not None:
        _ensure_user(db, data["assigned_to"])
    if "attachments" in data:
        data["attachments"] = _serialize_attachment_paths(data.get("attachments"))

    for field, value in data.items():
        setattr(opportunity, field, value)

    db.commit()
    db.refresh(opportunity)
    return opportunity


def delete_opportunity(db: Session, opportunity: SalesOpportunity):
    db.delete(opportunity)
    db.commit()
