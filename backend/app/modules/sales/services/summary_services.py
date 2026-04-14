from decimal import Decimal

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.modules.finance.models import FinanceIO
from app.modules.sales.models import SalesContact, SalesOpportunity, SalesOrganization


def _to_float(value: Decimal | None) -> float | None:
    if value is None:
        return None
    return float(value)


def _serialize_io(record: FinanceIO) -> dict:
    return {
        "id": record.id,
        "io_number": record.io_number,
        "customer_name": record.customer_name,
        "status": record.status,
        "total_amount": _to_float(record.total_amount),
        "currency": record.currency,
        "updated_at": record.updated_at,
    }


def _collect_services(opportunities: list[SalesOpportunity]) -> list[str]:
    labels: set[str] = set()
    for opportunity in opportunities:
        for value in (
            opportunity.campaign_type,
            opportunity.delivery_format,
            opportunity.tactics,
            opportunity.target_audience,
        ):
            if value and value.strip():
                labels.add(value.strip())
    return sorted(labels)


def _get_related_insertion_orders(
    db: Session,
    organization_name: str | None,
    organization_id: int | None = None,
    contact_id: int | None = None,
    limit: int = 8,
) -> list[FinanceIO]:
    if not organization_name and organization_id is None and contact_id is None:
        return []

    normalized = organization_name.strip().lower() if organization_name else None
    filters = [FinanceIO.deleted_at.is_(None)]
    if contact_id is not None and organization_id is not None and normalized is not None:
        filters.append(
            or_(
                FinanceIO.customer_contact_id == contact_id,
                FinanceIO.customer_organization_id == organization_id,
                func.lower(func.coalesce(FinanceIO.customer_name, "")) == normalized,
            )
        )
    elif contact_id is not None and organization_id is not None:
        filters.append(
            or_(
                FinanceIO.customer_contact_id == contact_id,
                FinanceIO.customer_organization_id == organization_id,
            )
        )
    elif contact_id is not None and normalized is not None:
        filters.append(
            or_(
                FinanceIO.customer_contact_id == contact_id,
                func.lower(func.coalesce(FinanceIO.customer_name, "")) == normalized,
            )
        )
    elif contact_id is not None:
        filters.append(FinanceIO.customer_contact_id == contact_id)
    elif organization_id is not None and normalized is not None:
        filters.append(
            or_(
                FinanceIO.customer_organization_id == organization_id,
                func.lower(func.coalesce(FinanceIO.customer_name, "")) == normalized,
            )
        )
    elif organization_id is not None:
        filters.append(FinanceIO.customer_organization_id == organization_id)
    elif normalized is not None:
        filters.append(
            or_(
                func.lower(func.coalesce(FinanceIO.customer_name, "")) == normalized,
            )
        )

    return (
        db.query(FinanceIO)
        .filter(*filters)
        .order_by(FinanceIO.updated_at.desc())
        .limit(limit)
        .all()
    )


def build_contact_summary(db: Session, contact: SalesContact) -> dict:
    organization = None
    if contact.organization_id:
        organization = (
            db.query(SalesOrganization)
            .filter(SalesOrganization.org_id == contact.organization_id)
            .first()
        )

    opportunities = (
        db.query(SalesOpportunity)
        .filter(
            SalesOpportunity.contact_id == contact.contact_id,
            SalesOpportunity.deleted_at.is_(None),
        )
        .order_by(SalesOpportunity.created_time.desc())
        .limit(10)
        .all()
    )
    insertion_orders = _get_related_insertion_orders(
        db,
        organization.org_name if organization else None,
        organization.org_id if organization else None,
        contact.contact_id,
    )

    return {
        "contact": contact,
        "organization": organization,
        "related_opportunities": opportunities,
        "related_insertion_orders": [_serialize_io(record) for record in insertion_orders],
        "inferred_services": _collect_services(opportunities),
        "opportunity_count": len(opportunities),
        "insertion_order_count": len(insertion_orders),
    }


def build_organization_summary(db: Session, organization: SalesOrganization) -> dict:
    contacts = (
        db.query(SalesContact)
        .filter(
            SalesContact.organization_id == organization.org_id,
            SalesContact.deleted_at.is_(None),
        )
        .order_by(SalesContact.created_time.desc())
        .limit(12)
        .all()
    )
    opportunities = (
        db.query(SalesOpportunity)
        .filter(
            SalesOpportunity.organization_id == organization.org_id,
            SalesOpportunity.deleted_at.is_(None),
        )
        .order_by(SalesOpportunity.created_time.desc())
        .limit(10)
        .all()
    )
    insertion_orders = _get_related_insertion_orders(db, organization.org_name, organization.org_id)

    return {
        "organization": organization,
        "related_contacts": contacts,
        "related_opportunities": opportunities,
        "related_insertion_orders": [_serialize_io(record) for record in insertion_orders],
        "inferred_services": _collect_services(opportunities),
        "contact_count": len(contacts),
        "opportunity_count": len(opportunities),
        "insertion_order_count": len(insertion_orders),
    }
