from decimal import Decimal

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.modules.platform.services.custom_fields import hydrate_custom_field_record, hydrate_custom_field_records
from app.modules.finance.models import FinanceIO
from app.modules.sales.models import SalesContact, SalesOpportunity, SalesOrganization, SalesOrder, SalesQuote
from app.modules.sales.services.quotes_services import get_latest_quote_proposal, list_quote_proposal_events


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


def _get_related_quotes(
    db: Session,
    *,
    tenant_id: int,
    organization_id: int | None = None,
    contact_id: int | None = None,
    opportunity_id: int | None = None,
    limit: int = 10,
) -> list[SalesQuote]:
    quote_filters = [SalesQuote.tenant_id == tenant_id, SalesQuote.deleted_at.is_(None)]
    if opportunity_id is not None:
        quote_filters.append(SalesQuote.opportunity_id == opportunity_id)
    elif organization_id is not None and contact_id is not None:
        quote_filters.append(or_(SalesQuote.organization_id == organization_id, SalesQuote.contact_id == contact_id))
    elif organization_id is not None:
        quote_filters.append(SalesQuote.organization_id == organization_id)
    elif contact_id is not None:
        quote_filters.append(SalesQuote.contact_id == contact_id)
    else:
        return []

    return (
        db.query(SalesQuote)
        .filter(*quote_filters)
        .order_by(SalesQuote.updated_at.desc(), SalesQuote.created_time.desc())
        .limit(limit)
        .all()
    )


def _get_related_insertion_orders(
    db: Session,
    tenant_id: int,
    organization_name: str | None,
    organization_id: int | None = None,
    contact_id: int | None = None,
    limit: int = 8,
) -> list[FinanceIO]:
    if not organization_name and organization_id is None and contact_id is None:
        return []

    normalized = organization_name.strip().lower() if organization_name else None
    filters = [FinanceIO.tenant_id == tenant_id, FinanceIO.deleted_at.is_(None)]
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
            .filter(
                SalesOrganization.org_id == contact.organization_id,
                SalesOrganization.tenant_id == contact.tenant_id,
            )
            .first()
        )
        if organization:
            organization = hydrate_custom_field_record(
                db,
                tenant_id=contact.tenant_id,
                module_key="sales_organizations",
                record=organization,
                record_id=organization.org_id,
            )

    opportunities = (
        db.query(SalesOpportunity)
        .filter(
            SalesOpportunity.contact_id == contact.contact_id,
            SalesOpportunity.tenant_id == contact.tenant_id,
            SalesOpportunity.deleted_at.is_(None),
        )
        .order_by(SalesOpportunity.created_time.desc())
        .limit(10)
        .all()
    )
    opportunities = hydrate_custom_field_records(
        db,
        tenant_id=contact.tenant_id,
        module_key="sales_opportunities",
        records=opportunities,
        record_id_attr="opportunity_id",
    )
    insertion_orders = _get_related_insertion_orders(
        db,
        contact.tenant_id,
        organization.org_name if organization else None,
        organization.org_id if organization else None,
        contact.contact_id,
    )
    quotes = _get_related_quotes(
        db,
        tenant_id=contact.tenant_id,
        organization_id=organization.org_id if organization else contact.organization_id,
        contact_id=contact.contact_id,
    )
    quotes = hydrate_custom_field_records(
        db,
        tenant_id=contact.tenant_id,
        module_key="sales_quotes",
        records=quotes,
        record_id_attr="quote_id",
    )

    return {
        "contact": contact,
        "organization": organization,
        "related_opportunities": opportunities,
        "related_quotes": quotes,
        "related_insertion_orders": [_serialize_io(record) for record in insertion_orders],
        "inferred_services": _collect_services(opportunities),
        "opportunity_count": len(opportunities),
        "quote_count": len(quotes),
        "insertion_order_count": len(insertion_orders),
    }


def build_organization_summary(db: Session, organization: SalesOrganization) -> dict:
    contacts = (
        db.query(SalesContact)
        .filter(
            SalesContact.organization_id == organization.org_id,
            SalesContact.tenant_id == organization.tenant_id,
            SalesContact.deleted_at.is_(None),
        )
        .order_by(SalesContact.created_time.desc())
        .limit(12)
        .all()
    )
    contacts = hydrate_custom_field_records(
        db,
        tenant_id=organization.tenant_id,
        module_key="sales_contacts",
        records=contacts,
        record_id_attr="contact_id",
    )
    opportunities = (
        db.query(SalesOpportunity)
        .filter(
            SalesOpportunity.organization_id == organization.org_id,
            SalesOpportunity.tenant_id == organization.tenant_id,
            SalesOpportunity.deleted_at.is_(None),
        )
        .order_by(SalesOpportunity.created_time.desc())
        .limit(10)
        .all()
    )
    opportunities = hydrate_custom_field_records(
        db,
        tenant_id=organization.tenant_id,
        module_key="sales_opportunities",
        records=opportunities,
        record_id_attr="opportunity_id",
    )
    insertion_orders = _get_related_insertion_orders(db, organization.tenant_id, organization.org_name, organization.org_id)
    quotes = _get_related_quotes(db, tenant_id=organization.tenant_id, organization_id=organization.org_id)
    quotes = hydrate_custom_field_records(
        db,
        tenant_id=organization.tenant_id,
        module_key="sales_quotes",
        records=quotes,
        record_id_attr="quote_id",
    )

    return {
        "organization": organization,
        "related_contacts": contacts,
        "related_opportunities": opportunities,
        "related_quotes": quotes,
        "related_insertion_orders": [_serialize_io(record) for record in insertion_orders],
        "inferred_services": _collect_services(opportunities),
        "contact_count": len(contacts),
        "opportunity_count": len(opportunities),
        "quote_count": len(quotes),
        "insertion_order_count": len(insertion_orders),
    }


def build_opportunity_summary(db: Session, opportunity: SalesOpportunity) -> dict:
    contact = None
    if opportunity.contact_id:
        contact = (
            db.query(SalesContact)
            .filter(
                SalesContact.contact_id == opportunity.contact_id,
                SalesContact.tenant_id == opportunity.tenant_id,
                SalesContact.deleted_at.is_(None),
            )
            .first()
        )
        if contact:
            contact = hydrate_custom_field_record(
                db,
                tenant_id=contact.tenant_id,
                module_key="sales_contacts",
                record=contact,
                record_id=contact.contact_id,
            )

    organization = None
    if opportunity.organization_id:
        organization = (
            db.query(SalesOrganization)
            .filter(
                SalesOrganization.org_id == opportunity.organization_id,
                SalesOrganization.tenant_id == opportunity.tenant_id,
            )
            .first()
        )
        if organization:
            organization = hydrate_custom_field_record(
                db,
                tenant_id=organization.tenant_id,
                module_key="sales_organizations",
                record=organization,
                record_id=organization.org_id,
            )

    insertion_orders = _get_related_insertion_orders(
        db,
        opportunity.tenant_id,
        organization.org_name if organization else None,
        organization.org_id if organization else None,
        opportunity.contact_id,
    )

    return {
        "opportunity": opportunity,
        "contact": contact,
        "organization": organization,
        "related_quotes": hydrate_custom_field_records(
            db,
            tenant_id=opportunity.tenant_id,
            module_key="sales_quotes",
            records=_get_related_quotes(db, tenant_id=opportunity.tenant_id, opportunity_id=opportunity.opportunity_id),
            record_id_attr="quote_id",
        ),
        "related_insertion_orders": [_serialize_io(record) for record in insertion_orders],
        "inferred_services": _collect_services([opportunity]),
        "insertion_order_count": len(insertion_orders),
    }


def build_quote_summary(db: Session, quote: SalesQuote) -> dict:
    opportunity = None
    if quote.opportunity_id:
        opportunity = (
            db.query(SalesOpportunity)
            .filter(
                SalesOpportunity.opportunity_id == quote.opportunity_id,
                SalesOpportunity.tenant_id == quote.tenant_id,
                SalesOpportunity.deleted_at.is_(None),
            )
            .first()
        )
        if opportunity:
            opportunity = hydrate_custom_field_record(
                db,
                tenant_id=quote.tenant_id,
                module_key="sales_opportunities",
                record=opportunity,
                record_id=opportunity.opportunity_id,
            )

    contact = None
    if quote.contact_id:
        contact = (
            db.query(SalesContact)
            .filter(
                SalesContact.contact_id == quote.contact_id,
                SalesContact.tenant_id == quote.tenant_id,
                SalesContact.deleted_at.is_(None),
            )
            .first()
        )
        if contact:
            contact = hydrate_custom_field_record(
                db,
                tenant_id=quote.tenant_id,
                module_key="sales_contacts",
                record=contact,
                record_id=contact.contact_id,
            )

    organization = None
    if quote.organization_id:
        organization = (
            db.query(SalesOrganization)
            .filter(
                SalesOrganization.org_id == quote.organization_id,
                SalesOrganization.tenant_id == quote.tenant_id,
                SalesOrganization.deleted_at.is_(None),
            )
            .first()
        )
        if organization:
            organization = hydrate_custom_field_record(
                db,
                tenant_id=quote.tenant_id,
                module_key="sales_organizations",
                record=organization,
                record_id=organization.org_id,
            )

    return {
        "quote": quote,
        "opportunity": opportunity,
        "contact": contact,
        "organization": organization,
        "latest_proposal": get_latest_quote_proposal(db, quote),
        "proposal_events": list_quote_proposal_events(db, quote, limit=10),
        "related_order": db.query(SalesOrder).filter(SalesOrder.tenant_id == quote.tenant_id, SalesOrder.quote_id == quote.quote_id).first(),
    }
