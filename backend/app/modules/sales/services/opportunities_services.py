import json
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.pagination import Pagination
from app.core.module_search import apply_ranked_search
from app.core.postgres_search import searchable_text
from app.modules.platform.services.custom_fields import (
    hydrate_custom_field_record,
    hydrate_custom_field_records,
    load_custom_field_values_with_fallback,
    save_custom_field_values,
    validate_custom_field_payload,
)
from app.modules.sales.models import SalesOpportunity, SalesContact, SalesOrganization
from app.modules.user_management.services.profile import get_company_operating_currencies
from app.modules.user_management.models import User

BACKEND_DIR = Path(__file__).resolve().parents[4]
OPPORTUNITY_ATTACHMENTS_DIR = BACKEND_DIR / "uploads" / "opportunities-attachments"
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


def _get_contact_or_404(db: Session, contact_id: int) -> SalesContact:
    contact = (
        db.query(SalesContact)
        .filter(SalesContact.contact_id == contact_id, SalesContact.deleted_at.is_(None))
        .first()
    )
    if not contact:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Contact not found")
    return contact


def _ensure_organization(db: Session, organization_id: int):
    exists = db.query(SalesOrganization.org_id).filter(SalesOrganization.org_id == organization_id).first()
    if not exists:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Organization not found")


def _apply_search_filter(query, search: str | None):
    document = searchable_text(
        SalesOpportunity.opportunity_name,
        SalesOpportunity.client,
        SalesOpportunity.sales_stage,
        SalesOpportunity.campaign_type,
        SalesOpportunity.target_geography,
        SalesOpportunity.target_audience,
        SalesOpportunity.tactics,
    )
    return apply_ranked_search(
        query,
        search=search,
        document=document,
        default_order_column=SalesOpportunity.created_time,
    )

def _contact_display_name(contact: SalesContact) -> str:
    full_name = " ".join(part for part in [contact.first_name, contact.last_name] if part).strip()
    return full_name or contact.primary_email or "Unnamed Contact"


def _normalize_currency(db: Session, currency: str | None) -> str:
    allowed = get_company_operating_currencies(db)
    normalized = (currency or allowed[0]).strip().upper()
    if normalized not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Currency must be one of: {', '.join(allowed)}",
        )
    return normalized


def list_opportunities(
    db: Session,
    pagination: Pagination,
    search: str | None = None,
) -> tuple[list[SalesOpportunity], int]:
    query = _apply_search_filter(
        db.query(SalesOpportunity).filter(SalesOpportunity.deleted_at.is_(None)),
        search,
    )
    total_count = query.count()
    items = query.offset(pagination.offset).limit(pagination.limit).all()
    items = hydrate_custom_field_records(
        db,
        module_key="sales_opportunities",
        records=items,
        record_id_attr="opportunity_id",
    )
    return items, total_count


def list_deleted_opportunities(
    db: Session,
    pagination: Pagination,
) -> tuple[list[SalesOpportunity], int]:
    query = db.query(SalesOpportunity).filter(SalesOpportunity.deleted_at.is_not(None))
    total_count = query.count()
    items = (
        query.order_by(SalesOpportunity.deleted_at.desc(), SalesOpportunity.created_time.desc())
        .offset(pagination.offset)
        .limit(pagination.limit)
        .all()
    )
    items = hydrate_custom_field_records(
        db,
        module_key="sales_opportunities",
        records=items,
        record_id_attr="opportunity_id",
    )
    return items, total_count


def get_opportunity_or_404(
    db: Session,
    opportunity_id: int,
    *,
    include_deleted: bool = False,
) -> SalesOpportunity:
    opportunity = (
        db.query(SalesOpportunity)
        .filter(SalesOpportunity.opportunity_id == opportunity_id)
        .filter(SalesOpportunity.deleted_at.is_not(None) if include_deleted else SalesOpportunity.deleted_at.is_(None))
        .first()
    )
    if not opportunity:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Opportunity not found")
    return hydrate_custom_field_record(
        db,
        module_key="sales_opportunities",
        record=opportunity,
        record_id=opportunity.opportunity_id,
    )


def create_opportunity(db: Session, data: dict) -> SalesOpportunity:
    custom_data = validate_custom_field_payload(
        db,
        module_key="sales_opportunities",
        payload=data.pop("custom_fields", None),
    )
    data["custom_data"] = custom_data
    contact_id = data.get("contact_id")
    if contact_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="contact_id is required")
    contact = _get_contact_or_404(db, contact_id)
    data["client"] = _contact_display_name(contact)
    if not data.get("organization_id") and contact.organization_id is not None:
        data["organization_id"] = contact.organization_id

    organization_id = data.get("organization_id")
    if organization_id is not None:
        _ensure_organization(db, organization_id)

    assigned_to = data.get("assigned_to")
    if assigned_to is not None:
        _ensure_user(db, assigned_to)

    if "attachments" in data:
        data["attachments"] = _serialize_attachment_paths(data.get("attachments"))
    if "currency_type" in data:
        data["currency_type"] = _normalize_currency(db, data.get("currency_type"))

    opportunity = SalesOpportunity(**data)
    db.add(opportunity)
    db.commit()
    db.refresh(opportunity)
    save_custom_field_values(db, module_key="sales_opportunities", record_id=opportunity.opportunity_id, values=custom_data)
    db.commit()
    return hydrate_custom_field_record(
        db,
        module_key="sales_opportunities",
        record=opportunity,
        record_id=opportunity.opportunity_id,
    )


def update_opportunity(db: Session, opportunity: SalesOpportunity, data: dict) -> SalesOpportunity:
    if "custom_fields" in data:
        data["custom_data"] = validate_custom_field_payload(
            db,
            module_key="sales_opportunities",
            payload=data.pop("custom_fields"),
            existing=load_custom_field_values_with_fallback(
                db,
                module_key="sales_opportunities",
                record_id=opportunity.opportunity_id,
                fallback=opportunity.custom_data,
            ),
        )
    if "contact_id" in data:
        if data["contact_id"] is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="contact_id cannot be null")
        contact = _get_contact_or_404(db, data["contact_id"])
        data["client"] = _contact_display_name(contact)
        if "organization_id" not in data and contact.organization_id is not None:
            data["organization_id"] = contact.organization_id
    if "organization_id" in data and data["organization_id"] is not None:
        _ensure_organization(db, data["organization_id"])
    if "assigned_to" in data and data["assigned_to"] is not None:
        _ensure_user(db, data["assigned_to"])
    if "attachments" in data:
        data["attachments"] = _serialize_attachment_paths(data.get("attachments"))
    if "currency_type" in data and data["currency_type"] is not None:
        data["currency_type"] = _normalize_currency(db, data.get("currency_type"))

    for field, value in data.items():
        setattr(opportunity, field, value)

    db.commit()
    db.refresh(opportunity)
    save_custom_field_values(db, module_key="sales_opportunities", record_id=opportunity.opportunity_id, values=opportunity.custom_data or {})
    db.commit()
    return hydrate_custom_field_record(
        db,
        module_key="sales_opportunities",
        record=opportunity,
        record_id=opportunity.opportunity_id,
    )


def delete_opportunity(db: Session, opportunity: SalesOpportunity) -> SalesOpportunity:
    opportunity.deleted_at = func.now()
    db.commit()
    db.refresh(opportunity)
    return hydrate_custom_field_record(
        db,
        module_key="sales_opportunities",
        record=opportunity,
        record_id=opportunity.opportunity_id,
    )


def restore_opportunity(db: Session, opportunity: SalesOpportunity) -> SalesOpportunity:
    opportunity.deleted_at = None
    db.commit()
    db.refresh(opportunity)
    return hydrate_custom_field_record(
        db,
        module_key="sales_opportunities",
        record=opportunity,
        record_id=opportunity.opportunity_id,
    )
