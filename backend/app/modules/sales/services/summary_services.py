from decimal import Decimal

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.access_control import PermissionPolicy
from app.modules.platform.services.custom_fields import hydrate_custom_field_record, hydrate_custom_field_records
from app.modules.finance.models import FinanceIO, FinancePosInvoice
from app.modules.sales.models import (
    SalesContact,
    SalesOpportunity,
    SalesOpportunityContact,
    SalesOrganization,
    SalesOrder,
    SalesQuote,
)
from app.modules.sales.opportunity_contact_roles import opportunity_contact_role_label
from app.modules.sales.services import opportunity_contacts_services
from app.modules.sales.services.quotes_services import get_latest_quote_proposal, list_quote_proposal_events


# Relationship summaries (05-relationships-data-model, Phase 4)
# ------------------------------------------------------------------
# Viewing a record is not permission to view every module related to it. Each
# related section of a summary is checked against the reader's own access to that
# module — tenant enablement, department/team availability and the role `view`
# action, the same bar as opening the module directly — and a section the reader
# may not see is returned empty with a zero count and `related_access[section]`
# false, so a client can tell "hidden" from "none". It is never queried at all.
#
# Counts are true totals; the lists are the most recent few.

RELATED_SECTION_MODULES = {
    "contacts": "sales_contacts",
    "opportunities": "sales_opportunities",
    "quotes": "sales_quotes",
    "orders": "sales_orders",
    "invoices": "finance_pos",
    "insertion_orders": "finance_io",
}


def related_access(db: Session, current_user, sections) -> dict[str, bool]:
    """Which related sections the reader may see. No reader means none."""

    if current_user is None:
        return {section: False for section in sections}
    policy = PermissionPolicy(db, current_user)
    access = {}
    for section in sections:
        module_key = RELATED_SECTION_MODULES[section]
        access[section] = policy.can_view_module(module_key) and policy.can_perform_action(module_key, "view")
    return access


def _count(query) -> int:
    return query.order_by(None).count()


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


def _related_quotes_query(
    db: Session,
    *,
    tenant_id: int,
    organization_id: int | None = None,
    contact_id: int | None = None,
    opportunity_id: int | None = None,
):
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
        return None
    return db.query(SalesQuote).filter(*quote_filters)


def _related_insertion_orders_query(
    db: Session,
    tenant_id: int,
    organization_name: str | None,
    organization_id: int | None = None,
    contact_id: int | None = None,
):
    normalized_name = organization_name.strip().lower() if organization_name and organization_name.strip() else None
    match_conditions = []
    if contact_id is not None:
        match_conditions.append(FinanceIO.customer_contact_id == contact_id)
    if organization_id is not None:
        match_conditions.append(FinanceIO.customer_organization_id == organization_id)
    if normalized_name is not None:
        match_conditions.append(func.lower(func.coalesce(FinanceIO.customer_name, "")) == normalized_name)
    if not match_conditions:
        return None

    filters = [FinanceIO.tenant_id == tenant_id, FinanceIO.deleted_at.is_(None)]
    filters.append(or_(*match_conditions) if len(match_conditions) > 1 else match_conditions[0])
    return db.query(FinanceIO).filter(*filters)


def _get_related_insertion_orders(
    db: Session,
    tenant_id: int,
    organization_name: str | None,
    organization_id: int | None = None,
    contact_id: int | None = None,
    limit: int = 8,
) -> list[FinanceIO]:
    query = _related_insertion_orders_query(db, tenant_id, organization_name, organization_id, contact_id)
    if query is None:
        return []
    return query.order_by(FinanceIO.updated_at.desc()).limit(limit).all()


def _related_orders_query(db: Session, *, tenant_id: int, organization_id: int | None = None, contact_id: int | None = None):
    """Orders for an account, or for a contact by the same rule as its quotes.

    A contact's orders match on its account or on the contact itself, exactly as its
    quotes do, so a quote and the order converted from it always appear together.
    """

    conditions = []
    if organization_id is not None:
        conditions.append(SalesOrder.organization_id == organization_id)
    if contact_id is not None:
        conditions.append(SalesOrder.contact_id == contact_id)
    if not conditions:
        return None
    return db.query(SalesOrder).filter(
        SalesOrder.tenant_id == tenant_id,
        or_(*conditions) if len(conditions) > 1 else conditions[0],
    )


def _related_invoices_query(db: Session, *, tenant_id: int, organization_id: int):
    return db.query(FinancePosInvoice).filter(
        FinancePosInvoice.tenant_id == tenant_id,
        FinancePosInvoice.customer_organization_id == organization_id,
        FinancePosInvoice.deleted_at.is_(None),
    )


def _contact_opportunities_query(db: Session, *, tenant_id: int, contact_id: int):
    """Deals a contact is on: as the legacy primary, or as an active participant.

    Both sides are tenant-filtered, so a corrupt association row pointing at another
    tenant's deal matches nothing.
    """

    participant_deal_ids = db.query(SalesOpportunityContact.opportunity_id).filter(
        SalesOpportunityContact.tenant_id == tenant_id,
        SalesOpportunityContact.contact_id == contact_id,
        SalesOpportunityContact.deleted_at.is_(None),
    )
    return db.query(SalesOpportunity).filter(
        SalesOpportunity.tenant_id == tenant_id,
        SalesOpportunity.deleted_at.is_(None),
        or_(
            SalesOpportunity.contact_id == contact_id,
            SalesOpportunity.opportunity_id.in_(participant_deal_ids),
        ),
    )


def _serialize_contact_opportunities(db: Session, *, tenant_id: int, contact_id: int, opportunities) -> list[dict]:
    """Each deal with the role this contact plays on it."""

    ids = [opportunity.opportunity_id for opportunity in opportunities]
    links = {}
    if ids:
        links = {
            link.opportunity_id: link
            for link in db.query(SalesOpportunityContact).filter(
                SalesOpportunityContact.tenant_id == tenant_id,
                SalesOpportunityContact.contact_id == contact_id,
                SalesOpportunityContact.opportunity_id.in_(ids),
                SalesOpportunityContact.deleted_at.is_(None),
            )
        }
    rows = []
    for opportunity in opportunities:
        link = links.get(opportunity.opportunity_id)
        is_primary = opportunity.contact_id == contact_id
        rows.append(
            {
                "opportunity_id": opportunity.opportunity_id,
                "opportunity_name": opportunity.opportunity_name,
                "sales_stage": opportunity.sales_stage,
                "expected_close_date": opportunity.expected_close_date,
                "probability_percent": opportunity.probability_percent,
                "total_cost_of_project": opportunity.total_cost_of_project,
                "currency_type": opportunity.currency_type,
                "contact_role_key": link.role_key if link else None,
                "contact_role_label": opportunity_contact_role_label(link.role_key) if link else None,
                "is_primary_contact": is_primary,
            }
        )
    return rows


def build_contact_summary(db: Session, contact: SalesContact, *, current_user=None) -> dict:
    tenant_id = contact.tenant_id
    access = related_access(db, current_user, ("opportunities", "quotes", "orders", "insertion_orders"))

    organization = None
    if contact.organization_id:
        organization = (
            db.query(SalesOrganization)
            .filter(
                SalesOrganization.org_id == contact.organization_id,
                SalesOrganization.tenant_id == tenant_id,
            )
            .first()
        )
        if organization:
            organization = hydrate_custom_field_record(
                db,
                tenant_id=tenant_id,
                module_key="sales_organizations",
                record=organization,
                record_id=organization.org_id,
            )
    organization_id = organization.org_id if organization else contact.organization_id

    opportunities: list = []
    opportunity_count = 0
    if access["opportunities"]:
        query = _contact_opportunities_query(db, tenant_id=tenant_id, contact_id=contact.contact_id)
        opportunity_count = _count(query)
        opportunities = query.order_by(SalesOpportunity.created_time.desc()).limit(10).all()

    quotes: list = []
    quote_count = 0
    if access["quotes"]:
        query = _related_quotes_query(db, tenant_id=tenant_id, organization_id=organization_id, contact_id=contact.contact_id)
        quote_count = _count(query)
        quotes = hydrate_custom_field_records(
            db,
            tenant_id=tenant_id,
            module_key="sales_quotes",
            records=query.order_by(SalesQuote.updated_at.desc(), SalesQuote.created_time.desc()).limit(10).all(),
            record_id_attr="quote_id",
        )

    orders: list = []
    order_count = 0
    if access["orders"]:
        query = _related_orders_query(db, tenant_id=tenant_id, organization_id=organization_id, contact_id=contact.contact_id)
        order_count = _count(query)
        orders = query.order_by(SalesOrder.updated_at.desc(), SalesOrder.id.desc()).limit(10).all()

    insertion_orders: list = []
    insertion_order_count = 0
    if access["insertion_orders"]:
        query = _related_insertion_orders_query(
            db,
            tenant_id,
            organization.org_name if organization else None,
            organization.org_id if organization else None,
            contact.contact_id,
        )
        insertion_order_count = _count(query)
        insertion_orders = query.order_by(FinanceIO.updated_at.desc()).limit(8).all()

    return {
        "contact": contact,
        "organization": organization,
        "related_access": access,
        "related_opportunities": _serialize_contact_opportunities(
            db, tenant_id=tenant_id, contact_id=contact.contact_id, opportunities=opportunities
        ),
        "related_quotes": quotes,
        "related_orders": orders,
        "related_insertion_orders": [_serialize_io(record) for record in insertion_orders],
        "inferred_services": _collect_services(opportunities),
        "opportunity_count": opportunity_count,
        "quote_count": quote_count,
        "order_count": order_count,
        "insertion_order_count": insertion_order_count,
    }


def build_organization_summary(db: Session, organization: SalesOrganization, *, current_user=None) -> dict:
    tenant_id = organization.tenant_id
    access = related_access(
        db, current_user, ("contacts", "opportunities", "quotes", "orders", "invoices", "insertion_orders")
    )

    contacts: list = []
    contact_count = 0
    if access["contacts"]:
        query = db.query(SalesContact).filter(
            SalesContact.organization_id == organization.org_id,
            SalesContact.tenant_id == tenant_id,
            SalesContact.deleted_at.is_(None),
        )
        contact_count = _count(query)
        contacts = hydrate_custom_field_records(
            db,
            tenant_id=tenant_id,
            module_key="sales_contacts",
            records=query.order_by(SalesContact.created_time.desc()).limit(12).all(),
            record_id_attr="contact_id",
        )

    opportunities: list = []
    opportunity_count = 0
    if access["opportunities"]:
        query = db.query(SalesOpportunity).filter(
            SalesOpportunity.organization_id == organization.org_id,
            SalesOpportunity.tenant_id == tenant_id,
            SalesOpportunity.deleted_at.is_(None),
        )
        opportunity_count = _count(query)
        opportunities = hydrate_custom_field_records(
            db,
            tenant_id=tenant_id,
            module_key="sales_opportunities",
            records=query.order_by(SalesOpportunity.created_time.desc()).limit(10).all(),
            record_id_attr="opportunity_id",
        )

    quotes: list = []
    quote_count = 0
    if access["quotes"]:
        query = _related_quotes_query(db, tenant_id=tenant_id, organization_id=organization.org_id)
        quote_count = _count(query)
        quotes = hydrate_custom_field_records(
            db,
            tenant_id=tenant_id,
            module_key="sales_quotes",
            records=query.order_by(SalesQuote.updated_at.desc(), SalesQuote.created_time.desc()).limit(10).all(),
            record_id_attr="quote_id",
        )

    orders: list = []
    order_count = 0
    if access["orders"]:
        query = _related_orders_query(db, tenant_id=tenant_id, organization_id=organization.org_id)
        order_count = _count(query)
        orders = query.order_by(SalesOrder.updated_at.desc(), SalesOrder.id.desc()).limit(10).all()

    invoices: list = []
    invoice_count = 0
    if access["invoices"]:
        query = _related_invoices_query(db, tenant_id=tenant_id, organization_id=organization.org_id)
        invoice_count = _count(query)
        invoices = query.order_by(FinancePosInvoice.updated_at.desc(), FinancePosInvoice.id.desc()).limit(10).all()

    insertion_orders: list = []
    insertion_order_count = 0
    if access["insertion_orders"]:
        query = _related_insertion_orders_query(db, tenant_id, organization.org_name, organization.org_id)
        if query is not None:
            insertion_order_count = _count(query)
            insertion_orders = query.order_by(FinanceIO.updated_at.desc()).limit(8).all()

    return {
        "organization": organization,
        "related_access": access,
        "related_contacts": contacts,
        "related_opportunities": opportunities,
        "related_quotes": quotes,
        "related_orders": orders,
        "related_invoices": invoices,
        "related_insertion_orders": [_serialize_io(record) for record in insertion_orders],
        "inferred_services": _collect_services(opportunities),
        "contact_count": contact_count,
        "opportunity_count": opportunity_count,
        "quote_count": quote_count,
        "order_count": order_count,
        "invoice_count": invoice_count,
        "insertion_order_count": insertion_order_count,
    }


def build_opportunity_summary(db: Session, opportunity: SalesOpportunity, *, current_user=None) -> dict:
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

    access = related_access(db, current_user, ("contacts", "quotes", "insertion_orders"))

    insertion_orders: list = []
    insertion_order_count = 0
    if access["insertion_orders"]:
        query = _related_insertion_orders_query(
            db,
            opportunity.tenant_id,
            organization.org_name if organization else None,
            organization.org_id if organization else None,
            opportunity.contact_id,
        )
        if query is not None:
            insertion_order_count = _count(query)
            insertion_orders = query.order_by(FinanceIO.updated_at.desc()).limit(8).all()

    quotes: list = []
    quote_count = 0
    if access["quotes"]:
        query = _related_quotes_query(db, tenant_id=opportunity.tenant_id, opportunity_id=opportunity.opportunity_id)
        quote_count = _count(query)
        quotes = hydrate_custom_field_records(
            db,
            tenant_id=opportunity.tenant_id,
            module_key="sales_quotes",
            records=query.order_by(SalesQuote.updated_at.desc(), SalesQuote.created_time.desc()).limit(10).all(),
            record_id_attr="quote_id",
        )

    can_view_contacts = access["contacts"]
    participants = (
        opportunity_contacts_services.serialize_participants(
            opportunity_contacts_services.list_opportunity_participants(
                db,
                tenant_id=opportunity.tenant_id,
                opportunity_id=opportunity.opportunity_id,
            )
        )
        if can_view_contacts
        else []
    )

    return {
        "opportunity": opportunity,
        "contact": contact,
        "organization": organization,
        "primary_contact": next((item for item in participants if item["is_primary"]), None),
        "participant_contacts": participants,
        "can_view_contacts": can_view_contacts,
        "related_access": access,
        "related_quotes": quotes,
        "related_insertion_orders": [_serialize_io(record) for record in insertion_orders],
        "inferred_services": _collect_services([opportunity]),
        "quote_count": quote_count,
        "insertion_order_count": insertion_order_count,
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
