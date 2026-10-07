from __future__ import annotations

import logging
from dataclasses import dataclass, replace

from fastapi import HTTPException, status
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.modules.platform.models import RecordLayoutDefinition
from app.modules.platform.record_layout_schema import (
    RecordLayoutAdminStateResponse,
    RecordLayoutCatalogField,
    RecordLayoutDefinitionPayload,
    RecordLayoutFieldDefinition,
    RecordLayoutPreviewResponse,
    RecordLayoutSectionDefinition,
    RecordLayoutSurface,
    RecordLayoutValidationReport,
    ResolvedRecordLayoutField,
    ResolvedRecordLayoutResponse,
    ResolvedRecordLayoutSection,
)
from app.modules.platform.services.activity_logs import safe_log_activity
from app.modules.platform.services.custom_fields import list_custom_field_definitions
from app.modules.platform.services.module_fields import module_field_enabled_map, module_field_rules
from app.modules.user_management.models import Role, Team


# Which (module, surface) pairs the runtime resolver will answer for. Opportunity's `detail`
# surface was held back for "the Opportunity workspace slice" — that is rebuild 5.3 batch 1,
# which lands the deal on the record archetype, so it opens here: the archetype's `Details`
# tab is `ReadOnlyRecordLayout` on the resolved layout, so a record page without one would be
# the only page rendering its fields a private way.
#
# Quotes, orders and invoices have no `custom_fields` column, which costs nothing: the catalog
# merges custom definitions when a module has them and is simply system-only here. They are
# `detail`-only: their create and edit surfaces keep `RecordFormLayout` and a manual save,
# because R1 does not autosave a document whose totals derive from its line items.
SUPPORTED_LAYOUT_SURFACES_BY_MODULE: dict[str, set[str]] = {
    "sales_leads": {"quick_create", "detail"},
    "sales_contacts": {"quick_create", "detail"},
    "sales_organizations": {"quick_create", "detail"},
    "sales_opportunities": {"quick_create", "detail"},
    "sales_quotes": {"detail"},
    "sales_orders": {"detail"},
    "finance_pos": {"detail"},
    "catalog_products": {"detail"},
    "catalog_services": {"detail"},
}
SUPPORTED_LAYOUT_MODULES = set(SUPPORTED_LAYOUT_SURFACES_BY_MODULE)
SUPPORTED_LAYOUT_SURFACES = {"quick_create", "detail", "full_form"}
# The surfaces that create a record: a field the domain needs must stay visible and writable.
CREATE_SURFACES = {"quick_create", "full_form"}

# Guidance thresholds for Quick Create. They produce warnings, never blocking errors: a
# tenant workflow that genuinely needs a long form is allowed, just told what it costs.
QUICK_CREATE_RECOMMENDED_MIN_FIELDS = 5
QUICK_CREATE_RECOMMENDED_MAX_FIELDS = 8
QUICK_CREATE_RECOMMENDED_MAX_SECTIONS = 2
QUICK_CREATE_SLOW_FIELD_TYPES = {"long_text", "file"}

LAYOUT_ENTITY_TYPE = "record_layout"

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RuntimeFieldDefinition:
    field_key: str
    label: str
    field_type: str
    required: bool = False
    readonly: bool = False
    field_source: str = "system"
    placeholder: str | None = None
    help_text: str | None = None
    # A `picklist` field's list (13b §3.3); the form offers that list's active values.
    picklist_key: str | None = None


def _field_map(*fields: RuntimeFieldDefinition) -> dict[str, RuntimeFieldDefinition]:
    return {field.field_key: field for field in fields}


# `required` here means "the domain rejects a create without it", not "an administrator
# marked it required". It is what stops a layout from hiding a field the create endpoint
# still demands, so each entry must match the module's create schema and service.
LEAD_SYSTEM_FIELDS = _field_map(
    RuntimeFieldDefinition("first_name", "First name", "text"),
    RuntimeFieldDefinition("last_name", "Last name", "text"),
    RuntimeFieldDefinition("company", "Company", "text"),
    # Email or a phone (13a A9): neither alone is required by the domain.
    RuntimeFieldDefinition("primary_email", "Email", "email"),
    RuntimeFieldDefinition("phone", "Phone", "phone"),
    RuntimeFieldDefinition("mobile_phone", "Mobile", "phone"),
    RuntimeFieldDefinition("title", "Job title", "text"),
    RuntimeFieldDefinition("source", "Source", "picklist", picklist_key="lead_source"),
    RuntimeFieldDefinition("status", "Status", "picklist", picklist_key="lead_status"),
    RuntimeFieldDefinition("notes", "Notes", "long_text"),
    RuntimeFieldDefinition("assigned_to", "Owner", "user_reference"),
    RuntimeFieldDefinition("team_id", "Team", "team_reference"),
    RuntimeFieldDefinition("next_follow_up_at", "Next follow-up", "datetime"),
    RuntimeFieldDefinition("tags", "Tags", "tags"),
)

CONTACT_SYSTEM_FIELDS = _field_map(
    RuntimeFieldDefinition("salutation", "Salutation", "picklist", picklist_key="salutation"),
    RuntimeFieldDefinition("first_name", "First name", "text"),
    RuntimeFieldDefinition("last_name", "Last name", "text"),
    RuntimeFieldDefinition("primary_email", "Email", "email"),
    RuntimeFieldDefinition("contact_telephone", "Work phone", "phone"),
    RuntimeFieldDefinition("mobile_phone", "Mobile", "phone"),
    RuntimeFieldDefinition("current_title", "Job title", "text"),
    RuntimeFieldDefinition("linkedin_url", "LinkedIn", "url"),
    RuntimeFieldDefinition("organization_id", "Account", "organization_reference"),
    RuntimeFieldDefinition("assigned_to", "Owner", "user_reference"),
    RuntimeFieldDefinition("region", "Region", "picklist", picklist_key="region"),
    RuntimeFieldDefinition("mailing_address", "Street", "text"),
    RuntimeFieldDefinition("mailing_street2", "Street, line 2", "text"),
    RuntimeFieldDefinition("mailing_city", "City", "text"),
    RuntimeFieldDefinition("mailing_state", "State or province", "text"),
    RuntimeFieldDefinition("mailing_postal_code", "Postal code", "text"),
    RuntimeFieldDefinition("country", "Country", "picklist", picklist_key="country"),
    RuntimeFieldDefinition("email_opt_out", "Email opt-out", "boolean"),
)

ORGANIZATION_SYSTEM_FIELDS = _field_map(
    RuntimeFieldDefinition("org_name", "Account name", "text", required=True),
    RuntimeFieldDefinition("account_type", "Type", "picklist", picklist_key="account_type"),
    RuntimeFieldDefinition("primary_email", "Primary email", "email"),
    RuntimeFieldDefinition("secondary_email", "Secondary email", "email"),
    RuntimeFieldDefinition("primary_phone", "Primary phone", "phone"),
    RuntimeFieldDefinition("secondary_phone", "Secondary phone", "phone"),
    RuntimeFieldDefinition("website", "Website", "url"),
    RuntimeFieldDefinition("industry", "Industry", "picklist", picklist_key="industry"),
    RuntimeFieldDefinition("annual_revenue", "Annual revenue", "currency"),
    RuntimeFieldDefinition("employee_count", "Employees", "number"),
    RuntimeFieldDefinition("assigned_to", "Owner", "user_reference"),
    RuntimeFieldDefinition("billing_address", "Billing street", "text"),
    RuntimeFieldDefinition("billing_street2", "Billing street, line 2", "text"),
    RuntimeFieldDefinition("billing_city", "Billing city", "text"),
    RuntimeFieldDefinition("billing_state", "Billing state or province", "text"),
    RuntimeFieldDefinition("billing_postal_code", "Billing postal code", "text"),
    RuntimeFieldDefinition("billing_country", "Billing country", "picklist", picklist_key="country"),
    RuntimeFieldDefinition("shipping_address", "Shipping street", "text"),
    RuntimeFieldDefinition("shipping_street2", "Shipping street, line 2", "text"),
    RuntimeFieldDefinition("shipping_city", "Shipping city", "text"),
    RuntimeFieldDefinition("shipping_state", "Shipping state or province", "text"),
    RuntimeFieldDefinition("shipping_postal_code", "Shipping postal code", "text"),
    RuntimeFieldDefinition("shipping_country", "Shipping country", "picklist", picklist_key="country"),
    # Billing and purchasing (12-erp E4, E5): on the full form since 13b Phase 4e.
    RuntimeFieldDefinition("is_vendor", "Vendor", "boolean"),
    RuntimeFieldDefinition("payment_terms_days", "Payment terms (days)", "number"),
)

# Opportunity keeps the legacy single primary contact. Multi-contact participants are
# workstream 05 and must not be anticipated here.
#
# The delivery fields below existed on the model and were drawn by a private renderer on the
# deal page; opening the `detail` surface is what brings them into the shared catalog, so a
# tenant can reorder or disable them like every other field.
OPPORTUNITY_SYSTEM_FIELDS = _field_map(
    RuntimeFieldDefinition("opportunity_name", "Deal name", "text", required=True),
    # An account or a contact (13a H13): neither alone is required by the domain.
    RuntimeFieldDefinition("contact_id", "Contact", "contact_reference"),
    RuntimeFieldDefinition("organization_id", "Account", "organization_reference"),
    RuntimeFieldDefinition("sales_stage", "Stage", "select"),
    RuntimeFieldDefinition("amount", "Amount", "currency"),
    RuntimeFieldDefinition("currency_type", "Currency", "select"),
    RuntimeFieldDefinition("probability_percent", "Probability", "percent"),
    RuntimeFieldDefinition("expected_close_date", "Expected close date", "date"),
    RuntimeFieldDefinition("start_date", "Start date", "date"),
    RuntimeFieldDefinition("deal_type", "Type", "picklist", picklist_key="deal_type"),
    RuntimeFieldDefinition("source", "Source", "picklist", picklist_key="lead_source"),
    RuntimeFieldDefinition("next_step", "Next step", "text"),
    RuntimeFieldDefinition("lost_reason", "Lost reason", "picklist", picklist_key="lost_reason"),
    RuntimeFieldDefinition("assigned_to", "Owner", "user_reference"),
)

# The three line-item documents. None of them has a create-surface layout —
# `/new` and `/[id]/edit` stay on `RecordFormLayout` because R1 keeps a document body on an
# explicit save — so nothing here is `required` and these catalogs describe only the
# read-only `detail` surface the record archetype renders.
#
# Line items are absent on purpose: they are rows pointing at the document, not columns on
# it, so the page draws them under the layout rather than the layout listing them.
QUOTE_SYSTEM_FIELDS = _field_map(
    RuntimeFieldDefinition("quote_number", "Quote number", "text"),
    RuntimeFieldDefinition("title", "Title", "text"),
    RuntimeFieldDefinition("customer_name", "Customer name", "text"),
    RuntimeFieldDefinition("status", "Status", "select"),
    RuntimeFieldDefinition("issue_date", "Issue date", "date"),
    RuntimeFieldDefinition("expiry_date", "Expiry date", "date"),
    RuntimeFieldDefinition("currency", "Currency", "select"),
    RuntimeFieldDefinition("subtotal_amount", "Subtotal", "text"),
    RuntimeFieldDefinition("discount_amount", "Discount", "text"),
    RuntimeFieldDefinition("tax_amount", "Tax", "text"),
    RuntimeFieldDefinition("total_amount", "Total", "text"),
    RuntimeFieldDefinition("notes", "Notes", "long_text"),
    RuntimeFieldDefinition("billing_address", "Billing street", "text"),
    RuntimeFieldDefinition("billing_street2", "Billing street, line 2", "text"),
    RuntimeFieldDefinition("billing_city", "Billing city", "text"),
    RuntimeFieldDefinition("billing_state", "Billing state or province", "text"),
    RuntimeFieldDefinition("billing_postal_code", "Billing postal code", "text"),
    RuntimeFieldDefinition("billing_country", "Billing country", "picklist", picklist_key="country"),
    RuntimeFieldDefinition("shipping_address", "Shipping street", "text"),
    RuntimeFieldDefinition("shipping_street2", "Shipping street, line 2", "text"),
    RuntimeFieldDefinition("shipping_city", "Shipping city", "text"),
    RuntimeFieldDefinition("shipping_state", "Shipping state or province", "text"),
    RuntimeFieldDefinition("shipping_postal_code", "Shipping postal code", "text"),
    RuntimeFieldDefinition("shipping_country", "Shipping country", "picklist", picklist_key="country"),
    RuntimeFieldDefinition("customer_po_reference", "Customer PO reference", "text"),
    RuntimeFieldDefinition("shipping_method", "Shipping method", "picklist", picklist_key="shipping_method"),
    RuntimeFieldDefinition(
        "shipping_charge",
        "Shipping charge",
        "currency",
        help_text="Added to the total, and invoiced with the order's first invoice.",
    ),
    RuntimeFieldDefinition("terms_and_conditions", "Terms and conditions", "long_text"),
    RuntimeFieldDefinition("lost_reason", "Declined reason", "picklist", picklist_key="lost_reason"),
    RuntimeFieldDefinition("contact_id", "Contact", "contact_reference"),
    RuntimeFieldDefinition("organization_id", "Account", "organization_reference"),
    RuntimeFieldDefinition(
        "opportunity_id",
        "Deal",
        "opportunity_reference",
        help_text="When linked, the contact must be one of this deal's participants and the account must match the deal.",
    ),
    RuntimeFieldDefinition("assigned_to", "Owner", "user_reference"),
)

ORDER_SYSTEM_FIELDS = _field_map(
    RuntimeFieldDefinition("order_number", "Order number", "text"),
    RuntimeFieldDefinition("status", "Status", "select"),
    # An account or a contact (`QUICK_CREATE_ONE_OF`); neither alone is required.
    RuntimeFieldDefinition("organization_id", "Account", "organization_reference"),
    RuntimeFieldDefinition("contact_id", "Contact", "contact_reference"),
    RuntimeFieldDefinition(
        "opportunity_id",
        "Deal",
        "opportunity_reference",
        help_text="Orders for an accepted quote are better created with the quote's Convert to order.",
    ),
    RuntimeFieldDefinition("currency", "Currency", "select"),
    RuntimeFieldDefinition(
        "exchange_rate",
        "Exchange rate",
        "decimal",
        help_text="Base currency for one unit of the order's currency. Optional: used for the order's margin.",
    ),
    RuntimeFieldDefinition(
        "warehouse_id",
        "Warehouse",
        "warehouse_reference",
        help_text="Stock is reserved and shipped from here.",
    ),
    RuntimeFieldDefinition(
        "priority",
        "Priority",
        "select",
        help_text="Arriving stock goes to waiting orders by priority, then oldest first.",
    ),
    RuntimeFieldDefinition("subtotal", "Subtotal", "text"),
    RuntimeFieldDefinition("discount_total", "Discount", "text"),
    RuntimeFieldDefinition("tax_total", "Tax", "text"),
    RuntimeFieldDefinition("grand_total", "Total", "text"),
    RuntimeFieldDefinition("delivery_date", "Delivery date", "date"),
    RuntimeFieldDefinition("billing_address", "Billing street", "text"),
    RuntimeFieldDefinition("billing_street2", "Billing street, line 2", "text"),
    RuntimeFieldDefinition("billing_city", "Billing city", "text"),
    RuntimeFieldDefinition("billing_state", "Billing state or province", "text"),
    RuntimeFieldDefinition("billing_postal_code", "Billing postal code", "text"),
    RuntimeFieldDefinition("billing_country", "Billing country", "picklist", picklist_key="country"),
    RuntimeFieldDefinition("shipping_address", "Shipping street", "text"),
    RuntimeFieldDefinition("shipping_street2", "Shipping street, line 2", "text"),
    RuntimeFieldDefinition("shipping_city", "Shipping city", "text"),
    RuntimeFieldDefinition("shipping_state", "Shipping state or province", "text"),
    RuntimeFieldDefinition("shipping_postal_code", "Shipping postal code", "text"),
    RuntimeFieldDefinition("shipping_country", "Shipping country", "picklist", picklist_key="country"),
    RuntimeFieldDefinition("customer_po_reference", "Customer PO reference", "text"),
    RuntimeFieldDefinition("shipping_method", "Shipping method", "picklist", picklist_key="shipping_method"),
    RuntimeFieldDefinition(
        "shipping_charge",
        "Shipping charge",
        "currency",
        help_text="Added to the total, and invoiced with the order's first invoice.",
    ),
    RuntimeFieldDefinition("terms_and_conditions", "Terms and conditions", "long_text"),
    RuntimeFieldDefinition("lost_reason", "Cancellation reason", "picklist", picklist_key="lost_reason"),
    RuntimeFieldDefinition("payment_terms", "Payment terms", "text"),
    RuntimeFieldDefinition("notes", "Notes", "long_text"),
    RuntimeFieldDefinition("owner_id", "Owner", "user_reference"),
    # Where the order came from (13 F1.3); written by the website and portal intake only.
    RuntimeFieldDefinition("source", "Source", "text", readonly=True),
    RuntimeFieldDefinition("channel", "Channel", "text", readonly=True),
    RuntimeFieldDefinition("external_reference", "External reference", "text", readonly=True),
)

# `balance_due` and `payment_status` are maintained by the payment path rather than written
# by an operator, so they are `readonly` in the catalog as well as absent from the seed: a
# tenant may add them to `Details`, and adding them must not imply they can be edited.
POS_INVOICE_SYSTEM_FIELDS = _field_map(
    RuntimeFieldDefinition("invoice_number", "Invoice number", "text"),
    RuntimeFieldDefinition("status", "Status", "select"),
    RuntimeFieldDefinition("payment_status", "Payment status", "select", readonly=True),
    # `select`, not `text`: the values are a closed set (`card`, `cash`, `bank_transfer`) and
    # the read-only renderer only sentence-cases a `select`, so as `text` the page drew `card`.
    RuntimeFieldDefinition("payment_method", "Payment method", "picklist", picklist_key="payment_method"),
    RuntimeFieldDefinition("customer_name", "Customer name", "text"),
    RuntimeFieldDefinition("customer_organization_id", "Account", "organization_reference"),
    RuntimeFieldDefinition("customer_contact_id", "Contact", "contact_reference"),
    RuntimeFieldDefinition("customer_email", "Customer email", "email"),
    RuntimeFieldDefinition("customer_address", "Billing address", "long_text"),
    RuntimeFieldDefinition("issue_date", "Issue date", "date"),
    RuntimeFieldDefinition(
        "due_date",
        "Due date",
        "date",
        help_text="Blank uses the account's payment terms when the invoice is issued.",
    ),
    RuntimeFieldDefinition("currency", "Currency", "select"),
    RuntimeFieldDefinition("subtotal_amount", "Subtotal", "text"),
    RuntimeFieldDefinition("discount_amount", "Discount", "text"),
    RuntimeFieldDefinition("tax_rate", "Tax rate", "text"),
    RuntimeFieldDefinition("tax_amount", "Tax", "text"),
    RuntimeFieldDefinition("total_amount", "Total", "text"),
    RuntimeFieldDefinition("amount_paid", "Paid", "text", readonly=True),
    RuntimeFieldDefinition("amount_credited", "Credited", "text", readonly=True),
    RuntimeFieldDefinition("balance_due", "Balance due", "text", readonly=True),
    RuntimeFieldDefinition("payment_terms", "Payment terms", "long_text"),
    RuntimeFieldDefinition("notes", "Notes", "long_text"),
)

# The catalog pair's `/new` and `/[id]/edit` pages draw the `full_form` layout (13b Phase 4e);
# inventory, purchasing and media stay fixed sections of the product page.
#
# `is_active` and `is_public` are booleans whose values are named states, so the rail edits
# them (design.md §4.7) and neither is seeded here. `media_url` is absent on purpose: the
# catalog image is the record's public body and renders under the layout, the same shape the
# three line-item documents use for their items.
CATALOG_PRODUCT_SYSTEM_FIELDS = _field_map(
    RuntimeFieldDefinition("name", "Name", "text", required=True),
    RuntimeFieldDefinition("sku", "SKU", "text"),
    RuntimeFieldDefinition("barcode", "Barcode", "text"),
    RuntimeFieldDefinition("category_name", "Category", "text", readonly=True),
    # The writable side of the category, for forms; `category_name` is what details show.
    RuntimeFieldDefinition(
        "category_id",
        "Category",
        "category_reference",
        help_text="Group items the way your team browses them. Administrators add categories under Settings.",
    ),
    RuntimeFieldDefinition(
        "unit",
        "Unit",
        "picklist",
        picklist_key="unit",
        help_text="What one of this is. Administrators manage units under Settings → Picklists.",
    ),
    RuntimeFieldDefinition("slug", "Public slug", "text"),
    RuntimeFieldDefinition("description", "Description", "long_text"),
    RuntimeFieldDefinition(
        "list_price",
        "List price",
        "currency",
        help_text="New quote and order lines start at this price. Blank on a new item takes the website price.",
    ),
    RuntimeFieldDefinition("public_unit_price", "Website price", "currency"),
    RuntimeFieldDefinition("tax_category", "Tax category", "picklist", picklist_key="tax_category"),
    RuntimeFieldDefinition("weight", "Weight", "decimal"),
    RuntimeFieldDefinition("weight_unit", "Weight unit", "text"),
    RuntimeFieldDefinition("length", "Length", "decimal"),
    RuntimeFieldDefinition("width", "Width", "decimal"),
    RuntimeFieldDefinition("height", "Height", "decimal"),
    RuntimeFieldDefinition("dimension_unit", "Dimension unit", "text"),
    RuntimeFieldDefinition("cost_price", "Cost", "text"),
    RuntimeFieldDefinition("currency", "Currency", "select"),
    RuntimeFieldDefinition("stock_status", "Stock status", "select"),
    RuntimeFieldDefinition("stock_quantity", "Stock quantity", "text"),
    RuntimeFieldDefinition("is_public", "Website feed", "boolean"),
    RuntimeFieldDefinition("is_active", "Active", "boolean"),
)

CATALOG_SERVICE_SYSTEM_FIELDS = _field_map(
    RuntimeFieldDefinition("name", "Name", "text", required=True),
    RuntimeFieldDefinition("sku", "SKU", "text"),
    RuntimeFieldDefinition("category_name", "Category", "text", readonly=True),
    # The writable side of the category, for forms; `category_name` is what details show.
    RuntimeFieldDefinition(
        "category_id",
        "Category",
        "category_reference",
        help_text="Group items the way your team browses them. Administrators add categories under Settings.",
    ),
    RuntimeFieldDefinition(
        "unit",
        "Unit",
        "picklist",
        picklist_key="unit",
        help_text="What one of this is. Administrators manage units under Settings → Picklists.",
    ),
    RuntimeFieldDefinition("slug", "Public slug", "text"),
    RuntimeFieldDefinition("description", "Description", "long_text"),
    RuntimeFieldDefinition(
        "list_price",
        "List price",
        "currency",
        help_text="New quote and order lines start at this price. Blank on a new item takes the website price.",
    ),
    RuntimeFieldDefinition("public_unit_price", "Website price", "currency"),
    RuntimeFieldDefinition("tax_category", "Tax category", "picklist", picklist_key="tax_category"),
    RuntimeFieldDefinition("cost_price", "Cost", "text"),
    RuntimeFieldDefinition("currency", "Currency", "select"),
    RuntimeFieldDefinition("is_public", "Website feed", "boolean"),
    RuntimeFieldDefinition("is_active", "Active", "boolean"),
)

MODULE_SYSTEM_FIELDS: dict[str, dict[str, RuntimeFieldDefinition]] = {
    "sales_leads": LEAD_SYSTEM_FIELDS,
    "sales_contacts": CONTACT_SYSTEM_FIELDS,
    "sales_organizations": ORGANIZATION_SYSTEM_FIELDS,
    "sales_opportunities": OPPORTUNITY_SYSTEM_FIELDS,
    "sales_quotes": QUOTE_SYSTEM_FIELDS,
    "sales_orders": ORDER_SYSTEM_FIELDS,
    "finance_pos": POS_INVOICE_SYSTEM_FIELDS,
    "catalog_products": CATALOG_PRODUCT_SYSTEM_FIELDS,
    "catalog_services": CATALOG_SERVICE_SYSTEM_FIELDS,
}


def _seed_section(
    section_id: str,
    label: str,
    position: int,
    fields: list[tuple[str, str]],
    *,
    region: str = "main",
    collapsed_by_default: bool = False,
) -> RecordLayoutSectionDefinition:
    """A seed section written as an ordered `(field_key, width)` table."""

    return RecordLayoutSectionDefinition(
        id=section_id,
        label=label,
        position=position,
        region=region,  # type: ignore[arg-type]
        collapsed_by_default=collapsed_by_default,
        fields=[
            RecordLayoutFieldDefinition(field_key=field_key, position=index, width=width)  # type: ignore[arg-type]
            for index, (field_key, width) in enumerate(fields)
        ],
    )


def _seed(
    module_key: str,
    surface: str,
    name: str,
    sections: list[RecordLayoutSectionDefinition],
) -> RecordLayoutDefinitionPayload:
    return RecordLayoutDefinitionPayload(
        module_key=module_key,
        surface=surface,  # type: ignore[arg-type]
        name=name,
        version=1,
        sections=sections,
    )


# The system fallback for every supported (module, surface). These mirror what the canonical
# forms and detail pages already show, so a tenant that never opens the layout builder sees
# no behaviour change. Quick Create seeds stay inside the 5–8 field guidance.
MODULE_LAYOUT_SEEDS: dict[str, dict[str, RecordLayoutDefinitionPayload]] = {
    "sales_leads": {
        "quick_create": _seed(
            "sales_leads",
            "quick_create",
            "Lead Quick Create",
            [
                _seed_section(
                    "contact",
                    "Contact",
                    0,
                    [
                        ("first_name", "half"),
                        ("last_name", "half"),
                        ("company", "full"),
                        ("primary_email", "full"),
                        ("phone", "half"),
                        ("mobile_phone", "half"),
                    ],
                ),
                _seed_section(
                    "qualification",
                    "Qualification",
                    1,
                    # Source belongs on the first screen (13a H25): it is how leads are reported.
                    [("status", "half"), ("source", "half"), ("assigned_to", "half")],
                ),
            ],
        ),
        "detail": _seed(
            "sales_leads",
            "detail",
            "Lead Details",
            [
                _seed_section(
                    "contact",
                    "Contact",
                    0,
                    [
                        ("primary_email", "half"),
                        ("phone", "half"),
                        ("mobile_phone", "half"),
                        ("company", "half"),
                        ("title", "half"),
                    ],
                ),
                _seed_section(
                    "qualification",
                    "Qualification",
                    1,
                    [
                        ("source", "half"),
                        ("status", "half"),
                        ("assigned_to", "half"),
                        ("team_id", "half"),
                        ("next_follow_up_at", "full"),
                        ("tags", "full"),
                        ("notes", "full"),
                    ],
                ),
            ],
        ),
    },
    "sales_contacts": {
        "quick_create": _seed(
            "sales_contacts",
            "quick_create",
            "Contact Quick Create",
            [
                _seed_section(
                    "identity",
                    "Contact",
                    0,
                    [
                        ("first_name", "half"),
                        ("last_name", "half"),
                        ("primary_email", "full"),
                        ("contact_telephone", "half"),
                        ("current_title", "half"),
                    ],
                ),
                _seed_section(
                    "account",
                    "Account and ownership",
                    1,
                    [("organization_id", "half"), ("assigned_to", "half")],
                ),
            ],
        ),
        "detail": _seed(
            "sales_contacts",
            "detail",
            "Contact Details",
            [
                _seed_section(
                    "identity",
                    "Contact",
                    0,
                    [
                        ("salutation", "half"),
                        ("current_title", "half"),
                        ("primary_email", "half"),
                        ("contact_telephone", "half"),
                        ("mobile_phone", "half"),
                        ("linkedin_url", "half"),
                    ],
                ),
                _seed_section(
                    "account",
                    "Account and ownership",
                    1,
                    [
                        ("organization_id", "half"),
                        ("assigned_to", "half"),
                        ("region", "half"),
                        ("email_opt_out", "half"),
                    ],
                ),
                _seed_section(
                    "address",
                    "Mailing address",
                    2,
                    [
                        ("mailing_address", "full"),
                        ("mailing_street2", "full"),
                        ("mailing_city", "half"),
                        ("mailing_state", "half"),
                        ("mailing_postal_code", "half"),
                        ("country", "half"),
                    ],
                ),
            ],
        ),
    },
    "sales_organizations": {
        "quick_create": _seed(
            "sales_organizations",
            "quick_create",
            "Account Quick Create",
            [
                _seed_section(
                    "account",
                    "Account",
                    0,
                    [
                        ("org_name", "full"),
                        ("primary_email", "full"),
                        ("primary_phone", "half"),
                        ("website", "half"),
                    ],
                ),
                _seed_section(
                    "profile",
                    "Profile and ownership",
                    1,
                    [("industry", "half"), ("assigned_to", "half")],
                ),
            ],
        ),
        "detail": _seed(
            "sales_organizations",
            "detail",
            "Account Details",
            [
                _seed_section(
                    "account",
                    "Account",
                    0,
                    [
                        ("primary_email", "half"),
                        ("secondary_email", "half"),
                        ("primary_phone", "half"),
                        ("secondary_phone", "half"),
                        ("website", "half"),
                        ("account_type", "half"),
                        ("industry", "half"),
                        ("annual_revenue", "half"),
                        ("employee_count", "half"),
                        ("assigned_to", "half"),
                    ],
                ),
                _seed_section(
                    "billing",
                    "Billing address",
                    1,
                    [
                        ("billing_address", "full"),
                        ("billing_street2", "full"),
                        ("billing_city", "half"),
                        ("billing_state", "half"),
                        ("billing_postal_code", "half"),
                        ("billing_country", "half"),
                    ],
                ),
                _seed_section(
                    "shipping",
                    "Shipping address",
                    2,
                    [
                        ("shipping_address", "full"),
                        ("shipping_street2", "full"),
                        ("shipping_city", "half"),
                        ("shipping_state", "half"),
                        ("shipping_postal_code", "half"),
                        ("shipping_country", "half"),
                    ],
                ),
            ],
        ),
    },
    "sales_opportunities": {
        "quick_create": _seed(
            "sales_opportunities",
            "quick_create",
            "Deal Quick Create",
            [
                _seed_section(
                    "deal",
                    "Deal",
                    0,
                    [
                        ("opportunity_name", "full"),
                        ("contact_id", "half"),
                        ("organization_id", "half"),
                        ("sales_stage", "half"),
                        ("expected_close_date", "half"),
                    ],
                ),
                _seed_section(
                    "value",
                    "Value and ownership",
                    1,
                    [("amount", "half"), ("assigned_to", "half")],
                ),
            ],
        ),
        # Stage, contact, account and owner are absent on purpose: the record spine owns them
        # (design.md §4.7) and the page passes them to `omitFieldKeys` anyway. Leaving them out
        # of the seed means the default layout an administrator opens matches the page.
        "detail": _seed(
            "sales_opportunities",
            "detail",
            "Deal Details",
            [
                _seed_section(
                    "commercial",
                    "Commercial",
                    0,
                    [
                        ("amount", "half"),
                        ("currency_type", "half"),
                        ("probability_percent", "half"),
                        ("expected_close_date", "half"),
                        ("deal_type", "half"),
                        ("source", "half"),
                        ("next_step", "full"),
                        ("lost_reason", "half"),
                        ("start_date", "half"),
                    ],
                ),
            ],
        ),
    },
    "sales_quotes": {
        "detail": _seed(
            "sales_quotes",
            "detail",
            "Quote Details",
            [
                _seed_section(
                    "quote",
                    "Quote",
                    0,
                    [
                        ("title", "full"),
                        ("issue_date", "half"),
                        ("expiry_date", "half"),
                        ("notes", "full"),
                    ],
                ),
                _seed_section(
                    "totals",
                    "Totals",
                    1,
                    [
                        ("subtotal_amount", "half"),
                        ("discount_amount", "half"),
                        ("tax_amount", "half"),
                        ("total_amount", "half"),
                        ("currency", "half"),
                    ],
                ),
            ],
        ),
    },
    "sales_orders": {
        "detail": _seed(
            "sales_orders",
            "detail",
            "Order Details",
            [
                _seed_section(
                    "fulfillment",
                    "Fulfilment",
                    0,
                    [("delivery_date", "half"), ("shipping_method", "half"), ("shipping_address", "full"), ("shipping_city", "half"),
                     ("shipping_country", "half"), ("customer_po_reference", "half")],
                ),
                _seed_section(
                    "totals",
                    "Totals",
                    1,
                    [
                        ("subtotal", "half"),
                        ("discount_total", "half"),
                        ("tax_total", "half"),
                        ("grand_total", "half"),
                        ("currency", "half"),
                    ],
                ),
                _seed_section(
                    "terms",
                    "Terms and notes",
                    2,
                    [("payment_terms", "full"), ("notes", "full")],
                ),
            ],
        ),
    },
    # `payment_status` and `balance_due` sit in the rail beside the status they qualify, so
    # neither is seeded here; `amount_paid` is seeded because the totals column is where an
    # operator reconciles the document, and it is read-only in the catalog either way.
    "finance_pos": {
        "detail": _seed(
            "finance_pos",
            "detail",
            "Invoice Details",
            [
                _seed_section(
                    "billing",
                    "Billing",
                    0,
                    [
                        ("customer_email", "half"),
                        ("payment_method", "half"),
                        ("issue_date", "half"),
                        ("due_date", "half"),
                        ("customer_address", "full"),
                    ],
                ),
                _seed_section(
                    "totals",
                    "Totals",
                    1,
                    [
                        ("subtotal_amount", "half"),
                        ("discount_amount", "half"),
                        ("tax_rate", "half"),
                        ("tax_amount", "half"),
                        ("total_amount", "half"),
                        ("amount_paid", "half"),
                        ("amount_credited", "half"),
                        ("currency", "half"),
                    ],
                ),
                _seed_section(
                    "terms",
                    "Terms and notes",
                    2,
                    [("payment_terms", "full"), ("notes", "full")],
                ),
            ],
        ),
    },
    # The catalog pair. Each omits what the record page already draws elsewhere (design.md
    # §4.7): the header's name, the rail's State fields, and the rail's `Connected` links.
    #
    # `name` is the header's, and `is_active`, `is_public` and `stock_status` are the rail's
    # three State fields, so none of the four is seeded. The catalog image is not a field at
    # all — it renders under the layout.
    "catalog_products": {
        "detail": _seed(
            "catalog_products",
            "detail",
            "Product Details",
            [
                _seed_section(
                    "catalog",
                    "Catalog",
                    0,
                    [
                        ("sku", "half"),
                        ("barcode", "half"),
                        ("category_name", "half"),
                        ("unit", "half"),
                        ("slug", "half"),
                        ("description", "full"),
                    ],
                ),
                _seed_section(
                    "pricing",
                    "Pricing",
                    1,
                    [("list_price", "half"), ("public_unit_price", "half"), ("currency", "half"), ("cost_price", "half"), ("tax_category", "half")],
                ),
                _seed_section("inventory", "Inventory", 2, [("stock_quantity", "half")]),
            ],
        ),
    },
    "catalog_services": {
        "detail": _seed(
            "catalog_services",
            "detail",
            "Service Details",
            [
                _seed_section(
                    "catalog",
                    "Catalog",
                    0,
                    [
                        ("sku", "half"),
                        ("category_name", "half"),
                        ("unit", "half"),
                        ("slug", "half"),
                        ("description", "full"),
                    ],
                ),
                _seed_section(
                    "pricing",
                    "Pricing",
                    1,
                    [("list_price", "half"), ("public_unit_price", "half"), ("currency", "half"), ("cost_price", "half"), ("tax_category", "half")],
                ),
            ],
        ),
    },
}

# Kept as a name for the Lead surfaces specifically; the resolver reads the registry above.
LEAD_LAYOUT_SEEDS: dict[str, RecordLayoutDefinitionPayload] = MODULE_LAYOUT_SEEDS["sales_leads"]


# --- 13b Phase 4 slice 4d: full forms everywhere, ERP document headers -------------------
#
# Every module gets a `full_form` surface, and the ERP documents get `detail` and `full_form`
# header layouts. Line editors stay fixed: lines are rows under the header, not fields on it.
# `required` keeps its meaning above — what the create endpoint refuses without — and
# `readonly` marks what the system writes (numbers, statuses, totals, posting stamps), which
# a form never offers.

PURCHASE_ORDER_SYSTEM_FIELDS = _field_map(
    RuntimeFieldDefinition("number", "PO number", "text", readonly=True),
    RuntimeFieldDefinition("vendor_id", "Vendor", "organization_reference", required=True),
    RuntimeFieldDefinition("warehouse_id", "Deliver to", "warehouse_reference"),
    RuntimeFieldDefinition("expected_date", "Expected date", "date"),
    RuntimeFieldDefinition("vendor_reference", "Vendor reference", "text"),
    RuntimeFieldDefinition("currency", "Currency", "select"),
    RuntimeFieldDefinition("exchange_rate", "Exchange rate", "decimal"),
    RuntimeFieldDefinition("notes", "Notes", "long_text"),
    # The person who created it; the purchasing endpoints do not take an owner.
    RuntimeFieldDefinition("owner_id", "Owner", "user_reference", readonly=True),
    RuntimeFieldDefinition("status", "Status", "select", readonly=True),
    RuntimeFieldDefinition("receipt_status", "Received", "select", readonly=True),
    RuntimeFieldDefinition("bill_status", "Billed", "select", readonly=True),
    RuntimeFieldDefinition("subtotal", "Subtotal", "currency", readonly=True),
    RuntimeFieldDefinition("ordered_at", "Ordered", "datetime", readonly=True),
    RuntimeFieldDefinition("close_reason", "Close reason", "text", readonly=True),
    RuntimeFieldDefinition("cancel_reason", "Cancellation reason", "text", readonly=True),
)

PURCHASE_RECEIPT_SYSTEM_FIELDS = _field_map(
    RuntimeFieldDefinition("number", "Receipt number", "text", readonly=True),
    RuntimeFieldDefinition("order_id", "Purchase order", "purchase_order_reference", required=True),
    # The purchase order's warehouse: a receipt brings stock in where the order said.
    RuntimeFieldDefinition("warehouse_id", "Warehouse", "warehouse_reference", readonly=True),
    RuntimeFieldDefinition("received_on", "Received on", "date"),
    RuntimeFieldDefinition("vendor_delivery_ref", "Vendor delivery note", "text"),
    RuntimeFieldDefinition("notes", "Notes", "long_text"),
    RuntimeFieldDefinition("status", "Status", "select", readonly=True),
    RuntimeFieldDefinition("posted_at", "Posted", "datetime", readonly=True),
    RuntimeFieldDefinition("cancel_reason", "Cancellation reason", "text", readonly=True),
)

PURCHASE_BILL_SYSTEM_FIELDS = _field_map(
    RuntimeFieldDefinition("number", "Bill number", "text", readonly=True),
    RuntimeFieldDefinition("vendor_id", "Vendor", "organization_reference", required=True),
    RuntimeFieldDefinition(
        "vendor_invoice_number",
        "Vendor invoice number",
        "text",
        required=True,
        help_text="As printed on the vendor's invoice; used to catch a bill entered twice.",
    ),
    RuntimeFieldDefinition("bill_date", "Bill date", "date", required=True),
    RuntimeFieldDefinition("due_date", "Due date", "date", help_text="Blank uses the vendor's payment terms."),
    RuntimeFieldDefinition("order_id", "Purchase order", "purchase_order_reference"),
    RuntimeFieldDefinition("receipt_id", "Receipt", "purchase_receipt_reference"),
    RuntimeFieldDefinition("currency", "Currency", "select"),
    RuntimeFieldDefinition("notes", "Notes", "long_text"),
    # The person who created it; the purchasing endpoints do not take an owner.
    RuntimeFieldDefinition("owner_id", "Owner", "user_reference", readonly=True),
    RuntimeFieldDefinition("status", "Status", "select", readonly=True),
    RuntimeFieldDefinition("payment_status", "Payment status", "select", readonly=True),
    RuntimeFieldDefinition("match_status", "Match", "select", readonly=True),
    RuntimeFieldDefinition("subtotal", "Subtotal", "currency", readonly=True),
    RuntimeFieldDefinition("tax_total", "Tax", "currency", readonly=True),
    RuntimeFieldDefinition("total", "Total", "currency", readonly=True),
    RuntimeFieldDefinition("amount_paid", "Paid", "currency", readonly=True),
    RuntimeFieldDefinition("balance_due", "Balance due", "currency", readonly=True),
    RuntimeFieldDefinition("posted_at", "Posted", "datetime", readonly=True),
    RuntimeFieldDefinition("void_reason", "Void reason", "text", readonly=True),
)

DELIVERY_SYSTEM_FIELDS = _field_map(
    RuntimeFieldDefinition("number", "Delivery number", "text", readonly=True),
    RuntimeFieldDefinition("order_id", "Order", "order_reference", required=True),
    # Where the order's stock is reserved; the delivery does not choose it.
    RuntimeFieldDefinition("warehouse_id", "Ship from", "warehouse_reference", readonly=True),
    RuntimeFieldDefinition("shipped_on", "Shipped on", "date"),
    RuntimeFieldDefinition("carrier", "Carrier", "text"),
    RuntimeFieldDefinition("tracking_number", "Tracking number", "text"),
    RuntimeFieldDefinition("notes", "Notes", "long_text"),
    RuntimeFieldDefinition("status", "Status", "select", readonly=True),
    RuntimeFieldDefinition("posted_at", "Posted", "datetime", readonly=True),
    RuntimeFieldDefinition("cancel_reason", "Cancellation reason", "text", readonly=True),
)

RETURN_SYSTEM_FIELDS = _field_map(
    RuntimeFieldDefinition("number", "Return number", "text", readonly=True),
    RuntimeFieldDefinition("delivery_id", "Delivery", "delivery_reference", required=True),
    RuntimeFieldDefinition("order_id", "Order", "order_reference", readonly=True),
    RuntimeFieldDefinition("warehouse_id", "Return to", "warehouse_reference"),
    RuntimeFieldDefinition("reason", "Reason", "text", required=True, placeholder="Damaged in transit"),
    RuntimeFieldDefinition("notes", "Notes", "long_text"),
    RuntimeFieldDefinition("status", "Status", "select", readonly=True),
    RuntimeFieldDefinition("received_at", "Received", "datetime", readonly=True),
    RuntimeFieldDefinition("cancel_reason", "Cancellation reason", "text", readonly=True),
)

ADJUSTMENT_SYSTEM_FIELDS = _field_map(
    RuntimeFieldDefinition("number", "Adjustment number", "text", readonly=True),
    RuntimeFieldDefinition("warehouse_id", "Warehouse", "warehouse_reference", required=True),
    RuntimeFieldDefinition("mode", "Adjustment type", "select", required=True),
    RuntimeFieldDefinition("reason", "Reason", "text", required=True),
    RuntimeFieldDefinition("notes", "Notes", "long_text"),
    RuntimeFieldDefinition("status", "Status", "select", readonly=True),
    RuntimeFieldDefinition("posted_at", "Posted", "datetime", readonly=True),
)

TRANSFER_SYSTEM_FIELDS = _field_map(
    RuntimeFieldDefinition("number", "Transfer number", "text", readonly=True),
    RuntimeFieldDefinition("from_warehouse_id", "From warehouse", "warehouse_reference", required=True),
    RuntimeFieldDefinition("to_warehouse_id", "To warehouse", "warehouse_reference", required=True),
    RuntimeFieldDefinition("notes", "Notes", "long_text"),
    RuntimeFieldDefinition("status", "Status", "select", readonly=True),
    RuntimeFieldDefinition("posted_at", "Posted", "datetime", readonly=True),
)

CREDIT_NOTE_SYSTEM_FIELDS = _field_map(
    RuntimeFieldDefinition("number", "Credit note number", "text", readonly=True),
    RuntimeFieldDefinition("invoice_id", "Invoice", "invoice_reference"),
    RuntimeFieldDefinition("return_id", "Return", "return_reference"),
    RuntimeFieldDefinition("issue_date", "Issue date", "date"),
    RuntimeFieldDefinition("reason", "Reason", "text", placeholder="Returned goods, price agreed after the fact…"),
    RuntimeFieldDefinition("notes", "Notes", "long_text"),
    RuntimeFieldDefinition("currency", "Currency", "select", readonly=True),
    RuntimeFieldDefinition("status", "Status", "select", readonly=True),
    RuntimeFieldDefinition("subtotal_amount", "Subtotal", "currency", readonly=True),
    RuntimeFieldDefinition("discount_amount", "Discount", "currency", readonly=True),
    RuntimeFieldDefinition("tax_amount", "Tax", "currency", readonly=True),
    RuntimeFieldDefinition("total_amount", "Total", "currency", readonly=True),
    RuntimeFieldDefinition("refund_due", "Refund due", "currency", readonly=True),
    RuntimeFieldDefinition("issued_at", "Issued", "datetime", readonly=True),
    RuntimeFieldDefinition("void_reason", "Void reason", "text", readonly=True),
)

PAYMENT_SYSTEM_FIELDS = _field_map(
    RuntimeFieldDefinition("number", "Payment number", "text", readonly=True),
    # Direction, party and currency follow the invoice or bill the payment is allocated to.
    RuntimeFieldDefinition("direction", "Direction", "select", readonly=True),
    RuntimeFieldDefinition("organization_id", "Account", "organization_reference", readonly=True),
    RuntimeFieldDefinition("contact_id", "Contact", "contact_reference", readonly=True),
    RuntimeFieldDefinition("party_name", "Paid by or to", "text", readonly=True),
    RuntimeFieldDefinition("amount", "Amount", "currency", required=True),
    RuntimeFieldDefinition("currency", "Currency", "select", readonly=True),
    RuntimeFieldDefinition("paid_on", "Date", "date"),
    RuntimeFieldDefinition("method", "Payment method", "picklist", picklist_key="payment_method"),
    RuntimeFieldDefinition("reference", "Reference", "text"),
    RuntimeFieldDefinition("notes", "Notes", "long_text"),
    RuntimeFieldDefinition("kind", "Kind", "select", readonly=True),
    RuntimeFieldDefinition("status", "Status", "select", readonly=True),
    RuntimeFieldDefinition("void_reason", "Void reason", "text", readonly=True),
)

MODULE_SYSTEM_FIELDS.update(
    {
        "purchase_orders": PURCHASE_ORDER_SYSTEM_FIELDS,
        "purchase_receipts": PURCHASE_RECEIPT_SYSTEM_FIELDS,
        "purchase_bills": PURCHASE_BILL_SYSTEM_FIELDS,
        "inventory_deliveries": DELIVERY_SYSTEM_FIELDS,
        "inventory_returns": RETURN_SYSTEM_FIELDS,
        "inventory_adjustments": ADJUSTMENT_SYSTEM_FIELDS,
        "inventory_transfers": TRANSFER_SYSTEM_FIELDS,
        "finance_credit_notes": CREDIT_NOTE_SYSTEM_FIELDS,
        "finance_payments": PAYMENT_SYSTEM_FIELDS,
    }
)

_FULL_WIDTH_TYPES = {"long_text"}


def _table_seed(
    module_key: str,
    surface: str,
    name: str,
    groups: list[tuple[str, str, list[str]]],
) -> RecordLayoutDefinitionPayload:
    """A seed from `(section id, label, field keys)` rows: long text and streets run full
    width, everything else half. A key missing from the catalog is a bug, so it raises."""

    catalog = MODULE_SYSTEM_FIELDS[module_key]
    sections = []
    for position, (section_id, label, keys) in enumerate(groups):
        fields = []
        for key in keys:
            field = catalog[key]
            wide = field.field_type in _FULL_WIDTH_TYPES or key.endswith("_address") or key.endswith("_street2")
            fields.append((key, "full" if wide else "half"))
        sections.append(_seed_section(section_id, label, position, fields))
    return _seed(module_key, surface, name, sections)


def _address_keys(prefix: str, country_key: str | None = None) -> list[str]:
    street = f"{prefix}_address"
    return [street, f"{prefix}_street2", f"{prefix}_city", f"{prefix}_state", f"{prefix}_postal_code", country_key or f"{prefix}_country"]


_FULL_FORM_GROUPS: dict[str, tuple[str, list[tuple[str, str, list[str]]]]] = {
    "sales_leads": ("Lead Form", [
        ("person", "Lead", ["first_name", "last_name", "company", "title"]),
        ("reach", "Contact details", ["primary_email", "phone", "mobile_phone"]),
        ("qualification", "Qualification", ["status", "source", "next_follow_up_at", "notes"]),
        ("ownership", "Ownership", ["assigned_to", "team_id", "tags"]),
    ]),
    "sales_contacts": ("Contact Form", [
        ("person", "Contact", ["salutation", "first_name", "last_name", "current_title", "organization_id"]),
        ("reach", "Contact details", ["primary_email", "contact_telephone", "mobile_phone", "linkedin_url", "email_opt_out"]),
        ("mailing", "Mailing address", [*_address_keys("mailing", "country"), "region"]),
        ("ownership", "Ownership", ["assigned_to"]),
    ]),
    "sales_organizations": ("Account Form", [
        ("account", "Account", ["org_name", "account_type", "industry", "website", "annual_revenue", "employee_count"]),
        ("reach", "Contact details", ["primary_email", "secondary_email", "primary_phone", "secondary_phone"]),
        ("billing", "Billing address", _address_keys("billing")),
        ("shipping", "Shipping address", _address_keys("shipping")),
        ("purchasing", "Billing and purchasing", ["is_vendor", "payment_terms_days"]),
        ("ownership", "Ownership", ["assigned_to"]),
    ]),
    "sales_opportunities": ("Deal Form", [
        ("deal", "Deal", ["opportunity_name", "organization_id", "contact_id", "deal_type", "source"]),
        ("pipeline", "Pipeline", ["sales_stage", "amount", "currency_type", "probability_percent", "expected_close_date", "start_date", "next_step", "lost_reason"]),
        ("ownership", "Ownership", ["assigned_to"]),
    ]),
    "sales_quotes": ("Quote Form", [
        ("quote", "Quote", ["title", "organization_id", "contact_id", "opportunity_id", "customer_name", "issue_date", "expiry_date", "currency", "customer_po_reference"]),
        ("billing", "Billing address", _address_keys("billing")),
        ("shipping", "Shipping", [*_address_keys("shipping"), "shipping_method", "shipping_charge"]),
        ("terms", "Terms", ["terms_and_conditions", "notes", "assigned_to"]),
    ]),
    "sales_orders": ("Order Form", [
        ("customer", "Customer", ["organization_id", "contact_id", "opportunity_id"]),
        ("order", "Order", ["currency", "exchange_rate", "warehouse_id", "priority", "delivery_date", "customer_po_reference", "payment_terms", "owner_id"]),
        ("billing", "Billing address", _address_keys("billing")),
        ("shipping", "Shipping", [*_address_keys("shipping"), "shipping_method", "shipping_charge"]),
        ("terms", "Terms", ["terms_and_conditions", "notes"]),
    ]),
    "finance_pos": ("Invoice Form", [
        ("customer", "Customer", ["customer_name", "customer_organization_id", "customer_contact_id", "customer_email", "customer_address"]),
        ("invoice", "Invoice", ["issue_date", "due_date", "currency", "payment_method"]),
        ("terms", "Terms", ["payment_terms", "notes"]),
    ]),
    "catalog_products": ("Product Form", [
        ("product", "Product", ["name", "sku", "barcode", "category_id", "unit", "description"]),
        ("pricing", "Pricing", ["list_price", "public_unit_price", "cost_price", "currency", "tax_category"]),
        ("shipping", "Size and weight", ["weight", "weight_unit", "length", "width", "height", "dimension_unit"]),
        ("website", "Website", ["slug"]),
    ]),
    "catalog_services": ("Service Form", [
        ("service", "Service", ["name", "sku", "category_id", "unit", "description"]),
        ("pricing", "Pricing", ["list_price", "public_unit_price", "cost_price", "currency", "tax_category"]),
        ("website", "Website", ["slug"]),
    ]),
    "purchase_orders": ("Purchase Order Form", [
        ("order", "Purchase order", ["vendor_id", "warehouse_id", "expected_date", "vendor_reference", "currency", "exchange_rate"]),
        ("notes", "Notes", ["notes"]),
    ]),
    "purchase_receipts": ("Receipt Form", [
        ("receipt", "Receipt", ["order_id", "warehouse_id", "received_on", "vendor_delivery_ref"]),
        ("notes", "Notes", ["notes"]),
    ]),
    "purchase_bills": ("Bill Form", [
        ("bill", "Bill", ["vendor_id", "vendor_invoice_number", "bill_date", "due_date", "order_id", "receipt_id", "currency"]),
        ("notes", "Notes", ["notes"]),
    ]),
    "inventory_deliveries": ("Delivery Form", [
        ("delivery", "Delivery", ["order_id", "warehouse_id", "shipped_on", "carrier", "tracking_number"]),
        ("notes", "Notes", ["notes"]),
    ]),
    "inventory_returns": ("Return Form", [
        ("return", "Return", ["delivery_id", "warehouse_id", "reason"]),
        ("notes", "Notes", ["notes"]),
    ]),
    "inventory_adjustments": ("Adjustment Form", [
        ("adjustment", "Adjustment", ["warehouse_id", "mode", "reason"]),
        ("notes", "Notes", ["notes"]),
    ]),
    "inventory_transfers": ("Transfer Form", [
        ("transfer", "Transfer", ["from_warehouse_id", "to_warehouse_id"]),
        ("notes", "Notes", ["notes"]),
    ]),
    "finance_credit_notes": ("Credit Note Form", [
        ("credit_note", "Credit note", ["invoice_id", "return_id", "issue_date", "reason"]),
        ("notes", "Notes", ["notes"]),
    ]),
    "finance_payments": ("Payment Form", [
        ("payment", "Payment", ["amount", "paid_on", "method", "reference"]),
        ("notes", "Notes", ["notes"]),
    ]),
}

# The ERP documents' read-only headers. Numbers and statuses sit in the record header the
# page draws, so these list what the header does not.
_ERP_DETAIL_GROUPS: dict[str, tuple[str, list[tuple[str, str, list[str]]]]] = {
    "purchase_orders": ("Purchase Order Details", [
        ("order", "Purchase order", ["vendor_id", "warehouse_id", "expected_date", "vendor_reference", "receipt_status", "bill_status", "ordered_at", "owner_id"]),
        ("money", "Amounts", ["currency", "exchange_rate", "subtotal"]),
        ("notes", "Notes", ["notes"]),
    ]),
    "purchase_receipts": ("Receipt Details", [
        ("receipt", "Receipt", ["order_id", "warehouse_id", "received_on", "vendor_delivery_ref", "posted_at"]),
        ("notes", "Notes", ["notes"]),
    ]),
    "purchase_bills": ("Bill Details", [
        ("bill", "Bill", ["vendor_id", "vendor_invoice_number", "bill_date", "due_date", "order_id", "receipt_id", "match_status", "owner_id"]),
        ("money", "Amounts", ["currency", "subtotal", "tax_total", "total", "amount_paid", "balance_due", "payment_status"]),
        ("notes", "Notes", ["notes"]),
    ]),
    "inventory_deliveries": ("Delivery Details", [
        ("delivery", "Delivery", ["order_id", "warehouse_id", "shipped_on", "carrier", "tracking_number", "posted_at"]),
        ("notes", "Notes", ["notes"]),
    ]),
    "inventory_returns": ("Return Details", [
        ("return", "Return", ["delivery_id", "order_id", "warehouse_id", "reason", "received_at"]),
        ("notes", "Notes", ["notes"]),
    ]),
    "inventory_adjustments": ("Adjustment Details", [
        ("adjustment", "Adjustment", ["warehouse_id", "mode", "reason", "posted_at"]),
        ("notes", "Notes", ["notes"]),
    ]),
    "inventory_transfers": ("Transfer Details", [
        ("transfer", "Transfer", ["from_warehouse_id", "to_warehouse_id", "posted_at"]),
        ("notes", "Notes", ["notes"]),
    ]),
    "finance_credit_notes": ("Credit Note Details", [
        ("credit_note", "Credit note", ["invoice_id", "return_id", "issue_date", "reason", "issued_at"]),
        ("money", "Amounts", ["currency", "subtotal_amount", "discount_amount", "tax_amount", "total_amount", "refund_due"]),
        ("notes", "Notes", ["notes"]),
    ]),
    "finance_payments": ("Payment Details", [
        ("payment", "Payment", ["direction", "organization_id", "contact_id", "party_name", "amount", "currency", "paid_on", "method", "reference"]),
        ("notes", "Notes", ["notes"]),
    ]),
}

for _module_key, (_name, _groups) in _FULL_FORM_GROUPS.items():
    MODULE_LAYOUT_SEEDS.setdefault(_module_key, {})["full_form"] = _table_seed(_module_key, "full_form", _name, _groups)
for _module_key, (_name, _groups) in _ERP_DETAIL_GROUPS.items():
    MODULE_LAYOUT_SEEDS.setdefault(_module_key, {})["detail"] = _table_seed(_module_key, "detail", _name, _groups)

# Products and services get a quick create (13b Phase 5, F3.7): opened from the catalog list
# and from a line editor's *Create "…"*. What a line needs to sell the item: its name, how it
# is counted, its price and tax; the rest waits for the full form.
for _module_key, _name in (("catalog_products", "Product Quick Create"), ("catalog_services", "Service Quick Create")):
    MODULE_LAYOUT_SEEDS[_module_key]["quick_create"] = _seed(
        _module_key,
        "quick_create",
        _name,
        [
            _seed_section(
                "item",
                "Item",
                0,
                [("name", "full"), ("sku", "half"), ("category_id", "half"), ("unit", "half"), ("list_price", "half"), ("tax_category", "half")],
            ),
        ],
    )

# Every module now has a surface for each seed it carries.
SUPPORTED_LAYOUT_SURFACES_BY_MODULE.update(
    {module_key: set(seeds) for module_key, seeds in MODULE_LAYOUT_SEEDS.items()}
)
SUPPORTED_LAYOUT_MODULES.update(SUPPORTED_LAYOUT_SURFACES_BY_MODULE)


def validate_module_and_surface(module_key: str, surface: str) -> tuple[str, RecordLayoutSurface]:
    normalized_module = module_key.strip()
    normalized_surface = surface.strip()
    if normalized_module not in SUPPORTED_LAYOUT_MODULES:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record layouts are not available for this module")
    if normalized_surface not in SUPPORTED_LAYOUT_SURFACES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Unsupported record layout surface")
    if normalized_surface not in SUPPORTED_LAYOUT_SURFACES_BY_MODULE[normalized_module]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="This module does not have a layout for that surface yet",
        )
    return normalized_module, normalized_surface  # type: ignore[return-value]


def _field_catalog(db: Session, *, tenant_id: int, module_key: str) -> dict[str, RuntimeFieldDefinition]:
    system_fields = MODULE_SYSTEM_FIELDS.get(module_key)
    if system_fields is None:
        return {}
    catalog = dict(system_fields)
    # An administrator's field rules (13b Phase 4) make a field stricter, never looser.
    for field_key, rule in module_field_rules(db, tenant_id=tenant_id, module_key=module_key).items():
        field = catalog.get(field_key)
        if field is not None:
            catalog[field_key] = replace(
                field,
                required=field.required or (rule.required and not field.readonly),
                readonly=field.readonly or (rule.readonly and not field.required),
            )
    for definition in list_custom_field_definitions(
        db,
        tenant_id=tenant_id,
        module_key=module_key,
        include_inactive=False,
    ):
        field_key = f"custom:{definition.field_key}"
        catalog[field_key] = RuntimeFieldDefinition(
            field_key=field_key,
            label=definition.label,
            field_type=definition.field_type,
            required=bool(definition.is_required),
            field_source="custom_field",
            placeholder=definition.placeholder,
            help_text=definition.help_text,
            picklist_key=definition.picklist_key,
        )
    return catalog


# Fields of which a create needs at least one (13a A9, H13).
QUICK_CREATE_ONE_OF: dict[str, tuple[str, ...]] = {
    "sales_leads": ("primary_email", "phone", "mobile_phone"),
    "sales_contacts": ("primary_email", "contact_telephone", "mobile_phone"),
    "sales_opportunities": ("organization_id", "contact_id"),
    "sales_orders": ("organization_id", "contact_id"),
}


def collect_layout_errors(
    db: Session,
    *,
    tenant_id: int,
    definition: RecordLayoutDefinitionPayload,
) -> list[str]:
    """Blocking problems: a layout with any of these must never be stored or rendered."""

    module_key, surface = validate_module_and_surface(definition.module_key, definition.surface)
    catalog = _field_catalog(db, tenant_id=tenant_id, module_key=module_key)
    configured_fields = {field.field_key: field for section in definition.sections for field in section.fields}
    errors: list[str] = []

    unknown = sorted(set(configured_fields) - set(catalog))
    if unknown:
        errors.append(f"Unknown layout field keys: {', '.join(unknown)}")

    if surface in CREATE_SURFACES:
        missing_required = sorted(
            key
            for key, field in catalog.items()
            if field.required
            and (
                key not in configured_fields
                or not configured_fields[key].visible
                or configured_fields[key].readonly is True
            )
        )
        if missing_required:
            errors.append(
                f"Required fields must remain visible and writable on a create form: {', '.join(missing_required)}"
            )

    for key, configured in sorted(configured_fields.items()):
        field = catalog.get(key)
        if field is None:
            continue
        if field.required and configured.required_override is False:
            errors.append(f"Required field cannot be made optional: {key}")
        if surface in CREATE_SURFACES and configured.required_override is True and (
            not configured.visible or configured.readonly is True
        ):
            errors.append(f"A required field must remain visible and writable on a create form: {key}")
        if field.readonly and configured.readonly is False:
            errors.append(f"Read-only field cannot be made writable: {key}")

    if surface in CREATE_SURFACES:
        writable = [
            key
            for key, configured in configured_fields.items()
            if configured.visible
            and configured.readonly is not True
            and not (catalog[key].readonly if key in catalog else False)
        ]
        if not writable:
            errors.append("A create form needs at least one visible, writable field.")
        # A rule the domain states as "one of" (13a A9, H13): no single field is required,
        # but hiding all of them leaves a Quick Create that can never save.
        alternatives = QUICK_CREATE_ONE_OF.get(module_key)
        if alternatives and not any(key in writable for key in alternatives):
            labels = [catalog[key].label for key in alternatives if key in catalog]
            errors.append(f"A create form needs at least one of {', '.join(labels[:-1])} or {labels[-1]}.")

    return list(dict.fromkeys(errors))


def collect_layout_warnings(
    db: Session,
    *,
    tenant_id: int,
    definition: RecordLayoutDefinitionPayload,
) -> list[str]:
    """Advisory guidance. A warning never blocks a publish — it explains a cost."""

    module_key, surface = validate_module_and_surface(definition.module_key, definition.surface)
    catalog = _field_catalog(db, tenant_id=tenant_id, module_key=module_key)
    enabled_states = module_field_enabled_map(db, tenant_id=tenant_id, module_key=module_key)
    warnings: list[str] = []

    def label_for(field_key: str) -> str:
        field = catalog.get(field_key)
        return field.label if field else field_key

    for section in sorted(definition.sections, key=lambda item: item.position):
        if not section.fields:
            warnings.append(f"Section “{section.label}” has no fields and will not render.")

    configured = [(section, field) for section in definition.sections for field in section.fields]
    for _section, field in sorted(configured, key=lambda item: item[1].field_key):
        definition_field = catalog.get(field.field_key)
        if definition_field is None:
            continue
        if not field.visible:
            warnings.append(f"“{definition_field.label}” is hidden, so it stays in the layout but is not rendered.")
        elif enabled_states.get(field.field_key, True) is False and not definition_field.required:
            warnings.append(
                f"“{definition_field.label}” is turned off in Field Config and will not render until it is enabled."
            )

    if surface != "quick_create":
        return list(dict.fromkeys(warnings))

    visible_fields = [field for _section, field in configured if field.visible]
    if len(visible_fields) > QUICK_CREATE_RECOMMENDED_MAX_FIELDS:
        warnings.append(
            f"Quick Create shows {len(visible_fields)} fields. "
            f"{QUICK_CREATE_RECOMMENDED_MIN_FIELDS}–{QUICK_CREATE_RECOMMENDED_MAX_FIELDS} keeps it quick; "
            "the full form stays available under More details."
        )

    slow_fields = sorted(
        {
            label_for(field.field_key)
            for field in visible_fields
            if (catalog.get(field.field_key).field_type if field.field_key in catalog else None)
            in QUICK_CREATE_SLOW_FIELD_TYPES
        }
    )
    if slow_fields:
        warnings.append(
            f"Long-form fields ({', '.join(f'“{label}”' for label in slow_fields)}) slow Quick Create down. "
            "Consider leaving them to the full form."
        )

    populated_sections = [section for section in definition.sections if section.fields]
    if len(populated_sections) > QUICK_CREATE_RECOMMENDED_MAX_SECTIONS:
        warnings.append(
            f"Quick Create has {len(populated_sections)} sections. One or two read better in a narrow panel."
        )

    if any(section.region == "sidebar" and section.fields for section in definition.sections):
        warnings.append("Quick Create is a narrow surface, so sidebar sections stack below the main fields.")

    if any(section.collapsed_by_default and section.fields for section in definition.sections):
        warnings.append("Collapsed sections hide fields behind an extra click during Quick Create.")

    readonly_visible = sorted(
        {
            label_for(field.field_key)
            for field in visible_fields
            if field.readonly is True or (catalog.get(field.field_key).readonly if field.field_key in catalog else False)
        }
    )
    if readonly_visible:
        warnings.append(
            f"Read-only fields ({', '.join(f'“{label}”' for label in readonly_visible)}) cannot be filled in "
            "during Quick Create."
        )

    return list(dict.fromkeys(warnings))


def validate_layout_definition(
    db: Session,
    *,
    tenant_id: int,
    definition: RecordLayoutDefinitionPayload,
) -> RecordLayoutDefinitionPayload:
    errors = collect_layout_errors(db, tenant_id=tenant_id, definition=definition)
    if errors:
        raise ValueError("; ".join(errors))
    return definition


@dataclass(frozen=True)
class LayoutScope:
    """Whom a stored layout is for: the tenant default (both None), one role, or one team."""

    role_id: int | None = None
    team_id: int | None = None

    @property
    def is_override(self) -> bool:
        return self.role_id is not None or self.team_id is not None

    @property
    def audit_suffix(self) -> str:
        if self.team_id is not None:
            return f":team:{self.team_id}"
        if self.role_id is not None:
            return f":role:{self.role_id}"
        return ""


BASE_SCOPE = LayoutScope()


def validate_layout_scope(db: Session, *, tenant_id: int, role_id: int | None, team_id: int | None) -> LayoutScope:
    """A scope the tenant owns. An override is for one role or one team, never both."""

    if role_id is not None and team_id is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A layout override is for one role or one team, not both",
        )
    if role_id is not None and (
        db.query(Role.id).filter(Role.id == role_id, Role.tenant_id == tenant_id).first() is None
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
    if team_id is not None and (
        db.query(Team.id).filter(Team.id == team_id, Team.tenant_id == tenant_id).first() is None
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    return LayoutScope(role_id=role_id, team_id=team_id)


def _load_layout(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    surface: str,
    scope: LayoutScope = BASE_SCOPE,
) -> RecordLayoutDefinition | None:
    query = db.query(RecordLayoutDefinition).filter(
        RecordLayoutDefinition.tenant_id == tenant_id,
        RecordLayoutDefinition.module_key == module_key,
        RecordLayoutDefinition.surface == surface,
    )
    if scope.team_id is not None:
        query = query.filter(RecordLayoutDefinition.team_id == scope.team_id)
    elif scope.role_id is not None:
        query = query.filter(RecordLayoutDefinition.role_id == scope.role_id)
    else:
        query = query.filter(
            RecordLayoutDefinition.is_default.is_(True),
            RecordLayoutDefinition.role_id.is_(None),
            RecordLayoutDefinition.team_id.is_(None),
        )
    return query.order_by(RecordLayoutDefinition.id.asc()).first()


def _load_default_layout(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    surface: str,
) -> RecordLayoutDefinition | None:
    return _load_layout(db, tenant_id=tenant_id, module_key=module_key, surface=surface)


def _resolution_chain(role_id: int | None, team_id: int | None) -> list[LayoutScope]:
    """Team before role before the tenant default (13b §5 decision 10)."""

    chain: list[LayoutScope] = []
    if team_id is not None:
        chain.append(LayoutScope(team_id=team_id))
    if role_id is not None:
        chain.append(LayoutScope(role_id=role_id))
    chain.append(BASE_SCOPE)
    return chain


def _parse_stored_layout(record: RecordLayoutDefinition) -> RecordLayoutDefinitionPayload:
    return RecordLayoutDefinitionPayload(
        module_key=record.module_key,
        surface=record.surface,
        name=record.name,
        version=record.version,
        sections=record.sections,
    )


def _append_required_quick_create_fields(
    definition: RecordLayoutDefinitionPayload,
    catalog: dict[str, RuntimeFieldDefinition],
) -> RecordLayoutDefinitionPayload:
    included = {field.field_key for section in definition.sections for field in section.fields}
    required_custom = [
        field
        for field in catalog.values()
        if field.required and not field.readonly and field.field_key not in included
    ]
    if not required_custom:
        return definition
    sections = list(definition.sections)
    sections.append(
        RecordLayoutSectionDefinition(
            id="required_custom_fields",
            label="Required fields",
            position=max(section.position for section in sections) + 1,
            region="main",
            fields=[
                RecordLayoutFieldDefinition(field_key=field.field_key, position=index, width="full")
                for index, field in enumerate(required_custom)
            ],
        )
    )
    return definition.model_copy(update={"sections": sections})


def _append_detail_custom_fields(
    definition: RecordLayoutDefinitionPayload,
    catalog: dict[str, RuntimeFieldDefinition],
    *,
    surface: str,
) -> RecordLayoutDefinitionPayload:
    # A field the layout already places (a required one appended above) is not drawn twice.
    included = {field.field_key for section in definition.sections for field in section.fields}
    custom_fields = [
        field for field in catalog.values() if field.field_source == "custom_field" and field.field_key not in included
    ]
    if not custom_fields:
        return definition
    sections = list(definition.sections)
    sections.append(
        RecordLayoutSectionDefinition(
            id="custom_fields",
            label="Custom fields",
            position=max(section.position for section in sections) + 1,
            region="main",
            # Folded away on a record's details; open on a form, where they are filled in.
            collapsed_by_default=surface == "detail",
            fields=[
                RecordLayoutFieldDefinition(field_key=field.field_key, position=index, width="half")
                for index, field in enumerate(custom_fields)
            ],
        )
    )
    return definition.model_copy(update={"sections": sections})


def _resolve_sections(
    definition: RecordLayoutDefinitionPayload,
    *,
    catalog: dict[str, RuntimeFieldDefinition],
    enabled_states: dict[str, bool],
) -> tuple[list[ResolvedRecordLayoutSection], list[str]]:
    warnings: list[str] = []
    resolved_sections: list[ResolvedRecordLayoutSection] = []
    for section in sorted(definition.sections, key=lambda item: item.position):
        resolved_fields: list[ResolvedRecordLayoutField] = []
        for configured in sorted(section.fields, key=lambda item: item.position):
            field = catalog.get(configured.field_key)
            if field is None:
                warnings.append(f"Omitted stale field reference: {configured.field_key}")
                continue
            enabled_key = configured.field_key
            if enabled_states.get(enabled_key, True) is False and not (
                definition.surface in CREATE_SURFACES and field.required
            ):
                continue
            resolved_fields.append(
                ResolvedRecordLayoutField(
                    field_key=configured.field_key,
                    label=field.label,
                    field_type=field.field_type,
                    field_source=field.field_source,  # type: ignore[arg-type]
                    position=configured.position,
                    width=configured.width,
                    visible=configured.visible,
                    required=field.required or configured.required_override is True,
                    readonly=definition.surface == "detail" or field.readonly or configured.readonly is True,
                    placeholder=field.placeholder,
                    help_text=field.help_text,
                    picklist_key=field.picklist_key,
                )
            )
        if resolved_fields:
            resolved_sections.append(
                ResolvedRecordLayoutSection(
                    id=section.id,
                    label=section.label,
                    position=section.position,
                    region=section.region,
                    collapsed_by_default=section.collapsed_by_default,
                    fields=resolved_fields,
                )
            )
    return resolved_sections, warnings


def resolve_record_layout(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    surface: str,
    role_id: int | None = None,
    team_id: int | None = None,
) -> ResolvedRecordLayoutResponse:
    """The layout a user sees: their team's override, else their role's, else the tenant
    default, else the product default. An unreadable stored layout is skipped, not fatal."""

    module_key, normalized_surface = validate_module_and_surface(module_key, surface)
    fallback = MODULE_LAYOUT_SEEDS.get(module_key, {}).get(normalized_surface)
    if fallback is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No system layout is available for this surface")

    catalog = _field_catalog(db, tenant_id=tenant_id, module_key=module_key)
    definition = fallback
    source = "system"
    layout_id = None
    warnings: list[str] = []
    for scope in _resolution_chain(role_id, team_id):
        record = _load_layout(db, tenant_id=tenant_id, module_key=module_key, surface=normalized_surface, scope=scope)
        if record is None:
            continue
        try:
            definition = _parse_stored_layout(record)
            source = "tenant"
            layout_id = record.id
            break
        except ValidationError:
            warnings.append("Stored layout is invalid; using the next layout that applies")
            logger.warning(
                "Invalid stored record layout; falling back",
                extra={"tenant_id": tenant_id, "module_key": module_key, "surface": normalized_surface, "layout_id": record.id},
            )

    # Also for a tenant layout: a field made required after the layout was published still
    # has to be fillable, or every quick create would be refused (13b Phase 4).
    if normalized_surface in CREATE_SURFACES:
        definition = _append_required_quick_create_fields(definition, catalog)
    if source == "system" and normalized_surface in {"detail", "full_form"}:
        definition = _append_detail_custom_fields(definition, catalog, surface=normalized_surface)

    sections, resolution_warnings = _resolve_sections(
        definition,
        catalog=catalog,
        enabled_states=module_field_enabled_map(db, tenant_id=tenant_id, module_key=module_key),
    )
    warnings.extend(resolution_warnings)
    if resolution_warnings:
        logger.warning(
            "Stale record layout fields were omitted",
            extra={"tenant_id": tenant_id, "module_key": module_key, "surface": normalized_surface},
        )

    if normalized_surface in CREATE_SURFACES:
        writable_visible_keys = {
            field.field_key
            for section in sections
            for field in section.fields
            if field.visible and not field.readonly
        }
        missing_required = sorted(
            key for key, field in catalog.items() if field.required and key not in writable_visible_keys
        )
        unusable_required_overrides = sorted(
            field.field_key
            for section in sections
            for field in section.fields
            if field.required and (not field.visible or field.readonly)
        )
        missing_required.extend(
            key for key in unusable_required_overrides if key not in missing_required
        )
        # "One of" (13a A9, H13): a stored layout with none of them usable can never save.
        alternatives = [key for key in QUICK_CREATE_ONE_OF.get(module_key, ()) if key in catalog]
        if alternatives and not any(key in writable_visible_keys for key in alternatives):
            missing_required.append(" or ".join(alternatives))
        if missing_required:
            warnings.append("Stored layout omitted required fields; using the system fallback")
            logger.warning(
                "Stored record layout omitted required fields; using system fallback",
                extra={"tenant_id": tenant_id, "module_key": module_key, "surface": normalized_surface},
            )
            definition = _append_required_quick_create_fields(fallback, catalog)
            sections, fallback_warnings = _resolve_sections(
                definition,
                catalog=catalog,
                enabled_states=module_field_enabled_map(db, tenant_id=tenant_id, module_key=module_key),
            )
            warnings.extend(fallback_warnings)
            source = "system"
            layout_id = None

    return ResolvedRecordLayoutResponse(
        layout_id=layout_id,
        module_key=module_key,
        surface=normalized_surface,
        name=definition.name,
        source=source,  # type: ignore[arg-type]
        version=definition.version,
        can_customize=False,
        sections=sections,
        warnings=list(dict.fromkeys(warnings)),
    )


# --- Administration (workstream 09, backend Phase 2) -------------------------------------
#
# Model: one published tenant default per (tenant, module, surface). A publish replaces it
# immediately and bumps `version`; there is no draft row, so there is no ambiguous
# half-published state to resolve at runtime. Preview validates a candidate without writing
# anything, and reset deletes the tenant row so the system default takes over again.


def validate_admin_module_and_surface(module_key: str, surface: str) -> tuple[str, RecordLayoutSurface]:
    """Every supported module is editable on every surface it has (13b Phase 4 slice 4d)."""

    return validate_module_and_surface(module_key.strip(), surface.strip())


def _catalog_entries(
    catalog: dict[str, RuntimeFieldDefinition],
    *,
    enabled_states: dict[str, bool],
    surface: str,
) -> list[RecordLayoutCatalogField]:
    entries: list[RecordLayoutCatalogField] = []
    for field in sorted(catalog.values(), key=lambda item: (item.field_source != "system", item.label.lower())):
        locked_reason: str | None = None
        if field.required and surface in CREATE_SURFACES:
            locked_reason = "Required by the domain, so it must stay visible and editable here."
        elif field.readonly:
            locked_reason = "Managed by the system and always read-only."
        entries.append(
            RecordLayoutCatalogField(
                field_key=field.field_key,
                label=field.label,
                field_type=field.field_type,
                field_source=field.field_source,  # type: ignore[arg-type]
                required=field.required,
                readonly=field.readonly,
                enabled=enabled_states.get(field.field_key, True),
                locked=field.required and surface in CREATE_SURFACES,
                locked_reason=locked_reason,
                picklist_key=field.picklist_key,
            )
        )
    return entries


def _normalized_definition(definition: RecordLayoutDefinitionPayload) -> RecordLayoutDefinitionPayload:
    """Renumber positions to a dense 0..n-1 sequence so stored JSON is canonical."""

    sections = []
    for section_index, section in enumerate(sorted(definition.sections, key=lambda item: item.position)):
        fields = [
            field.model_copy(update={"position": field_index})
            for field_index, field in enumerate(sorted(section.fields, key=lambda item: item.position))
        ]
        sections.append(section.model_copy(update={"position": section_index, "fields": fields}))
    return definition.model_copy(update={"sections": sections})


def _validation_report(
    db: Session,
    *,
    tenant_id: int,
    definition: RecordLayoutDefinitionPayload,
) -> RecordLayoutValidationReport:
    errors = collect_layout_errors(db, tenant_id=tenant_id, definition=definition)
    warnings = collect_layout_warnings(db, tenant_id=tenant_id, definition=definition)
    return RecordLayoutValidationReport(valid=not errors, errors=errors, warnings=warnings)


def _system_definition(
    module_key: str,
    surface: str,
    catalog: dict[str, RuntimeFieldDefinition],
) -> RecordLayoutDefinitionPayload:
    """The product default exactly as the runtime resolver would fall back to it."""

    seed = MODULE_LAYOUT_SEEDS.get(module_key, {}).get(surface)
    if seed is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No system layout is available for this surface",
        )
    definition = seed.model_copy(deep=True)
    if surface in CREATE_SURFACES:
        definition = _append_required_quick_create_fields(definition, catalog)
    if surface in {"detail", "full_form"}:
        definition = _append_detail_custom_fields(definition, catalog, surface=surface)
    return _normalized_definition(definition)


def _admin_state(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    surface: RecordLayoutSurface,
    scope: LayoutScope = BASE_SCOPE,
) -> RecordLayoutAdminStateResponse:
    catalog = _field_catalog(db, tenant_id=tenant_id, module_key=module_key)
    enabled_states = module_field_enabled_map(db, tenant_id=tenant_id, module_key=module_key)
    system_definition = _system_definition(module_key, surface, catalog)

    record = _load_layout(db, tenant_id=tenant_id, module_key=module_key, surface=surface, scope=scope)
    definition = system_definition
    inherits_from: str | None = None
    if record is None and scope.is_override:
        # A new override starts from what this audience sees today: the tenant default, else
        # the product default. It is a complete copy from then on, not a diff (09 Phase 3).
        inherits_from = "system"
        base = _load_default_layout(db, tenant_id=tenant_id, module_key=module_key, surface=surface)
        if base is not None:
            try:
                definition = _normalized_definition(_parse_stored_layout(base))
                inherits_from = "tenant"
            except ValidationError:
                pass
    source = "system"
    layout_id: int | None = None
    expected_version: int | None = None
    updated_at = None
    unreadable_warning: str | None = None

    if record is not None:
        layout_id = record.id
        expected_version = record.version
        updated_at = record.updated_at
        try:
            definition = _normalized_definition(_parse_stored_layout(record))
            source = "tenant"
        except ValidationError:
            # The builder still needs something editable. Show the system default and say so;
            # publishing from here replaces the unreadable row rather than merging into it.
            unreadable_warning = (
                "The stored layout could not be read, so the system default is shown. "
                "Publishing replaces the stored layout."
            )
            logger.warning(
                "Invalid stored record layout in admin state; showing system default",
                extra={"tenant_id": tenant_id, "module_key": module_key, "surface": surface},
            )

    validation = _validation_report(db, tenant_id=tenant_id, definition=definition)
    if unreadable_warning:
        validation = validation.model_copy(update={"warnings": [unreadable_warning, *validation.warnings]})

    return RecordLayoutAdminStateResponse(
        module_key=module_key,
        surface=surface,
        layout_id=layout_id,
        source=source,  # type: ignore[arg-type]
        version=definition.version if source == "tenant" else system_definition.version,
        expected_version=expected_version,
        updated_at=updated_at,
        definition=definition,
        system_definition=system_definition,
        available_fields=_catalog_entries(catalog, enabled_states=enabled_states, surface=surface),
        validation=validation,
        role_id=scope.role_id,
        team_id=scope.team_id,
        inherits_from=inherits_from,  # type: ignore[arg-type]
    )


def get_admin_record_layout(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    surface: str,
    scope: LayoutScope = BASE_SCOPE,
) -> RecordLayoutAdminStateResponse:
    module_key, normalized_surface = validate_admin_module_and_surface(module_key, surface)
    return _admin_state(db, tenant_id=tenant_id, module_key=module_key, surface=normalized_surface, scope=scope)


def _assert_definition_matches_path(
    definition: RecordLayoutDefinitionPayload,
    *,
    module_key: str,
    surface: str,
) -> None:
    if definition.module_key.strip() != module_key or definition.surface.strip() != surface:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="The layout definition does not match the module and surface being configured",
        )


def preview_record_layout(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    surface: str,
    definition: RecordLayoutDefinitionPayload,
    scope: LayoutScope = BASE_SCOPE,
) -> RecordLayoutPreviewResponse:
    """Validate and resolve a candidate. Never writes — this is the 'before you publish' view."""

    module_key, normalized_surface = validate_admin_module_and_surface(module_key, surface)
    _assert_definition_matches_path(definition, module_key=module_key, surface=normalized_surface)

    candidate = _normalized_definition(definition)
    validation = _validation_report(db, tenant_id=tenant_id, definition=candidate)
    if not validation.valid:
        return RecordLayoutPreviewResponse(validation=validation, resolved=None)

    catalog = _field_catalog(db, tenant_id=tenant_id, module_key=module_key)
    record = _load_layout(db, tenant_id=tenant_id, module_key=module_key, surface=normalized_surface, scope=scope)
    sections, resolution_warnings = _resolve_sections(
        candidate,
        catalog=catalog,
        enabled_states=module_field_enabled_map(db, tenant_id=tenant_id, module_key=module_key),
    )
    resolved = ResolvedRecordLayoutResponse(
        layout_id=record.id if record is not None else None,
        module_key=module_key,
        surface=normalized_surface,
        name=candidate.name,
        source="tenant",
        # What the version would become once this candidate is published.
        version=(record.version + 1) if record is not None else 1,
        can_customize=False,
        sections=sections,
        warnings=list(dict.fromkeys(resolution_warnings)),
    )
    return RecordLayoutPreviewResponse(validation=validation, resolved=resolved)


def publish_record_layout(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int | None,
    module_key: str,
    surface: str,
    definition: RecordLayoutDefinitionPayload,
    expected_version: int | None,
    scope: LayoutScope = BASE_SCOPE,
) -> RecordLayoutAdminStateResponse:
    module_key, normalized_surface = validate_admin_module_and_surface(module_key, surface)
    _assert_definition_matches_path(definition, module_key=module_key, surface=normalized_surface)

    candidate = _normalized_definition(definition)
    validation = _validation_report(db, tenant_id=tenant_id, definition=candidate)
    if not validation.valid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "message": "This layout cannot be published.",
                "errors": validation.errors,
                "warnings": validation.warnings,
            },
        )

    record = _load_layout(db, tenant_id=tenant_id, module_key=module_key, surface=normalized_surface, scope=scope)
    current_version = record.version if record is not None else None
    if expected_version != current_version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "This layout changed since you opened it. Reload to see the current version.",
                "current_version": current_version,
            },
        )

    sections_json = [section.model_dump(mode="json") for section in candidate.sections]
    before_state = (
        {"name": record.name, "version": record.version, "sections": record.sections} if record is not None else None
    )
    if record is None:
        record = RecordLayoutDefinition(
            tenant_id=tenant_id,
            module_key=module_key,
            surface=normalized_surface,
            name=candidate.name,
            is_default=not scope.is_override,
            role_id=scope.role_id,
            team_id=scope.team_id,
            version=1,
            sections=sections_json,
        )
        db.add(record)
    else:
        record.name = candidate.name
        record.sections = sections_json
        record.version = record.version + 1
    db.commit()
    db.refresh(record)

    safe_log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key=module_key,
        entity_type=LAYOUT_ENTITY_TYPE,
        entity_id=f"{module_key}:{normalized_surface}{scope.audit_suffix}",
        action="publish",
        description=f"Published the {normalized_surface} layout{_scope_phrase(db, scope)} (version {record.version})",
        before_state=before_state,
        after_state={"name": record.name, "version": record.version, "sections": record.sections},
    )
    return _admin_state(db, tenant_id=tenant_id, module_key=module_key, surface=normalized_surface, scope=scope)


def reset_record_layout(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int | None,
    module_key: str,
    surface: str,
    scope: LayoutScope = BASE_SCOPE,
) -> RecordLayoutAdminStateResponse:
    """Drop the tenant default so the system layout takes over again — or, for a scope,
    remove that role's or team's override so it falls back cleanly. Idempotent."""

    module_key, normalized_surface = validate_admin_module_and_surface(module_key, surface)
    record = _load_layout(db, tenant_id=tenant_id, module_key=module_key, surface=normalized_surface, scope=scope)
    if record is not None:
        before_state = {"name": record.name, "version": record.version, "sections": record.sections}
        db.delete(record)
        db.commit()
        safe_log_activity(
            db,
            tenant_id=tenant_id,
            actor_user_id=actor_user_id,
            module_key=module_key,
            entity_type=LAYOUT_ENTITY_TYPE,
            entity_id=f"{module_key}:{normalized_surface}{scope.audit_suffix}",
            action="reset",
            description=(
                f"Removed the {normalized_surface} layout override{_scope_phrase(db, scope)}"
                if scope.is_override
                else f"Reset the {normalized_surface} layout to the system default"
            ),
            before_state=before_state,
            after_state=None,
        )
    return _admin_state(db, tenant_id=tenant_id, module_key=module_key, surface=normalized_surface, scope=scope)


def _scope_phrase(db: Session, scope: LayoutScope) -> str:
    if scope.team_id is not None:
        team = db.query(Team.name).filter(Team.id == scope.team_id).first()
        return f" for team {team[0] if team else scope.team_id}"
    if scope.role_id is not None:
        role = db.query(Role.name).filter(Role.id == scope.role_id).first()
        return f" for role {role[0] if role else scope.role_id}"
    return ""


def list_layout_overrides(db: Session, *, tenant_id: int, module_key: str, surface: str) -> list[dict]:
    """The role and team overrides of one surface, for the builder's audience picker."""

    module_key, normalized_surface = validate_admin_module_and_surface(module_key, surface)
    rows = (
        db.query(RecordLayoutDefinition, Role.name, Team.name)
        .outerjoin(Role, Role.id == RecordLayoutDefinition.role_id)
        .outerjoin(Team, Team.id == RecordLayoutDefinition.team_id)
        .filter(
            RecordLayoutDefinition.tenant_id == tenant_id,
            RecordLayoutDefinition.module_key == module_key,
            RecordLayoutDefinition.surface == normalized_surface,
            (RecordLayoutDefinition.role_id.isnot(None)) | (RecordLayoutDefinition.team_id.isnot(None)),
        )
        .order_by(RecordLayoutDefinition.team_id.is_(None), Team.name, Role.name)
        .all()
    )
    return [
        {
            "layout_id": record.id,
            "role_id": record.role_id,
            "role_name": role_name,
            "team_id": record.team_id,
            "team_name": team_name,
            "version": record.version,
            "updated_at": record.updated_at,
        }
        for record, role_name, team_name in rows
    ]
