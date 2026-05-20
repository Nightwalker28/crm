from __future__ import annotations

from typing import Any


SystemField = dict[str, Any]
SystemModule = dict[str, Any]


def field(
    field_key: str,
    label: str,
    field_type: str = "text",
    *,
    enabled: bool = True,
    protected: bool = False,
    sort_order: int = 0,
) -> SystemField:
    return {
        "field_key": field_key,
        "label": label,
        "field_type": field_type,
        "field_source": "system",
        "is_enabled": enabled,
        "is_protected": protected,
        "sort_order": sort_order,
    }


def module(
    display_name: str,
    *,
    base_route: str | None,
    description: str,
    sidebar_tab_key: str = "other",
    sort_order: int = 100,
    fields: list[SystemField] | None = None,
) -> SystemModule:
    return {
        "display_name": display_name,
        "base_route": base_route,
        "description": description,
        "sidebar_tab_key": sidebar_tab_key,
        "sort_order": sort_order,
        "fields": fields or [],
    }


CONTACT_FIELDS = [
    field("contact_id", "Contact ID", "number", protected=True, sort_order=10),
    field("first_name", "First Name", sort_order=20),
    field("last_name", "Last Name", sort_order=30),
    field("primary_email", "Primary Email", "email", sort_order=40),
    field("contact_telephone", "Primary Phone", sort_order=50),
    field("current_title", "Job Title", sort_order=60),
    field("organization_id", "Account", "number", sort_order=70),
    field("assigned_to", "Owner", "number", sort_order=80),
    field("region", "Region", sort_order=90),
    field("country", "Country", sort_order=100),
    field("email_opt_out", "Email Opt Out", "boolean", sort_order=110),
    field("last_contacted_at", "Last Contacted At", "datetime", sort_order=120),
    field("last_contacted_channel", "Last Contacted Channel", sort_order=130),
    field("created_time", "Created At", "datetime", sort_order=140),
    field("whatsapp_last_contacted_at", "WhatsApp Last Contacted At", "datetime", enabled=False, sort_order=900),
]

ACCOUNT_FIELDS = [
    field("org_id", "Account ID", "number", protected=True, sort_order=10),
    field("org_name", "Account Name", sort_order=20),
    field("primary_email", "Primary Email", "email", sort_order=30),
    field("website", "Website", "url", sort_order=40),
    field("primary_phone", "Primary Phone", sort_order=50),
    field("secondary_phone", "Secondary Phone", sort_order=60),
    field("industry", "Industry", sort_order=70),
    field("annual_revenue", "Annual Revenue", sort_order=80),
    field("assigned_to", "Owner", "number", sort_order=90),
    field("customer_group_id", "Customer Group", "number", sort_order=100),
    field("billing_address", "Billing Address", "textarea", sort_order=110),
    field("billing_city", "Billing City", sort_order=120),
    field("billing_state", "Billing State", sort_order=130),
    field("billing_postal_code", "Billing Postal Code", sort_order=140),
    field("billing_country", "Billing Country", sort_order=150),
    field("created_time", "Created At", "datetime", sort_order=160),
]

DEAL_FIELDS = [
    field("opportunity_id", "Deal ID", "number", protected=True, sort_order=10),
    field("opportunity_name", "Deal Name", sort_order=20),
    field("client", "Client", sort_order=30),
    field("sales_stage", "Stage", sort_order=40),
    field("organization_id", "Account", "number", sort_order=50),
    field("contact_id", "Contact", "number", sort_order=60),
    field("assigned_to", "Owner", "number", sort_order=70),
    field("expected_close_date", "Expected Close Date", "date", sort_order=80),
    field("currency_type", "Currency", sort_order=90),
    field("total_cost_of_project", "Amount", "number", sort_order=100),
    field("last_contacted_at", "Last Contacted At", "datetime", sort_order=110),
    field("created_time", "Created At", "datetime", sort_order=120),
    field("campaign_type", "Campaign Type", enabled=False, sort_order=900),
    field("total_leads", "Total Leads", "number", enabled=False, sort_order=910),
    field("cpl", "CPL", "number", enabled=False, sort_order=920),
    field("target_geography", "Target Geography", enabled=False, sort_order=930),
    field("target_audience", "Target Audience", enabled=False, sort_order=940),
    field("domain_cap", "Domain Cap", enabled=False, sort_order=950),
    field("tactics", "Tactics", enabled=False, sort_order=960),
    field("delivery_format", "Delivery Format", enabled=False, sort_order=970),
    field("attachments", "Attachments", enabled=False, sort_order=980),
]

STANDARD_RECORD_FIELDS = [
    field("id", "ID", "number", protected=True, sort_order=10),
    field("name", "Name", sort_order=20),
    field("status", "Status", sort_order=30),
    field("owner_id", "Owner", "number", sort_order=40),
    field("created_at", "Created At", "datetime", sort_order=90),
    field("updated_at", "Updated At", "datetime", sort_order=100),
]


def generic_route(module_key: str) -> str:
    return f"/dashboard/modules/{module_key}"


SYSTEM_MODULES: dict[str, SystemModule] = {
    "catalog_products": module(
        "Products",
        base_route="/dashboard/catalog/products",
        description="Catalog products",
        sidebar_tab_key="catalog",
        sort_order=300,
        fields=[
            field("id", "Product ID", "number", protected=True, sort_order=10),
            field("name", "Name", sort_order=20),
            field("sku", "SKU", sort_order=30),
            field("description", "Description", "textarea", sort_order=40),
            field("currency", "Currency", sort_order=50),
            field("public_unit_price", "Public Unit Price", "number", sort_order=60),
            field("stock_status", "Stock Status", sort_order=70),
            field("is_public", "Public", "boolean", sort_order=80),
            field("is_active", "Active", "boolean", sort_order=90),
        ],
    ),
    "catalog_services": module(
        "Services",
        base_route="/dashboard/catalog/services",
        description="Catalog services",
        sidebar_tab_key="catalog",
        sort_order=310,
        fields=[
            field("id", "Service ID", "number", protected=True, sort_order=10),
            field("name", "Name", sort_order=20),
            field("description", "Description", "textarea", sort_order=30),
            field("currency", "Currency", sort_order=40),
            field("public_unit_price", "Public Unit Price", "number", sort_order=50),
            field("is_public", "Public", "boolean", sort_order=60),
            field("is_active", "Active", "boolean", sort_order=70),
        ],
    ),
    "documents": module("Documents", base_route="/dashboard/documents", description="Controlled document uploads and record-linked files", sidebar_tab_key="none", sort_order=610),
    "mail": module("Mail", base_route="/dashboard/mail", description="Mailbox integration and CRM communication history", sidebar_tab_key="none", sort_order=620),
    "calendar": module("Calendar", base_route="/dashboard/calendar", description="Shared user calendar and scheduling", sidebar_tab_key="other", sort_order=630),
    "tasks": module("Tasks", base_route="/dashboard/tasks", description="Collaborative task management and assignment", sidebar_tab_key="none", sort_order=600),
    "finance_io": module("Insertion Orders", base_route="/dashboard/finance/insertion-orders", description="Finance insertion orders", sidebar_tab_key="finance", sort_order=410),
    "finance_pos": module("POS", base_route="/dashboard/finance/pos", description="POS mode invoices and walk-in sales", sidebar_tab_key="finance", sort_order=420),
    "sales_contacts": module("Contacts", base_route="/dashboard/sales/contacts", description="People related to accounts, deals, support, and transactions.", sidebar_tab_key="sales", sort_order=120, fields=CONTACT_FIELDS),
    "sales_organizations": module("Accounts", base_route="/dashboard/sales/organizations", description="Companies, organizations, and customer accounts.", sidebar_tab_key="sales", sort_order=110, fields=ACCOUNT_FIELDS),
    "sales_opportunities": module("Deals", base_route="/dashboard/sales/opportunities", description="Sales deals and pipeline opportunities.", sidebar_tab_key="sales", sort_order=130, fields=DEAL_FIELDS),
    "message_templates": module("Templates", base_route="/dashboard/settings/message-templates", description="Reusable communication templates", sidebar_tab_key="settings", sort_order=700),
    "whatsapp": module("WhatsApp", base_route=None, description="WhatsApp click-to-chat and message helpers", sidebar_tab_key="none", sort_order=640),
    "sales_leads": module("Leads", base_route=generic_route("sales_leads"), description="Unqualified prospects before conversion.", fields=STANDARD_RECORD_FIELDS),
    "sales_activities": module("Activities", base_route=generic_route("sales_activities"), description="Generic sales and customer interactions.", fields=STANDARD_RECORD_FIELDS),
    "sales_notes": module("Notes", base_route=generic_route("sales_notes"), description="Record-linked sales notes.", fields=STANDARD_RECORD_FIELDS),
    "sales_quotes": module("Quotes", base_route=generic_route("sales_quotes"), description="Customer quotes and estimates.", fields=STANDARD_RECORD_FIELDS),
    "sales_orders": module("Sales Orders", base_route=generic_route("sales_orders"), description="Confirmed customer orders.", fields=STANDARD_RECORD_FIELDS),
    "finance_invoices": module("Invoices", base_route=generic_route("finance_invoices"), description="Generic customer invoices.", fields=STANDARD_RECORD_FIELDS),
    "finance_payments": module("Payments", base_route=generic_route("finance_payments"), description="Customer payment records.", fields=STANDARD_RECORD_FIELDS),
    "finance_credit_notes": module("Credit Notes", base_route=generic_route("finance_credit_notes"), description="Customer credit notes.", fields=STANDARD_RECORD_FIELDS),
    "finance_expenses": module("Expenses", base_route=generic_route("finance_expenses"), description="Business expenses.", fields=STANDARD_RECORD_FIELDS),
    "purchase_vendors": module("Vendors", base_route=generic_route("purchase_vendors"), description="Supplier and vendor records.", fields=STANDARD_RECORD_FIELDS),
    "purchase_orders": module("Purchase Orders", base_route=generic_route("purchase_orders"), description="Orders sent to vendors.", fields=STANDARD_RECORD_FIELDS),
    "inventory_warehouses": module("Warehouses", base_route=generic_route("inventory_warehouses"), description="Inventory warehouse records.", fields=STANDARD_RECORD_FIELDS),
    "inventory_locations": module("Stock Locations", base_route=generic_route("inventory_locations"), description="Inventory storage locations.", fields=STANDARD_RECORD_FIELDS),
    "inventory_stock_moves": module("Stock Moves", base_route=generic_route("inventory_stock_moves"), description="Inventory movement records.", fields=STANDARD_RECORD_FIELDS),
    "inventory_stock_adjustments": module("Stock Adjustments", base_route=generic_route("inventory_stock_adjustments"), description="Inventory quantity adjustments.", fields=STANDARD_RECORD_FIELDS),
    "support_tickets": module("Tickets", base_route=generic_route("support_tickets"), description="Customer support tickets.", fields=STANDARD_RECORD_FIELDS),
    "projects": module("Projects", base_route=generic_route("projects"), description="Customer or internal projects.", fields=STANDARD_RECORD_FIELDS),
    "project_tasks": module("Project Tasks", base_route=generic_route("project_tasks"), description="Tasks scoped to projects.", fields=STANDARD_RECORD_FIELDS),
}


def iter_system_modules() -> list[tuple[str, SystemModule]]:
    return sorted(SYSTEM_MODULES.items(), key=lambda item: (int(item[1].get("sort_order", 100)), item[0]))
