"""Clone drafts (13b Phase 5, F3.8).

*Clone* on a record opens the module's ordinary create form, filled from a draft this module
builds. The draft is what a new record may copy: the editable header, the custom fields and
the lines. It never carries numbers, statuses, totals, dates the new record should take
fresh, links to documents generated from the source, or history. Nothing is written here:
the user saves the form as an ordinary create, which runs every create rule again.

Each module lists what it copies, rather than what it drops, so a column added later stays
out of a clone until someone decides it belongs. A field the tenant disabled or made
read-only is left out too, as the create form would refuse or ignore it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from app.core import field_types
from app.core.permissions import require_access
from app.modules.platform.services.custom_fields import list_custom_field_definitions, load_custom_field_values
from app.modules.platform.services.module_fields import module_field_enabled_map, module_field_rules

Loader = Callable[[Session, int, int], dict[str, Any]]


@dataclass(frozen=True)
class CloneSpec:
    label: str
    load: Loader
    fields: tuple[str, ...]
    # The serialized record's list of lines, and what each copied line keeps.
    lines_key: str | None = None
    line_fields: tuple[str, ...] = ()
    # Display names the form shows beside a reference, copied with it when present.
    name_fields: tuple[str, ...] = ()


# --- loaders: the module's own tenant-scoped read, serialized as its GET returns it --------


def _lead(db: Session, tenant_id: int, record_id: int) -> dict:
    from app.modules.sales.schema import SalesLeadResponse
    from app.modules.sales.services.leads_services import get_lead_or_404

    return SalesLeadResponse.model_validate(get_lead_or_404(db, record_id, tenant_id=tenant_id)).model_dump(mode="json")


def _contact(db: Session, tenant_id: int, record_id: int) -> dict:
    from app.modules.sales.schema import SalesContactResponse
    from app.modules.sales.services.contacts_services import get_contact_or_404

    return SalesContactResponse.model_validate(get_contact_or_404(db, record_id, tenant_id=tenant_id)).model_dump(mode="json")


def _organization(db: Session, tenant_id: int, record_id: int) -> dict:
    from app.modules.sales.schema import SalesOrganizationResponse
    from app.modules.sales.services.organizations_services import get_organization

    organization = get_organization(db, record_id, tenant_id=tenant_id)
    if organization is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    return SalesOrganizationResponse.model_validate(organization).model_dump(mode="json")


def _opportunity(db: Session, tenant_id: int, record_id: int) -> dict:
    from app.modules.sales.schema import SalesOpportunityResponse
    from app.modules.sales.services.opportunities_services import get_opportunity_or_404

    return SalesOpportunityResponse.model_validate(get_opportunity_or_404(db, record_id, tenant_id=tenant_id)).model_dump(mode="json")


def _quote(db: Session, tenant_id: int, record_id: int) -> dict:
    from app.modules.sales.models import SalesContact, SalesOpportunity, SalesOrganization
    from app.modules.sales.schema import SalesQuoteResponse
    from app.modules.sales.services.quotes_services import get_quote_or_404

    data = SalesQuoteResponse.model_validate(get_quote_or_404(db, record_id, tenant_id=tenant_id)).model_dump(mode="json")
    # The quote's own response carries ids only; the form shows each link by name.
    if data.get("organization_id"):
        organization = db.query(SalesOrganization).filter(
            SalesOrganization.tenant_id == tenant_id, SalesOrganization.org_id == data["organization_id"]
        ).first()
        data["organization_name"] = organization.org_name if organization else None
    if data.get("contact_id"):
        contact = db.query(SalesContact).filter(
            SalesContact.tenant_id == tenant_id, SalesContact.contact_id == data["contact_id"]
        ).first()
        if contact:
            data["contact_name"] = " ".join(part for part in (contact.first_name, contact.last_name) if part).strip() or contact.primary_email
    if data.get("opportunity_id"):
        opportunity = db.query(SalesOpportunity).filter(
            SalesOpportunity.tenant_id == tenant_id, SalesOpportunity.opportunity_id == data["opportunity_id"]
        ).first()
        data["opportunity_name"] = opportunity.opportunity_name if opportunity else None
    return data


def _order(db: Session, tenant_id: int, record_id: int) -> dict:
    from app.modules.sales.schema import SalesOrderResponse
    from app.modules.sales.services.orders_services import get_order_or_404

    return SalesOrderResponse.model_validate(get_order_or_404(db, tenant_id=tenant_id, order_id=record_id)).model_dump(mode="json")


def _catalog(kind_name: str) -> Loader:
    def load(db: Session, tenant_id: int, record_id: int) -> dict:
        from app.modules.catalog.services import catalog_item_services as items

        if kind_name == "product":
            from app.modules.catalog.services.product_services import PRODUCT as kind
        else:
            from app.modules.catalog.services.service_services import SERVICE as kind
        record = items.get_item_or_404(db, kind, tenant_id=tenant_id, item_id=record_id)
        return kind.response_model.model_validate(items.serialize(kind, record)).model_dump(mode="json")

    return load


def _purchase_order(db: Session, tenant_id: int, record_id: int) -> dict:
    from app.modules.purchasing.services import purchase_order_services as orders

    order = orders.order_or_404(db, tenant_id=tenant_id, order_id=record_id)
    return jsonable_encoder(orders.serialize_order(db, tenant_id=tenant_id, order=order))


_ADDRESS = ("address", "street2", "city", "state", "postal_code", "country")


def _address(prefix: str) -> tuple[str, ...]:
    return tuple(f"{prefix}_{part}" for part in _ADDRESS)


_DOCUMENT_LINE_FIELDS = (
    "catalog_product_id",
    "catalog_service_id",
    "name",
    "description",
    "quantity",
    "unit_price",
    "discount_amount",
    "tax_amount",
    "tax_rate_id",
    "tax_manual",
    "line_type",
    "discount_percent",
    "unit",
    "sort_order",
)

_CATALOG_FIELDS = (
    "name",
    "description",
    "category_id",
    "unit",
    "currency",
    "public_unit_price",
    "list_price",
    "cost_price",
    "tax_category",
    "tax_rate_id",
    "purchase_tax_rate_id",
    "is_public",
    "is_active",
)

# What each module's clone copies. Left out on purpose, across modules: numbers, statuses and
# stages, totals (the lines recompute them), issue/expiry/delivery dates, exchange rates (the
# day's rate applies), the customer's own PO reference, the source quote and channel, a
# person's email (the create refuses a duplicate), and a product's SKU, barcode, slug,
# vendor code, stock and pictures (each belongs to one item).
CLONE_SPECS: dict[str, CloneSpec] = {
    "sales_leads": CloneSpec(
        label="lead",
        load=_lead,
        fields=(
            "first_name", "last_name", "company", "phone", "mobile_phone", "title", "source", "notes",
            "assigned_to", "team_id", "tags",
        ),
        name_fields=("assigned_to_name", "team_name"),
    ),
    "sales_contacts": CloneSpec(
        label="contact",
        load=_contact,
        fields=(
            "salutation", "first_name", "last_name", "contact_telephone", "mobile_phone", "linkedin_url",
            "current_title", "region", "mailing_address", "mailing_street2", "mailing_city", "mailing_state",
            "mailing_postal_code", "country", "email_opt_out", "organization_id", "assigned_to",
        ),
        name_fields=("organization_name", "assigned_to_name"),
    ),
    "sales_organizations": CloneSpec(
        label="account",
        load=_organization,
        fields=(
            "org_name", "primary_email", "secondary_email", "website", "primary_phone", "secondary_phone",
            "industry", "account_type", "annual_revenue", "employee_count",
            *_address("billing"), *_address("shipping"), "is_vendor", "payment_terms_days", "assigned_to",
        ),
        name_fields=("assigned_to_name",),
    ),
    "sales_opportunities": CloneSpec(
        label="deal",
        load=_opportunity,
        fields=(
            "opportunity_name", "contact_id", "organization_id", "assigned_to", "start_date",
            "expected_close_date", "amount", "currency_type", "deal_type", "source", "next_step",
        ),
        name_fields=("contact_name", "organization_name", "assigned_to_name"),
    ),
    "sales_quotes": CloneSpec(
        label="quote",
        load=_quote,
        fields=(
            "title", "customer_name", "contact_id", "organization_id", "opportunity_id", "currency", "tax_mode",
            *_address("billing"), *_address("shipping"), "terms_and_conditions", "shipping_method",
            "shipping_charge", "notes", "assigned_to",
        ),
        lines_key="items",
        line_fields=(*_DOCUMENT_LINE_FIELDS, "is_optional"),
        name_fields=("contact_name", "organization_name", "opportunity_name", "assigned_to_name"),
    ),
    "sales_orders": CloneSpec(
        label="order",
        load=_order,
        fields=(
            "organization_id", "contact_id", "opportunity_id", "currency", "tax_mode", *_address("billing"),
            *_address("shipping"), "terms_and_conditions", "shipping_method", "shipping_charge",
            "payment_terms", "notes", "owner_id", "warehouse_id", "priority",
        ),
        lines_key="items",
        line_fields=_DOCUMENT_LINE_FIELDS,
        name_fields=("organization_name", "contact_name", "opportunity_name", "owner_name", "warehouse_name"),
    ),
    "catalog_products": CloneSpec(
        label="product",
        load=_catalog("product"),
        fields=(
            *_CATALOG_FIELDS, "weight", "weight_unit", "length", "width", "height", "dimension_unit",
            "track_inventory", "reorder_point", "reorder_quantity", "preferred_vendor_id", "lead_time_days",
        ),
        name_fields=("category_name", "preferred_vendor_name"),
    ),
    "catalog_services": CloneSpec(
        label="service",
        load=_catalog("service"),
        fields=_CATALOG_FIELDS,
        name_fields=("category_name",),
    ),
    "purchase_orders": CloneSpec(
        label="purchase order",
        load=_purchase_order,
        fields=("vendor_id", "warehouse_id", "currency", "notes"),
        lines_key="lines",
        line_fields=("product_id", "catalog_service_id", "kind", "product_name", "sku", "description", "quantity", "unit_cost",
                     "discount_amount", "tax_amount", "tax_rate_id", "tax_manual", "unit"),
        name_fields=("vendor_name", "warehouse_name"),
    ),
}


def _copyable_custom_values(definitions, values: dict[str, Any]) -> dict[str, Any]:
    """Custom values a new record may take: not a unique field (the create would refuse the
    copy), not a file (it belongs to the source), not an auto-number (the new record gets its
    own)."""

    copied: dict[str, Any] = {}
    for definition in definitions:
        if definition.field_key not in values or field_types.is_empty(values[definition.field_key]):
            continue
        if definition.is_unique or definition.field_type == "file":
            continue
        if field_types.FIELD_TYPES.get(definition.field_type, field_types.FIELD_TYPES["text"]).system_assigned:
            continue
        copied[definition.field_key] = values[definition.field_key]
    return copied


def build_clone_draft(db: Session, *, module_key: str, record_id: int, current_user) -> dict[str, Any]:
    spec = CLONE_SPECS.get(module_key)
    if spec is None:
        return _custom_module_clone_draft(db, module_key=module_key, record_id=record_id, current_user=current_user)

    tenant_id = current_user.tenant_id
    # A clone shows the source (view) to make a new record (create): it needs both.
    require_access(db, current_user, module_key, "view", "create", detail=f"You need view and create access to clone this {spec.label}.")
    record = spec.load(db, tenant_id, record_id)

    enabled = module_field_enabled_map(db, tenant_id=tenant_id, module_key=module_key)
    rules = module_field_rules(db, tenant_id=tenant_id, module_key=module_key)
    fields: dict[str, Any] = {}
    for key in spec.fields:
        if key not in record or not enabled.get(key, True):
            continue
        rule = rules.get(key)
        if rule is not None and rule.readonly:
            continue
        fields[key] = record[key]
    for key in spec.name_fields:
        if record.get(key) is not None:
            fields[key] = record[key]

    lines = []
    if spec.lines_key:
        for line in record.get(spec.lines_key) or []:
            lines.append({key: line.get(key) for key in spec.line_fields if key in line})

    definitions = list_custom_field_definitions(db, tenant_id=tenant_id, module_key=module_key)
    values = load_custom_field_values(db, tenant_id=tenant_id, module_key=module_key, record_id=record_id)
    return {
        "module_key": module_key,
        "source_id": record_id,
        "fields": fields,
        "custom_fields": _copyable_custom_values(definitions, values),
        "lines": lines,
    }


def _custom_module_clone_draft(db: Session, *, module_key: str, record_id: int, current_user) -> dict[str, Any]:
    from app.modules.platform.services import custom_modules

    if not custom_modules.is_custom_module_key(db, tenant_id=current_user.tenant_id, module_key=module_key):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This module has no clone.")
    definitions, record, values = custom_modules.clone_source(db, module_key=module_key, record_id=record_id, current_user=current_user)
    return {
        "module_key": module_key,
        "source_id": record_id,
        "fields": {"title": record.title},
        "custom_fields": _copyable_custom_values(definitions, values),
        "lines": [],
    }
