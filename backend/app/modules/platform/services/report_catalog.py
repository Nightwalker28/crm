"""What a report can be built from: one source per module and the fields it offers.

A source knows its base query (tenant, recycle bin and each module's own visibility rules),
its record identity and link, and whose records are whose. A field knows its SQL expression
and its type, and the type decides what the builder may do with it: group by it, measure
it, filter on it or show it as a column. `report_engine` does the rest.

Reference fields (owners, accounts, stages, pipelines) group by their stored ID or key and
are labelled afterwards by a resolver here, so a chart reads "Ada Lovelace", not "7".
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field as dataclass_field
from typing import Any, Callable

from fastapi import HTTPException, status
from sqlalchemy import Date, Numeric, String, and_, case, cast, func, or_, select
from sqlalchemy.orm import Session

from app.core.access_control import get_finance_user_scope, require_role_module_action_access
from app.modules.finance.models import FinanceCreditNote, FinanceIO, FinancePayment, FinancePosInvoice, FinancePosInvoiceLine
from app.modules.catalog.models import CatalogProduct
from app.modules.inventory.models import (
    InventoryDelivery, InventoryDeliveryLine, InventoryReservation, InventoryReturn, InventoryReturnLine,
    InventoryRevaluation, InventoryStockLevel, InventoryStockMove, InventoryWarehouse,
)
from app.modules.finance.repositories import io_repository
from app.modules.purchasing.models import PurchaseBill, PurchaseOrder, PurchaseOrderLine, PurchaseReceipt, PurchaseReceiptLine
from app.modules.finance.services.io_search_services import get_finance_module_id
from app.modules.platform.models import CustomFieldValue, CustomModuleDefinition, CustomModuleRecord, CustomModuleRecordValue
from app.modules.platform.services import custom_modules
from app.modules.platform.services.custom_fields import CUSTOM_FIELD_FILTER_PREFIX, list_custom_field_definitions
from app.modules.platform.services.module_fields import module_field_enabled_map
from app.modules.sales.models import (
    SalesContact,
    SalesLead,
    SalesOpportunity,
    SalesOrder,
    SalesOrderItem,
    SalesOrganization,
    SalesPipeline,
    SalesPipelineStage,
    SalesQuote,
)
from app.modules.sales.repositories import (
    contacts_repository,
    leads_repository,
    opportunities_repository,
    organizations_repository,
    quotes_repository,
)
from app.modules.tasks.models import Task, TaskAssignee
from app.modules.tasks.repositories import tasks_repository
from app.modules.user_management.models import Team, User


# What each field type allows. `user` and `reference` are stored IDs with a resolved label.
GROUPABLE_TYPES = {"text", "select", "date", "datetime", "boolean", "user", "reference"}
MEASURABLE_TYPES = {"number", "money"}
DATE_TYPES = {"date", "datetime"}
FILTER_TYPES = {
    "text": "text",
    "select": "text",
    "number": "number",
    "money": "number",
    "date": "date",
    "datetime": "date",
    "boolean": "boolean",
    "user": "number",
    "reference": "number",
}


@dataclass(frozen=True)
class ReportField:
    key: str
    label: str
    field_type: str
    expression: Any
    # A label resolver name from `LABEL_RESOLVERS`; `None` shows the stored value.
    labels: str | None = None
    # False for identity fields such as a name: grouping by one gives a group per record.
    groupable: bool = True

    @property
    def can_group(self) -> bool:
        return self.groupable and self.field_type in GROUPABLE_TYPES

    @property
    def can_measure(self) -> bool:
        return self.field_type in MEASURABLE_TYPES

    @property
    def filter_type(self) -> str:
        return FILTER_TYPES.get(self.field_type, "text")

    def payload(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "label": self.label,
            "field_type": self.field_type,
            "groupable": self.can_group,
            "measurable": self.can_measure,
            "filter_type": self.filter_type,
        }


@dataclass(frozen=True)
class ReportSource:
    module_key: str
    label: str
    model: Any
    record_id: Any
    record_label: Callable[[Session], Any]
    # Tenant, recycle bin, search and the module's own visibility. No field filters: the
    # engine applies those against report fields, so every report field is filterable.
    base_query: Callable[[Session, Any, str | None], Any]
    fields: Callable[[Session, Any], list[ReportField]]
    # `/dashboard/…/{id}`, or None when the module has no record page.
    record_path: str | None
    default_columns: tuple[str, ...]
    default_date_field: str | None = None
    # (current_user, scope) -> a clause, for "Show me: Mine / My team". None: not offered.
    scope_clause: Callable[[Session, Any, str], Any] | None = None
    # Legacy keys that saved version 1 configs may hold.
    aliases: dict[str, str] = dataclass_field(default_factory=dict)
    # The field the record label already shows, so a record list does not repeat it.
    label_field: str | None = None
    permission_module_key: str | None = None


def _enabled(db: Session, *, tenant_id: int, module_key: str, fields: list[ReportField]) -> list[ReportField]:
    states = module_field_enabled_map(db, tenant_id=tenant_id, module_key=module_key)
    return [item for item in fields if states.get(item.key, True)]


def _full_name(first, last):
    return func.trim(func.coalesce(first, "") + " " + func.coalesce(last, ""))


def _custom_fields(db: Session, *, tenant_id: int, module_key: str, record_id_expression) -> list[ReportField]:
    fields: list[ReportField] = []
    definitions = list_custom_field_definitions(db, tenant_id=tenant_id, module_key=module_key, include_inactive=False)
    for definition in definitions:
        if definition.field_type in {"text", "long_text"}:
            value_column, field_type = CustomFieldValue.value_text, "text"
        elif definition.field_type == "number":
            value_column, field_type = cast(cast(CustomFieldValue.value_number, String), Numeric(18, 6)), "number"
        elif definition.field_type == "date":
            value_column, field_type = cast(CustomFieldValue.value_date, Date), "date"
        elif definition.field_type == "boolean":
            value_column, field_type = CustomFieldValue.value_boolean, "boolean"
        else:
            continue
        expression = (
            select(value_column)
            .where(
                CustomFieldValue.module_key == module_key,
                CustomFieldValue.tenant_id == tenant_id,
                CustomFieldValue.record_id == record_id_expression,
                CustomFieldValue.field_definition_id == definition.id,
            )
            .limit(1)
            .scalar_subquery()
        )
        fields.append(
            ReportField(
                f"{CUSTOM_FIELD_FILTER_PREFIX}{definition.field_key}",
                definition.label,
                field_type,
                expression,
                groupable=definition.field_type != "long_text",
            )
        )
    return fields


def _team_member_ids(db: Session, current_user):
    team_id = getattr(current_user, "team_id", None)
    if team_id is None:
        return None
    return select(User.id).where(User.tenant_id == current_user.tenant_id, User.team_id == team_id)


def _owner_scope(owner_column) -> Callable[[Session, Any, str], Any]:
    """Mine is the owner. My team is any owner on the viewer's team, or just the viewer
    when they have no team, which is what Salesforce's "My team's" shows a teamless user."""

    def clause(db: Session, current_user, scope: str):
        if scope == "mine":
            return owner_column == current_user.id
        members = _team_member_ids(db, current_user)
        if members is None:
            return owner_column == current_user.id
        return owner_column.in_(members)

    return clause


def _task_scope(db: Session, current_user, scope: str):
    if scope == "mine":
        return Task.assignees.any(TaskAssignee.user_id == current_user.id)
    team_id = getattr(current_user, "team_id", None)
    if team_id is None:
        return Task.assignees.any(TaskAssignee.user_id == current_user.id)
    return or_(
        Task.assignees.any(TaskAssignee.team_id == team_id),
        Task.assignees.any(TaskAssignee.user_id.in_(_team_member_ids(db, current_user))),
    )


# ---------------------------------------------------------------------------- fields


def _lead_fields(db: Session, user) -> list[ReportField]:
    return _enabled(db, tenant_id=user.tenant_id, module_key="sales_leads", fields=[
        ReportField("name", "Name", "text", _full_name(SalesLead.first_name, SalesLead.last_name), groupable=False),
        ReportField("company", "Company", "text", SalesLead.company),
        ReportField("primary_email", "Email", "text", SalesLead.primary_email, groupable=False),
        ReportField("status", "Status", "select", SalesLead.status, labels="humanize"),
        ReportField("source", "Source", "select", SalesLead.source, labels="humanize"),
        ReportField("assigned_to", "Owner", "user", SalesLead.assigned_to, labels="user"),
        ReportField("team_id", "Team", "reference", SalesLead.team_id, labels="team"),
        ReportField("title", "Job title", "text", SalesLead.title),
        ReportField("created_time", "Created", "datetime", SalesLead.created_time),
        ReportField("last_contacted_at", "Last contacted", "datetime", SalesLead.last_contacted_at),
        ReportField("next_follow_up_at", "Next follow-up", "datetime", SalesLead.next_follow_up_at),
        *_custom_fields(db, tenant_id=user.tenant_id, module_key="sales_leads", record_id_expression=SalesLead.lead_id),
    ])


def _contact_fields(db: Session, user) -> list[ReportField]:
    return _enabled(db, tenant_id=user.tenant_id, module_key="sales_contacts", fields=[
        ReportField("name", "Name", "text", _full_name(SalesContact.first_name, SalesContact.last_name), groupable=False),
        ReportField("primary_email", "Email", "text", SalesContact.primary_email, groupable=False),
        ReportField("organization_id", "Account", "reference", SalesContact.organization_id, labels="organization"),
        ReportField("current_title", "Job title", "text", SalesContact.current_title),
        ReportField("region", "Region", "text", SalesContact.region),
        ReportField("country", "Country", "text", SalesContact.country),
        ReportField("assigned_to", "Owner", "user", SalesContact.assigned_to, labels="user"),
        ReportField("email_opt_out", "Email opt-out", "boolean", SalesContact.email_opt_out),
        ReportField("created_time", "Created", "datetime", SalesContact.created_time),
        ReportField("last_contacted_at", "Last contacted", "datetime", SalesContact.last_contacted_at),
        *_custom_fields(db, tenant_id=user.tenant_id, module_key="sales_contacts", record_id_expression=SalesContact.contact_id),
    ])


def _organization_fields(db: Session, user) -> list[ReportField]:
    return _enabled(db, tenant_id=user.tenant_id, module_key="sales_organizations", fields=[
        ReportField("org_name", "Name", "text", SalesOrganization.org_name, groupable=False),
        ReportField("industry", "Industry", "text", SalesOrganization.industry),
        ReportField("billing_country", "Country", "text", SalesOrganization.billing_country),
        ReportField("billing_city", "City", "text", SalesOrganization.billing_city),
        ReportField("assigned_to", "Owner", "user", SalesOrganization.assigned_to, labels="user"),
        ReportField("created_time", "Created", "datetime", SalesOrganization.created_time),
        *_custom_fields(db, tenant_id=user.tenant_id, module_key="sales_organizations", record_id_expression=SalesOrganization.org_id),
    ])


def _opportunity_fields(db: Session, user) -> list[ReportField]:
    return _enabled(db, tenant_id=user.tenant_id, module_key="sales_opportunities", fields=[
        ReportField("opportunity_name", "Name", "text", SalesOpportunity.opportunity_name, groupable=False),
        ReportField("client", "Client", "text", SalesOpportunity.client),
        ReportField("organization_id", "Account", "reference", SalesOpportunity.organization_id, labels="organization"),
        ReportField("contact_id", "Primary contact", "reference", SalesOpportunity.contact_id, labels="contact"),
        ReportField("pipeline_id", "Pipeline", "reference", SalesOpportunity.pipeline_id, labels="pipeline"),
        ReportField("sales_stage", "Stage", "select", SalesOpportunity.sales_stage, labels="stage"),
        ReportField("assigned_to", "Owner", "user", SalesOpportunity.assigned_to, labels="user"),
        ReportField("amount", "Amount", "money", opportunities_repository.opportunity_value_expression(db)),
        ReportField("probability_percent", "Probability", "number", SalesOpportunity.probability_percent),
        ReportField("currency_type", "Currency", "text", SalesOpportunity.currency_type),
        ReportField("target_geography", "Target geography", "text", SalesOpportunity.target_geography),
        ReportField("expected_close_date", "Expected close", "date", SalesOpportunity.expected_close_date),
        ReportField("start_date", "Start date", "date", SalesOpportunity.start_date),
        ReportField("created_time", "Created", "datetime", SalesOpportunity.created_time),
        ReportField("last_contacted_at", "Last contacted", "datetime", SalesOpportunity.last_contacted_at),
        *_custom_fields(db, tenant_id=user.tenant_id, module_key="sales_opportunities", record_id_expression=SalesOpportunity.opportunity_id),
    ])


def _quote_fields(db: Session, user) -> list[ReportField]:
    return _enabled(db, tenant_id=user.tenant_id, module_key="sales_quotes", fields=[
        ReportField("quote_number", "Quote number", "text", SalesQuote.quote_number, groupable=False),
        ReportField("title", "Title", "text", SalesQuote.title, groupable=False),
        ReportField("customer_name", "Customer", "text", SalesQuote.customer_name),
        ReportField("organization_id", "Account", "reference", SalesQuote.organization_id, labels="organization"),
        ReportField("status", "Status", "select", SalesQuote.status, labels="humanize"),
        ReportField("assigned_to", "Owner", "user", SalesQuote.assigned_to, labels="user"),
        ReportField("currency", "Currency", "text", SalesQuote.currency),
        ReportField("issue_date", "Issue date", "date", SalesQuote.issue_date),
        ReportField("expiry_date", "Expiry date", "date", SalesQuote.expiry_date),
        ReportField("created_time", "Created", "datetime", SalesQuote.created_time),
        ReportField("subtotal_amount", "Subtotal", "money", SalesQuote.subtotal_amount),
        ReportField("discount_amount", "Discount", "money", SalesQuote.discount_amount),
        ReportField("tax_amount", "Tax", "money", SalesQuote.tax_amount),
        ReportField("total_amount", "Total", "money", SalesQuote.total_amount),
        *_custom_fields(db, tenant_id=user.tenant_id, module_key="sales_quotes", record_id_expression=SalesQuote.quote_id),
    ])


def _task_fields(db: Session, user) -> list[ReportField]:
    return _enabled(db, tenant_id=user.tenant_id, module_key="tasks", fields=[
        ReportField("title", "Title", "text", Task.title, groupable=False),
        ReportField("status", "Status", "select", Task.status, labels="humanize"),
        ReportField("priority", "Priority", "select", Task.priority, labels="humanize"),
        ReportField("source_module_key", "Related to", "select", Task.source_module_key, labels="module"),
        ReportField("created_by_user_id", "Created by", "user", Task.created_by_user_id, labels="user"),
        ReportField("due_at", "Due", "datetime", Task.due_at),
        ReportField("completed_at", "Completed", "datetime", Task.completed_at),
        ReportField("created_at", "Created", "datetime", Task.created_at),
    ])


def _finance_fields(db: Session, user) -> list[ReportField]:
    return _enabled(db, tenant_id=user.tenant_id, module_key="finance_io", fields=[
        ReportField("io_number", "Number", "text", FinanceIO.io_number, groupable=False),
        ReportField("customer_name", "Customer", "text", FinanceIO.customer_name),
        ReportField("status", "Status", "select", FinanceIO.status, labels="humanize"),
        ReportField("user_id", "Owner", "user", FinanceIO.user_id, labels="user"),
        ReportField("currency", "Currency", "text", FinanceIO.currency),
        ReportField("issue_date", "Issue date", "date", FinanceIO.issue_date),
        ReportField("effective_date", "Effective date", "date", FinanceIO.effective_date),
        ReportField("due_date", "Due date", "date", FinanceIO.due_date),
        ReportField("start_date", "Start date", "date", FinanceIO.start_date),
        ReportField("end_date", "End date", "date", FinanceIO.end_date),
        ReportField("subtotal_amount", "Subtotal", "money", FinanceIO.subtotal_amount),
        ReportField("tax_amount", "Tax", "money", FinanceIO.tax_amount),
        ReportField("total_amount", "Total", "money", FinanceIO.total_amount),
        ReportField("created_at", "Created", "datetime", FinanceIO.created_at),
        ReportField("updated_at", "Updated", "datetime", FinanceIO.updated_at),
        *_custom_fields(db, tenant_id=user.tenant_id, module_key="finance_io", record_id_expression=FinanceIO.id),
    ])


def _finance_base_query(db: Session, user, search: str | None):
    scope = get_finance_user_scope(db, user)
    return io_repository.build_insertion_orders_query(
        db,
        tenant_id=user.tenant_id,
        module_id=get_finance_module_id(db),
        user_id=scope.user_id_filter,
        search=search,
        all_filter_conditions=[],
        any_filter_conditions=[],
    )


def _inventory_levels_query(db: Session, user, search: str | None):
    query = db.query(InventoryStockLevel).join(CatalogProduct, CatalogProduct.id == InventoryStockLevel.product_id).join(InventoryWarehouse, InventoryWarehouse.id == InventoryStockLevel.warehouse_id).filter(
        InventoryStockLevel.tenant_id == user.tenant_id, CatalogProduct.tenant_id == user.tenant_id,
        InventoryWarehouse.tenant_id == user.tenant_id, CatalogProduct.deleted_at.is_(None), CatalogProduct.track_inventory == 1)
    return query.filter(or_(CatalogProduct.name.ilike(f"%{search}%"), CatalogProduct.sku.ilike(f"%{search}%"))) if search else query


def _inventory_moves_query(db: Session, user, search: str | None):
    query = db.query(InventoryStockMove).join(CatalogProduct, CatalogProduct.id == InventoryStockMove.product_id).join(InventoryWarehouse, InventoryWarehouse.id == InventoryStockMove.warehouse_id).filter(
        InventoryStockMove.tenant_id == user.tenant_id, CatalogProduct.tenant_id == user.tenant_id,
        InventoryWarehouse.tenant_id == user.tenant_id)
    return query.filter(or_(CatalogProduct.name.ilike(f"%{search}%"), CatalogProduct.sku.ilike(f"%{search}%"))) if search else query


def _inventory_level_fields(db: Session, user) -> list[ReportField]:
    available = InventoryStockLevel.on_hand - InventoryStockLevel.reserved
    reorder_point = select(CatalogProduct.reorder_point).where(CatalogProduct.id == InventoryStockLevel.product_id, CatalogProduct.tenant_id == InventoryStockLevel.tenant_id).scalar_subquery()
    product_name = select(CatalogProduct.name).where(CatalogProduct.id == InventoryStockLevel.product_id, CatalogProduct.tenant_id == InventoryStockLevel.tenant_id).scalar_subquery()
    product_sku = select(CatalogProduct.sku).where(CatalogProduct.id == InventoryStockLevel.product_id, CatalogProduct.tenant_id == InventoryStockLevel.tenant_id).scalar_subquery()
    warehouse_name = select(InventoryWarehouse.name).where(InventoryWarehouse.id == InventoryStockLevel.warehouse_id, InventoryWarehouse.tenant_id == InventoryStockLevel.tenant_id).scalar_subquery()
    health = case((available <= 0, "out_of_stock"), (reorder_point > 0, case((available <= reorder_point, "low_stock"), else_="in_stock")), else_="in_stock")
    return [
        ReportField("product", "Product", "text", product_name),
        ReportField("sku", "SKU", "text", product_sku),
        ReportField("warehouse", "Warehouse", "text", warehouse_name),
        ReportField("on_hand", "On hand", "number", InventoryStockLevel.on_hand),
        ReportField("reserved", "Reserved", "number", InventoryStockLevel.reserved),
        ReportField("available", "Available", "number", available),
        ReportField("reorder_point", "Reorder point", "number", reorder_point),
        ReportField("low_stock", "Low stock", "boolean", and_(reorder_point > 0, available <= reorder_point)),
        ReportField("stock_health", "Stock health", "select", health, labels="humanize"),
        *([ReportField("stock_value", "Stock value", "money", InventoryStockLevel.on_hand * func.coalesce(select(CatalogProduct.cost_price).where(
            CatalogProduct.id == InventoryStockLevel.product_id, CatalogProduct.tenant_id == InventoryStockLevel.tenant_id).scalar_subquery(), 0))]
          if _can_view_valuation(db, user) else []),
    ]


def _inventory_move_fields(db: Session, user) -> list[ReportField]:
    product_name = select(CatalogProduct.name).where(CatalogProduct.id == InventoryStockMove.product_id, CatalogProduct.tenant_id == InventoryStockMove.tenant_id).scalar_subquery()
    warehouse_name = select(InventoryWarehouse.name).where(InventoryWarehouse.id == InventoryStockMove.warehouse_id, InventoryWarehouse.tenant_id == InventoryStockMove.tenant_id).scalar_subquery()
    return [
        ReportField("product", "Product", "text", product_name),
        ReportField("warehouse", "Warehouse", "text", warehouse_name),
        ReportField("move_type", "Type", "select", InventoryStockMove.move_type, labels="humanize"),
        ReportField("quantity", "Change", "number", InventoryStockMove.quantity),
        ReportField("on_hand_after", "On hand after", "number", InventoryStockMove.on_hand_after),
        ReportField("occurred_at", "Date", "datetime", InventoryStockMove.occurred_at),
        *([ReportField("unit_cost", "Unit cost", "money", InventoryStockMove.unit_cost),
           ReportField("value", "Value", "money", InventoryStockMove.value),
           ReportField("cost_source", "Cost from", "select", InventoryStockMove.cost_source, labels="humanize")]
          if _can_view_valuation(db, user) else []),
    ]


def _can_view_valuation(db: Session, user) -> bool:
    """The same check the catalog makes for a source, so a value field and the Valuation
    sources appear to exactly the same people."""
    return can_view_module(db, user, "inventory_valuation")


# --- E6 costing (12d-erp-costing.md §3.7) --------------------------------------------------

_COGS_SOURCES = ("inventory_delivery", "sales_order", "website_order", "inventory_return")


def _product_column(column, product_id):
    return select(column).where(CatalogProduct.id == product_id).scalar_subquery()


def _category_name(product_id):
    from app.modules.catalog.models import CatalogCategory

    return select(CatalogCategory.name).join(CatalogProduct, CatalogProduct.category_id == CatalogCategory.id).where(CatalogProduct.id == product_id).scalar_subquery()


def _valuation_query(db: Session, user, search: str | None):
    query = db.query(CatalogProduct).filter(CatalogProduct.tenant_id == user.tenant_id, CatalogProduct.track_inventory == 1,
        CatalogProduct.deleted_at.is_(None), CatalogProduct.stock_quantity > 0)
    return query.filter(or_(CatalogProduct.name.ilike(f"%{search}%"), CatalogProduct.sku.ilike(f"%{search}%"))) if search else query


def _valuation_fields(db: Session, user) -> list[ReportField]:
    return [
        ReportField("product", "Product", "text", CatalogProduct.name, groupable=False),
        ReportField("sku", "SKU", "text", CatalogProduct.sku, groupable=False),
        ReportField("category", "Category", "text", _category_name(CatalogProduct.id)),
        ReportField("on_hand", "On hand", "number", CatalogProduct.stock_quantity),
        ReportField("average_cost", "Average cost", "money", CatalogProduct.cost_price),
        ReportField("stock_value", "Stock value", "money", CatalogProduct.stock_value),
        ReportField("cost_missing", "Cost missing", "boolean", CatalogProduct.stock_value <= 0),
    ]


def _cogs_query(db: Session, user, search: str | None):
    query = db.query(InventoryStockMove).join(CatalogProduct, CatalogProduct.id == InventoryStockMove.product_id).filter(
        InventoryStockMove.tenant_id == user.tenant_id, CatalogProduct.tenant_id == user.tenant_id,
        InventoryStockMove.source_type.in_(_COGS_SOURCES))
    return query.filter(or_(CatalogProduct.name.ilike(f"%{search}%"), CatalogProduct.sku.ilike(f"%{search}%"))) if search else query


def _cogs_fields(db: Session, user) -> list[ReportField]:
    order_number = select(SalesOrder.order_number).join(SalesOrderItem, SalesOrderItem.order_id == SalesOrder.id).where(
        SalesOrderItem.id == InventoryStockMove.sales_order_item_id).scalar_subquery()
    customer = select(SalesOrganization.org_name).join(SalesOrder, SalesOrder.organization_id == SalesOrganization.org_id).join(
        SalesOrderItem, SalesOrderItem.order_id == SalesOrder.id).where(SalesOrderItem.id == InventoryStockMove.sales_order_item_id).scalar_subquery()
    return [
        ReportField("product", "Product", "text", _product_column(CatalogProduct.name, InventoryStockMove.product_id)),
        ReportField("sku", "SKU", "text", _product_column(CatalogProduct.sku, InventoryStockMove.product_id)),
        ReportField("category", "Category", "text", _category_name(InventoryStockMove.product_id)),
        ReportField("customer", "Customer", "text", customer),
        ReportField("order", "Order", "text", order_number),
        ReportField("move_type", "Type", "select", InventoryStockMove.move_type, labels="humanize"),
        ReportField("occurred_at", "Date", "datetime", InventoryStockMove.occurred_at),
        ReportField("units", "Units sold", "number", -InventoryStockMove.quantity),
        ReportField("cost_of_goods", "Cost of goods", "money", -func.coalesce(InventoryStockMove.value, 0)),
    ]


def _margin_query(db: Session, user, search: str | None):
    query = db.query(SalesOrderItem).join(SalesOrder, and_(SalesOrder.id == SalesOrderItem.order_id, SalesOrder.tenant_id == SalesOrderItem.tenant_id)).join(
        CatalogProduct, and_(CatalogProduct.id == SalesOrderItem.catalog_product_id, CatalogProduct.tenant_id == SalesOrderItem.tenant_id)).filter(
        SalesOrderItem.tenant_id == user.tenant_id, SalesOrder.status != "cancelled", CatalogProduct.track_inventory == 1)
    return query.filter(or_(CatalogProduct.name.ilike(f"%{search}%"), CatalogProduct.sku.ilike(f"%{search}%"), SalesOrder.order_number.ilike(f"%{search}%"))) if search else query


def _margin_fields(db: Session, user) -> list[ReportField]:
    """Delivered quantities at their actual cost, revenue converted at the order's rate; an
    order in another currency with no rate has no revenue (12d §3.3)."""
    from app.modules.inventory.services.costing import base_currency

    base = base_currency(db, tenant_id=user.tenant_id)
    delivered = select(func.coalesce(func.sum(InventoryDeliveryLine.quantity), 0)).join(InventoryDelivery, InventoryDelivery.id == InventoryDeliveryLine.delivery_id).where(
        InventoryDeliveryLine.order_line_id == SalesOrderItem.id, InventoryDelivery.status == "posted").scalar_subquery()
    returned = select(func.coalesce(func.sum(InventoryReturnLine.quantity), 0)).join(InventoryReturn, InventoryReturn.id == InventoryReturnLine.return_id).where(
        InventoryReturnLine.order_line_id == SalesOrderItem.id, InventoryReturn.status == "received").scalar_subquery()
    cost = -select(func.coalesce(func.sum(InventoryStockMove.value), 0)).where(InventoryStockMove.sales_order_item_id == SalesOrderItem.id).scalar_subquery()
    currency = select(SalesOrder.currency).where(SalesOrder.id == SalesOrderItem.order_id).scalar_subquery()
    rate = case((func.upper(currency) == base, 1), else_=select(SalesOrder.exchange_rate).where(SalesOrder.id == SalesOrderItem.order_id).scalar_subquery())
    net = SalesOrderItem.line_total - SalesOrderItem.tax_amount
    sold = delivered - returned
    revenue = case((SalesOrderItem.quantity > 0, net * sold / SalesOrderItem.quantity * rate), else_=0)
    order_number = select(SalesOrder.order_number).where(SalesOrder.id == SalesOrderItem.order_id).scalar_subquery()
    order_date = select(SalesOrder.created_at).where(SalesOrder.id == SalesOrderItem.order_id).scalar_subquery()
    customer = select(SalesOrganization.org_name).join(SalesOrder, SalesOrder.organization_id == SalesOrganization.org_id).where(
        SalesOrder.id == SalesOrderItem.order_id).scalar_subquery()
    return [
        ReportField("product", "Product", "text", _product_column(CatalogProduct.name, SalesOrderItem.catalog_product_id)),
        ReportField("sku", "SKU", "text", _product_column(CatalogProduct.sku, SalesOrderItem.catalog_product_id)),
        ReportField("category", "Category", "text", _category_name(SalesOrderItem.catalog_product_id)),
        ReportField("customer", "Customer", "text", customer),
        ReportField("order", "Order", "text", order_number),
        ReportField("order_date", "Order date", "datetime", order_date),
        ReportField("sold", "Units sold", "number", sold),
        ReportField("revenue", "Revenue", "money", revenue),
        ReportField("cost_of_goods", "Cost of goods", "money", cost),
        ReportField("margin", "Margin", "money", revenue - cost),
    ]


def _revaluations_query(db: Session, user, search: str | None):
    query = db.query(InventoryRevaluation).join(CatalogProduct, CatalogProduct.id == InventoryRevaluation.product_id).filter(
        InventoryRevaluation.tenant_id == user.tenant_id, CatalogProduct.tenant_id == user.tenant_id)
    return query.filter(or_(InventoryRevaluation.number.ilike(f"%{search}%"), CatalogProduct.name.ilike(f"%{search}%"))) if search else query


def _revaluation_fields(db: Session, user) -> list[ReportField]:
    return [
        ReportField("number", "Number", "text", InventoryRevaluation.number, groupable=False),
        ReportField("product", "Product", "text", _product_column(CatalogProduct.name, InventoryRevaluation.product_id)),
        ReportField("kind", "Kind", "select", InventoryRevaluation.kind, labels="humanize"),
        ReportField("created_at", "Date", "datetime", InventoryRevaluation.created_at),
        ReportField("average_before", "Average before", "money", InventoryRevaluation.average_before),
        ReportField("average_after", "Average after", "money", InventoryRevaluation.average_after),
        ReportField("stock_change", "Change to stock value", "money", InventoryRevaluation.stock_change),
        ReportField("cogs_change", "Change to cost of goods", "money", InventoryRevaluation.cogs_change),
        ReportField("reason", "Reason", "text", InventoryRevaluation.reason, groupable=False),
        ReportField("created_by", "By", "user", InventoryRevaluation.created_by, labels="user"),
    ]


def _deliveries_query(db: Session, user, search: str | None):
    query = db.query(InventoryDelivery).filter(InventoryDelivery.tenant_id == user.tenant_id, InventoryDelivery.deleted_at.is_(None))
    return query.filter(or_(InventoryDelivery.number.ilike(f"%{search}%"), InventoryDelivery.tracking_number.ilike(f"%{search}%"))) if search else query


def _delivery_fields(db: Session, user) -> list[ReportField]:
    order_number = select(SalesOrder.order_number).where(SalesOrder.id == InventoryDelivery.order_id, SalesOrder.tenant_id == InventoryDelivery.tenant_id).scalar_subquery()
    warehouse_name = select(InventoryWarehouse.name).where(InventoryWarehouse.id == InventoryDelivery.warehouse_id, InventoryWarehouse.tenant_id == InventoryDelivery.tenant_id).scalar_subquery()
    units = select(func.coalesce(func.sum(InventoryDeliveryLine.quantity), 0)).where(InventoryDeliveryLine.delivery_id == InventoryDelivery.id).scalar_subquery()
    return [
        ReportField("number", "Number", "text", InventoryDelivery.number, groupable=False),
        ReportField("status", "Status", "select", InventoryDelivery.status, labels="humanize"),
        ReportField("order", "Order", "text", order_number),
        ReportField("warehouse", "Warehouse", "text", warehouse_name),
        ReportField("carrier", "Carrier", "text", InventoryDelivery.carrier),
        ReportField("shipped_on", "Shipped on", "date", InventoryDelivery.shipped_on),
        ReportField("units", "Units", "number", units),
    ]


def _backorder_query(db: Session, user, search: str | None):
    """Stocked lines of confirmed orders that still have something to deliver."""
    delivered = select(func.coalesce(func.sum(InventoryDeliveryLine.quantity), 0)).join(InventoryDelivery, InventoryDelivery.id == InventoryDeliveryLine.delivery_id).where(
        InventoryDeliveryLine.order_line_id == SalesOrderItem.id, InventoryDelivery.status == "posted").scalar_subquery()
    query = db.query(SalesOrderItem).join(SalesOrder, and_(SalesOrder.id == SalesOrderItem.order_id, SalesOrder.tenant_id == SalesOrderItem.tenant_id)).join(
        CatalogProduct, and_(CatalogProduct.id == SalesOrderItem.catalog_product_id, CatalogProduct.tenant_id == SalesOrderItem.tenant_id)).filter(
        SalesOrderItem.tenant_id == user.tenant_id, SalesOrder.status == "confirmed", SalesOrder.remaining_closed_at.is_(None),
        CatalogProduct.track_inventory == 1, CatalogProduct.deleted_at.is_(None), SalesOrderItem.quantity > delivered)
    return query.filter(or_(CatalogProduct.name.ilike(f"%{search}%"), CatalogProduct.sku.ilike(f"%{search}%"), SalesOrder.order_number.ilike(f"%{search}%"))) if search else query


def _backorder_fields(db: Session, user) -> list[ReportField]:
    delivered = select(func.coalesce(func.sum(InventoryDeliveryLine.quantity), 0)).join(InventoryDelivery, InventoryDelivery.id == InventoryDeliveryLine.delivery_id).where(
        InventoryDeliveryLine.order_line_id == SalesOrderItem.id, InventoryDelivery.status == "posted").scalar_subquery()
    reserved = select(func.coalesce(func.sum(InventoryReservation.quantity), 0)).where(InventoryReservation.order_line_id == SalesOrderItem.id).scalar_subquery()
    product = select(CatalogProduct.name).where(CatalogProduct.id == SalesOrderItem.catalog_product_id, CatalogProduct.tenant_id == SalesOrderItem.tenant_id).scalar_subquery()
    sku = select(CatalogProduct.sku).where(CatalogProduct.id == SalesOrderItem.catalog_product_id, CatalogProduct.tenant_id == SalesOrderItem.tenant_id).scalar_subquery()
    order_number = select(SalesOrder.order_number).where(SalesOrder.id == SalesOrderItem.order_id).scalar_subquery()
    delivery_date = select(SalesOrder.delivery_date).where(SalesOrder.id == SalesOrderItem.order_id).scalar_subquery()
    to_deliver = SalesOrderItem.quantity - delivered
    return [
        ReportField("product", "Product", "text", product),
        ReportField("sku", "SKU", "text", sku),
        ReportField("order", "Order", "text", order_number),
        ReportField("delivery_date", "Delivery date", "date", delivery_date),
        ReportField("ordered", "Ordered", "number", SalesOrderItem.quantity),
        ReportField("delivered", "Delivered", "number", delivered),
        ReportField("reserved", "Reserved", "number", reserved),
        ReportField("to_deliver", "To deliver", "number", to_deliver),
        ReportField("waiting", "Waiting", "number", to_deliver - reserved),
    ]


def _returns_query(db: Session, user, search: str | None):
    query = db.query(InventoryReturn).filter(InventoryReturn.tenant_id == user.tenant_id, InventoryReturn.deleted_at.is_(None))
    return query.filter(or_(InventoryReturn.number.ilike(f"%{search}%"), InventoryReturn.reason.ilike(f"%{search}%"))) if search else query


def _return_fields(db: Session, user) -> list[ReportField]:
    order_number = select(SalesOrder.order_number).where(SalesOrder.id == InventoryReturn.order_id, SalesOrder.tenant_id == InventoryReturn.tenant_id).scalar_subquery()
    warehouse_name = select(InventoryWarehouse.name).where(InventoryWarehouse.id == InventoryReturn.warehouse_id, InventoryWarehouse.tenant_id == InventoryReturn.tenant_id).scalar_subquery()
    units = select(func.coalesce(func.sum(InventoryReturnLine.quantity), 0)).where(InventoryReturnLine.return_id == InventoryReturn.id).scalar_subquery()
    restocked = select(func.coalesce(func.sum(InventoryReturnLine.quantity), 0)).where(InventoryReturnLine.return_id == InventoryReturn.id, InventoryReturnLine.restock == 1).scalar_subquery()
    return [
        ReportField("number", "Number", "text", InventoryReturn.number, groupable=False),
        ReportField("status", "Status", "select", InventoryReturn.status, labels="humanize"),
        ReportField("reason", "Reason", "text", InventoryReturn.reason),
        ReportField("order", "Order", "text", order_number),
        ReportField("warehouse", "Warehouse", "text", warehouse_name),
        ReportField("received_at", "Received", "datetime", InventoryReturn.received_at),
        ReportField("units", "Units", "number", units),
        ReportField("restocked", "Restocked", "number", restocked),
    ]


def _purchase_orders_query(db: Session, user, search: str | None):
    query = db.query(PurchaseOrder).filter(PurchaseOrder.tenant_id == user.tenant_id, PurchaseOrder.deleted_at.is_(None))
    return query.filter(or_(PurchaseOrder.number.ilike(f"%{search}%"), PurchaseOrder.vendor_reference.ilike(f"%{search}%"))) if search else query


def _purchase_order_fields(db: Session, user) -> list[ReportField]:
    vendor = select(SalesOrganization.org_name).where(SalesOrganization.org_id == PurchaseOrder.vendor_id, SalesOrganization.tenant_id == PurchaseOrder.tenant_id).scalar_subquery()
    warehouse_name = select(InventoryWarehouse.name).where(InventoryWarehouse.id == PurchaseOrder.warehouse_id, InventoryWarehouse.tenant_id == PurchaseOrder.tenant_id).scalar_subquery()
    return [
        ReportField("number", "Number", "text", PurchaseOrder.number, groupable=False),
        ReportField("status", "Status", "select", PurchaseOrder.status, labels="humanize"),
        ReportField("receipt_status", "Received", "select", PurchaseOrder.receipt_status, labels="humanize"),
        ReportField("vendor", "Vendor", "text", vendor),
        ReportField("warehouse", "Warehouse", "text", warehouse_name),
        ReportField("currency", "Currency", "text", PurchaseOrder.currency),
        ReportField("subtotal", "Total", "number", PurchaseOrder.subtotal),
        ReportField("expected_date", "Expected", "date", PurchaseOrder.expected_date),
        ReportField("ordered_at", "Ordered", "datetime", PurchaseOrder.ordered_at),
    ]


def _purchase_lines_query(db: Session, user, search: str | None):
    """Lines of placed purchase orders that still have something to receive."""
    received = select(func.coalesce(func.sum(PurchaseReceiptLine.quantity), 0)).join(PurchaseReceipt, PurchaseReceipt.id == PurchaseReceiptLine.receipt_id).where(
        PurchaseReceiptLine.order_line_id == PurchaseOrderLine.id, PurchaseReceipt.status == "posted").scalar_subquery()
    query = db.query(PurchaseOrderLine).join(PurchaseOrder, and_(PurchaseOrder.id == PurchaseOrderLine.order_id, PurchaseOrder.tenant_id == PurchaseOrderLine.tenant_id)).filter(
        PurchaseOrderLine.tenant_id == user.tenant_id, PurchaseOrder.status == "ordered", PurchaseOrder.deleted_at.is_(None), PurchaseOrderLine.quantity > received)
    if search:
        query = query.join(CatalogProduct, CatalogProduct.id == PurchaseOrderLine.product_id).filter(or_(
            CatalogProduct.name.ilike(f"%{search}%"), CatalogProduct.sku.ilike(f"%{search}%"), PurchaseOrder.number.ilike(f"%{search}%")))
    return query


def _purchase_line_fields(db: Session, user) -> list[ReportField]:
    received = select(func.coalesce(func.sum(PurchaseReceiptLine.quantity), 0)).join(PurchaseReceipt, PurchaseReceipt.id == PurchaseReceiptLine.receipt_id).where(
        PurchaseReceiptLine.order_line_id == PurchaseOrderLine.id, PurchaseReceipt.status == "posted").scalar_subquery()
    product = select(CatalogProduct.name).where(CatalogProduct.id == PurchaseOrderLine.product_id, CatalogProduct.tenant_id == PurchaseOrderLine.tenant_id).scalar_subquery()
    sku = select(CatalogProduct.sku).where(CatalogProduct.id == PurchaseOrderLine.product_id, CatalogProduct.tenant_id == PurchaseOrderLine.tenant_id).scalar_subquery()
    number = select(PurchaseOrder.number).where(PurchaseOrder.id == PurchaseOrderLine.order_id).scalar_subquery()
    expected = select(PurchaseOrder.expected_date).where(PurchaseOrder.id == PurchaseOrderLine.order_id).scalar_subquery()
    vendor = select(SalesOrganization.org_name).join(PurchaseOrder, PurchaseOrder.vendor_id == SalesOrganization.org_id).where(PurchaseOrder.id == PurchaseOrderLine.order_id).scalar_subquery()
    return [
        ReportField("product", "Product", "text", product),
        ReportField("sku", "SKU", "text", sku),
        ReportField("order", "Purchase order", "text", number),
        ReportField("vendor", "Vendor", "text", vendor),
        ReportField("expected_date", "Expected", "date", expected),
        ReportField("ordered", "Ordered", "number", PurchaseOrderLine.quantity),
        ReportField("received", "Received", "number", received),
        ReportField("to_receive", "To receive", "number", PurchaseOrderLine.quantity - received),
        ReportField("unit_cost", "Unit cost", "number", PurchaseOrderLine.unit_cost),
    ]



# E5 invoicing and bills (12c-erp-invoicing.md §3.6) -------------------------------------------

def _finance_scope_user(db: Session, user) -> int | None:
    return get_finance_user_scope(db, user).user_id_filter


def _invoices_query(db: Session, user, search: str | None):
    query = db.query(FinancePosInvoice).filter(FinancePosInvoice.tenant_id == user.tenant_id, FinancePosInvoice.deleted_at.is_(None))
    scoped = _finance_scope_user(db, user)
    if scoped is not None:
        query = query.filter(FinancePosInvoice.user_id == scoped)
    return query.filter(or_(FinancePosInvoice.invoice_number.ilike(f"%{search}%"), FinancePosInvoice.customer_name.ilike(f"%{search}%"))) if search else query


def _overdue_expression(status_column, balance_column, due_column):
    return case((and_(status_column.in_(["issued", "posted"]), balance_column > 0, due_column < func.current_date()), True), else_=False)


def _invoice_fields(db: Session, user) -> list[ReportField]:
    return [
        ReportField("invoice_number", "Number", "text", FinancePosInvoice.invoice_number, groupable=False),
        ReportField("customer_name", "Customer", "text", FinancePosInvoice.customer_name),
        ReportField("customer_organization_id", "Account", "reference", FinancePosInvoice.customer_organization_id, labels="organization"),
        ReportField("status", "Status", "select", FinancePosInvoice.status, labels="humanize"),
        ReportField("payment_status", "Payment", "select", FinancePosInvoice.payment_status, labels="humanize"),
        ReportField("overdue", "Overdue", "boolean", _overdue_expression(FinancePosInvoice.status, FinancePosInvoice.balance_due, FinancePosInvoice.due_date)),
        ReportField("source", "Source", "select", FinancePosInvoice.source, labels="humanize"),
        ReportField("user_id", "Raised by", "user", FinancePosInvoice.user_id, labels="user"),
        ReportField("currency", "Currency", "text", FinancePosInvoice.currency),
        ReportField("issue_date", "Issue date", "date", FinancePosInvoice.issue_date),
        ReportField("due_date", "Due date", "date", FinancePosInvoice.due_date),
        ReportField("total_amount", "Total", "money", FinancePosInvoice.total_amount),
        ReportField("amount_paid", "Paid", "money", FinancePosInvoice.amount_paid),
        ReportField("amount_credited", "Credited", "money", FinancePosInvoice.amount_credited),
        ReportField("balance_due", "Balance due", "money", FinancePosInvoice.balance_due),
    ]


def _invoice_lines_query(db: Session, user, search: str | None):
    query = db.query(FinancePosInvoiceLine).join(FinancePosInvoice, FinancePosInvoice.id == FinancePosInvoiceLine.invoice_id).filter(
        FinancePosInvoice.tenant_id == user.tenant_id, FinancePosInvoice.deleted_at.is_(None), FinancePosInvoice.status == "issued")
    scoped = _finance_scope_user(db, user)
    if scoped is not None:
        query = query.filter(FinancePosInvoice.user_id == scoped)
    return query.filter(FinancePosInvoiceLine.description.ilike(f"%{search}%")) if search else query


def _invoice_line_fields(db: Session, user) -> list[ReportField]:
    invoice = lambda column: select(column).where(FinancePosInvoice.id == FinancePosInvoiceLine.invoice_id).scalar_subquery()  # noqa: E731
    product = select(CatalogProduct.name).where(CatalogProduct.id == FinancePosInvoiceLine.catalog_product_id).scalar_subquery()
    return [
        ReportField("description", "Description", "text", FinancePosInvoiceLine.description),
        ReportField("product", "Product", "text", product),
        ReportField("invoice", "Invoice", "text", invoice(FinancePosInvoice.invoice_number)),
        ReportField("customer_name", "Customer", "text", invoice(FinancePosInvoice.customer_name)),
        ReportField("issue_date", "Issue date", "date", invoice(FinancePosInvoice.issue_date)),
        ReportField("currency", "Currency", "text", invoice(FinancePosInvoice.currency)),
        ReportField("quantity", "Quantity", "number", FinancePosInvoiceLine.quantity),
        ReportField("unit_price", "Unit price", "money", FinancePosInvoiceLine.unit_price),
        ReportField("discount_amount", "Discount", "money", FinancePosInvoiceLine.discount_amount),
        ReportField("tax_amount", "Tax", "money", FinancePosInvoiceLine.tax_amount),
        ReportField("line_total", "Line total", "money", FinancePosInvoiceLine.line_total),
    ]


def _credit_notes_query(db: Session, user, search: str | None):
    from app.modules.finance.services.credit_note_services import _scoped

    query = _scoped(db.query(FinanceCreditNote).filter(FinanceCreditNote.tenant_id == user.tenant_id, FinanceCreditNote.deleted_at.is_(None)), db, user)
    return query.filter(or_(FinanceCreditNote.number.ilike(f"%{search}%"), FinanceCreditNote.reason.ilike(f"%{search}%"))) if search else query


def _credit_note_fields(db: Session, user) -> list[ReportField]:
    invoice = lambda column: select(column).where(FinancePosInvoice.id == FinanceCreditNote.invoice_id).scalar_subquery()  # noqa: E731
    return [
        ReportField("number", "Number", "text", FinanceCreditNote.number, groupable=False),
        ReportField("status", "Status", "select", FinanceCreditNote.status, labels="humanize"),
        ReportField("invoice", "Invoice", "text", invoice(FinancePosInvoice.invoice_number)),
        ReportField("customer_name", "Customer", "text", invoice(FinancePosInvoice.customer_name)),
        ReportField("reason", "Reason", "text", FinanceCreditNote.reason),
        ReportField("issue_date", "Issue date", "date", FinanceCreditNote.issue_date),
        ReportField("currency", "Currency", "text", FinanceCreditNote.currency),
        ReportField("total_amount", "Total", "money", FinanceCreditNote.total_amount),
        ReportField("refund_due", "Refund due", "money", FinanceCreditNote.refund_due),
    ]


def _payments_query(db: Session, user, search: str | None):
    from app.modules.finance.services.payment_services import _scoped

    query = _scoped(db.query(FinancePayment).filter(FinancePayment.tenant_id == user.tenant_id), db, user)
    return query.filter(or_(FinancePayment.number.ilike(f"%{search}%"), FinancePayment.party_name.ilike(f"%{search}%"),
                            FinancePayment.reference.ilike(f"%{search}%"))) if search else query


def _payment_fields(db: Session, user) -> list[ReportField]:
    return [
        ReportField("number", "Number", "text", FinancePayment.number, groupable=False),
        ReportField("direction", "Direction", "select", FinancePayment.direction, labels="humanize"),
        ReportField("kind", "Kind", "select", FinancePayment.kind, labels="humanize"),
        ReportField("status", "Status", "select", FinancePayment.status, labels="humanize"),
        ReportField("party_name", "Customer or vendor", "text", FinancePayment.party_name),
        ReportField("method", "Method", "text", FinancePayment.method),
        ReportField("paid_on", "Paid on", "date", FinancePayment.paid_on),
        ReportField("currency", "Currency", "text", FinancePayment.currency),
        ReportField("amount", "Amount", "money", FinancePayment.amount),
        ReportField("created_by", "Recorded by", "user", FinancePayment.created_by, labels="user"),
    ]


def _bills_query(db: Session, user, search: str | None):
    query = db.query(PurchaseBill).filter(PurchaseBill.tenant_id == user.tenant_id, PurchaseBill.deleted_at.is_(None))
    return query.filter(or_(PurchaseBill.number.ilike(f"%{search}%"), PurchaseBill.vendor_invoice_number.ilike(f"%{search}%"))) if search else query


def _bill_fields(db: Session, user) -> list[ReportField]:
    vendor = select(SalesOrganization.org_name).where(SalesOrganization.org_id == PurchaseBill.vendor_id, SalesOrganization.tenant_id == PurchaseBill.tenant_id).scalar_subquery()
    return [
        ReportField("number", "Number", "text", PurchaseBill.number, groupable=False),
        ReportField("vendor_invoice_number", "Vendor invoice", "text", PurchaseBill.vendor_invoice_number, groupable=False),
        ReportField("vendor", "Vendor", "text", vendor),
        ReportField("status", "Status", "select", PurchaseBill.status, labels="humanize"),
        ReportField("payment_status", "Payment", "select", PurchaseBill.payment_status, labels="humanize"),
        ReportField("match_status", "Matching", "select", PurchaseBill.match_status, labels="humanize"),
        ReportField("overdue", "Overdue", "boolean", _overdue_expression(PurchaseBill.status, PurchaseBill.balance_due, PurchaseBill.due_date)),
        ReportField("currency", "Currency", "text", PurchaseBill.currency),
        ReportField("bill_date", "Bill date", "date", PurchaseBill.bill_date),
        ReportField("due_date", "Due date", "date", PurchaseBill.due_date),
        ReportField("total", "Total", "money", PurchaseBill.total),
        ReportField("balance_due", "Balance due", "money", PurchaseBill.balance_due),
    ]

BUILT_IN_SOURCES: dict[str, ReportSource] = {
    "inventory_deliveries": ReportSource(
        "inventory_deliveries", "Deliveries", InventoryDelivery, InventoryDelivery.id, lambda db: InventoryDelivery.number,
        _deliveries_query, _delivery_fields, "/dashboard/inventory/deliveries/{id}",
        ("status", "order", "warehouse", "shipped_on", "units"), default_date_field="shipped_on", label_field="number"),
    "inventory_backorders": ReportSource(
        "inventory_backorders", "Order lines to deliver", SalesOrderItem, SalesOrderItem.id,
        lambda db: select(CatalogProduct.name).where(CatalogProduct.id == SalesOrderItem.catalog_product_id, CatalogProduct.tenant_id == SalesOrderItem.tenant_id).scalar_subquery(),
        _backorder_query, _backorder_fields, None, ("order", "delivery_date", "ordered", "delivered", "to_deliver", "waiting"),
        label_field="product", permission_module_key="sales_orders"),
    "purchase_orders": ReportSource(
        "purchase_orders", "Purchase orders", PurchaseOrder, PurchaseOrder.id, lambda db: PurchaseOrder.number,
        _purchase_orders_query, _purchase_order_fields, "/dashboard/purchasing/orders/{id}",
        ("status", "vendor", "warehouse", "subtotal", "expected_date"), default_date_field="ordered_at", label_field="number"),
    "purchase_lines": ReportSource(
        "purchase_lines", "Purchase lines to receive", PurchaseOrderLine, PurchaseOrderLine.id,
        lambda db: select(CatalogProduct.name).where(CatalogProduct.id == PurchaseOrderLine.product_id).scalar_subquery(),
        _purchase_lines_query, _purchase_line_fields, None, ("order", "vendor", "expected_date", "ordered", "received", "to_receive"),
        label_field="product", permission_module_key="purchase_orders"),
    "finance_pos": ReportSource(
        "finance_pos", "Invoices", FinancePosInvoice, FinancePosInvoice.id, lambda db: FinancePosInvoice.invoice_number,
        _invoices_query, _invoice_fields, "/dashboard/finance/pos/{id}",
        ("customer_name", "status", "payment_status", "due_date", "total_amount", "balance_due"), default_date_field="issue_date",
        label_field="invoice_number"),
    "finance_invoice_lines": ReportSource(
        "finance_invoice_lines", "Invoice lines", FinancePosInvoiceLine, FinancePosInvoiceLine.id, lambda db: FinancePosInvoiceLine.description,
        _invoice_lines_query, _invoice_line_fields, None, ("invoice", "customer_name", "issue_date", "quantity", "line_total"),
        default_date_field="issue_date", label_field="description", permission_module_key="finance_pos"),
    "finance_credit_notes": ReportSource(
        "finance_credit_notes", "Credit notes", FinanceCreditNote, FinanceCreditNote.id, lambda db: FinanceCreditNote.number,
        _credit_notes_query, _credit_note_fields, "/dashboard/finance/credit-notes/{id}",
        ("status", "invoice", "customer_name", "reason", "total_amount", "refund_due"), default_date_field="issue_date", label_field="number"),
    "finance_payments": ReportSource(
        "finance_payments", "Payments", FinancePayment, FinancePayment.id, lambda db: FinancePayment.number,
        _payments_query, _payment_fields, "/dashboard/finance/payments/{id}",
        ("direction", "party_name", "method", "paid_on", "amount"), default_date_field="paid_on", label_field="number"),
    "purchase_bills": ReportSource(
        "purchase_bills", "Bills", PurchaseBill, PurchaseBill.id, lambda db: PurchaseBill.number,
        _bills_query, _bill_fields, "/dashboard/purchasing/bills/{id}",
        ("vendor", "vendor_invoice_number", "status", "due_date", "total", "balance_due"), default_date_field="bill_date", label_field="number"),
    "inventory_returns": ReportSource(
        "inventory_returns", "Returns", InventoryReturn, InventoryReturn.id, lambda db: InventoryReturn.number,
        _returns_query, _return_fields, "/dashboard/inventory/returns/{id}",
        ("status", "reason", "order", "received_at", "units", "restocked"), default_date_field="received_at", label_field="number"),
    "inventory_stock": ReportSource(
        "inventory_stock", "Stock levels", InventoryStockLevel, InventoryStockLevel.id,
        lambda db: select(CatalogProduct.name).where(CatalogProduct.id == InventoryStockLevel.product_id, CatalogProduct.tenant_id == InventoryStockLevel.tenant_id).scalar_subquery(), _inventory_levels_query, _inventory_level_fields,
        None, ("sku", "warehouse", "on_hand", "available", "reorder_point", "stock_health"), label_field="product"),
    "inventory_valuation": ReportSource(
        "inventory_valuation", "Stock valuation", CatalogProduct, CatalogProduct.id, lambda db: CatalogProduct.name,
        _valuation_query, _valuation_fields, "/dashboard/catalog/products/{id}?tab=stock",
        ("sku", "category", "on_hand", "average_cost", "stock_value"), label_field="product"),
    "inventory_cogs": ReportSource(
        "inventory_cogs", "Cost of goods sold", InventoryStockMove, InventoryStockMove.id,
        lambda db: select(CatalogProduct.name).where(CatalogProduct.id == InventoryStockMove.product_id).scalar_subquery(),
        _cogs_query, _cogs_fields, None, ("customer", "order", "occurred_at", "units", "cost_of_goods"),
        default_date_field="occurred_at", label_field="product", permission_module_key="inventory_valuation"),
    "inventory_sales_margin": ReportSource(
        "inventory_sales_margin", "Sales margin", SalesOrderItem, SalesOrderItem.id,
        lambda db: select(CatalogProduct.name).where(CatalogProduct.id == SalesOrderItem.catalog_product_id).scalar_subquery(),
        _margin_query, _margin_fields, None, ("order", "customer", "sold", "revenue", "cost_of_goods", "margin"),
        default_date_field="order_date", label_field="product", permission_module_key="inventory_valuation"),
    "inventory_revaluations": ReportSource(
        "inventory_revaluations", "Revaluations", InventoryRevaluation, InventoryRevaluation.id, lambda db: InventoryRevaluation.number,
        _revaluations_query, _revaluation_fields, None, ("product", "kind", "created_at", "stock_change", "cogs_change"),
        default_date_field="created_at", label_field="number", permission_module_key="inventory_valuation"),
    "inventory_movements": ReportSource(
        "inventory_movements", "Stock movements", InventoryStockMove, InventoryStockMove.id,
        lambda db: select(CatalogProduct.name).where(CatalogProduct.id == InventoryStockMove.product_id, CatalogProduct.tenant_id == InventoryStockMove.tenant_id).scalar_subquery(), _inventory_moves_query, _inventory_move_fields,
        None, ("warehouse", "move_type", "quantity", "on_hand_after", "occurred_at"),
        default_date_field="occurred_at", label_field="product", permission_module_key="inventory_stock"),
    "sales_leads": ReportSource(
        "sales_leads", "Leads", SalesLead, SalesLead.lead_id,
        lambda db: _full_name(SalesLead.first_name, SalesLead.last_name),
        lambda db, user, search: leads_repository.build_leads_query(db, tenant_id=user.tenant_id, search=search, all_filter_conditions=[], any_filter_conditions=[]),
        _lead_fields, "/dashboard/sales/leads/{id}",
        ("name", "company", "status", "assigned_to", "created_time"),
        default_date_field="created_time", scope_clause=_owner_scope(SalesLead.assigned_to),
        label_field="name",
    ),
    "sales_contacts": ReportSource(
        "sales_contacts", "Contacts", SalesContact, SalesContact.contact_id,
        lambda db: _full_name(SalesContact.first_name, SalesContact.last_name),
        lambda db, user, search: contacts_repository.build_contacts_query(db, tenant_id=user.tenant_id, search=search, all_filter_conditions=[], any_filter_conditions=[]),
        _contact_fields, "/dashboard/sales/contacts/{id}",
        ("name", "organization_id", "primary_email", "assigned_to", "created_time"),
        default_date_field="created_time", scope_clause=_owner_scope(SalesContact.assigned_to),
        aliases={"organization_name": "organization_id"},
        label_field="name",
    ),
    "sales_organizations": ReportSource(
        "sales_organizations", "Accounts", SalesOrganization, SalesOrganization.org_id,
        lambda db: SalesOrganization.org_name,
        lambda db, user, search: organizations_repository.build_organization_query(db, tenant_id=user.tenant_id, search=search, all_filter_conditions=[], any_filter_conditions=[]),
        _organization_fields, "/dashboard/sales/organizations/{id}",
        ("org_name", "industry", "billing_country", "assigned_to", "created_time"),
        default_date_field="created_time", scope_clause=_owner_scope(SalesOrganization.assigned_to),
        label_field="org_name",
    ),
    "sales_opportunities": ReportSource(
        "sales_opportunities", "Deals", SalesOpportunity, SalesOpportunity.opportunity_id,
        lambda db: SalesOpportunity.opportunity_name,
        lambda db, user, search: opportunities_repository.build_opportunity_query(db, tenant_id=user.tenant_id, search=search, all_filter_conditions=[], any_filter_conditions=[]),
        _opportunity_fields, "/dashboard/sales/opportunities/{id}",
        ("opportunity_name", "organization_id", "sales_stage", "amount", "expected_close_date", "assigned_to"),
        default_date_field="expected_close_date", scope_clause=_owner_scope(SalesOpportunity.assigned_to),
        label_field="opportunity_name",
    ),
    "sales_quotes": ReportSource(
        "sales_quotes", "Quotes", SalesQuote, SalesQuote.quote_id,
        lambda db: func.coalesce(SalesQuote.quote_number, SalesQuote.title),
        lambda db, user, search: quotes_repository.build_quotes_query(db, tenant_id=user.tenant_id, search=search, all_filter_conditions=[], any_filter_conditions=[]),
        _quote_fields, "/dashboard/sales/quotes/{id}",
        ("quote_number", "customer_name", "status", "total_amount", "issue_date", "assigned_to"),
        default_date_field="issue_date", scope_clause=_owner_scope(SalesQuote.assigned_to),
        label_field="quote_number",
    ),
    "tasks": ReportSource(
        "tasks", "Tasks", Task, Task.id,
        lambda db: Task.title,
        lambda db, user, search: tasks_repository.build_task_query(db, tenant_id=user.tenant_id, current_user=user, search=search, all_filter_conditions=[], any_filter_conditions=[]),
        _task_fields, None,
        ("title", "status", "priority", "due_at", "source_module_key"),
        default_date_field="due_at", scope_clause=_task_scope,
        label_field="title",
    ),
    "finance_io": ReportSource(
        "finance_io", "Insertion orders", FinanceIO, FinanceIO.id,
        lambda db: func.coalesce(FinanceIO.io_number, FinanceIO.customer_name),
        _finance_base_query,
        _finance_fields, "/dashboard/finance/insertion-orders/{id}",
        ("io_number", "customer_name", "status", "total_amount", "issue_date"),
        default_date_field="issue_date", scope_clause=_owner_scope(FinanceIO.user_id),
        label_field="io_number",
    ),
}


# ---------------------------------------------------------------------- custom modules


def _custom_module_field(field, definition: CustomModuleDefinition) -> ReportField | None:
    if field.field_type == "single_select":
        value_column, field_type = CustomModuleRecordValue.text_value, "select"
    elif field.field_type in custom_modules.TEXT_TYPES:
        value_column, field_type = CustomModuleRecordValue.text_value, "text"
    elif field.field_type in custom_modules.NUMBER_TYPES:
        value_column = CustomModuleRecordValue.number_value
        field_type = "money" if field.field_type == "currency" else "number"
    elif field.field_type in custom_modules.DATE_TYPES:
        value_column, field_type = cast(CustomModuleRecordValue.datetime_value, Date), "date"
    elif field.field_type == "boolean":
        value_column, field_type = CustomModuleRecordValue.boolean_value, "boolean"
    else:
        return None
    expression = (
        select(value_column)
        .where(
            CustomModuleRecordValue.tenant_id == definition.tenant_id,
            CustomModuleRecordValue.custom_module_id == definition.id,
            CustomModuleRecordValue.record_id == CustomModuleRecord.id,
            CustomModuleRecordValue.field_id == field.id,
        )
        .limit(1)
        .scalar_subquery()
    )
    groupable = field.field_type not in {"textarea", "email", "phone", "url"}
    return ReportField(field.key, field.label, field_type, expression, groupable=groupable)


def _custom_source(db: Session, current_user, module_key: str) -> tuple[ReportSource, list[ReportField]]:
    definition = custom_modules._get_module_definition(db, tenant_id=current_user.tenant_id, key=module_key)
    custom_modules._require_module_action(db, user=current_user, definition=definition, action="view")
    fields = [
        ReportField("title", "Title", "text", CustomModuleRecord.title, groupable=False),
        ReportField("created_by_user_id", "Created by", "user", CustomModuleRecord.created_by_user_id, labels="user"),
        ReportField("created_at", "Created", "datetime", CustomModuleRecord.created_at),
        ReportField("updated_at", "Updated", "datetime", CustomModuleRecord.updated_at),
    ]
    for item in sorted((f for f in definition.fields if f.deleted_at is None and f.is_active), key=lambda f: (f.sort_order, f.id)):
        report_field = _custom_module_field(item, definition)
        if report_field:
            fields.append(report_field)
    fields = _enabled(db, tenant_id=current_user.tenant_id, module_key=module_key, fields=fields)

    def base_query(db: Session, user, search: str | None):
        query = db.query(CustomModuleRecord).filter(
            CustomModuleRecord.tenant_id == user.tenant_id,
            CustomModuleRecord.custom_module_id == definition.id,
            CustomModuleRecord.deleted_at.is_(None),
        )
        if search and search.strip():
            pattern = f"%{search.strip()}%"
            query = (
                query.outerjoin(CustomModuleRecordValue, CustomModuleRecordValue.record_id == CustomModuleRecord.id)
                .filter(or_(CustomModuleRecord.title.ilike(pattern), CustomModuleRecordValue.text_value.ilike(pattern)))
            )
        return query

    source = ReportSource(
        module_key, definition.name, CustomModuleRecord, CustomModuleRecord.id,
        lambda db: CustomModuleRecord.title,
        base_query,
        lambda db, user: fields,
        f"/dashboard/custom/{module_key}/{{id}}",
        tuple(item.key for item in fields[:5]),
        default_date_field="created_at",
        scope_clause=_owner_scope(CustomModuleRecord.created_by_user_id),
        label_field="title",
    )
    return source, fields


# ---------------------------------------------------------------------------- access


def _require_view(db: Session, current_user, module_key: str) -> None:
    try:
        require_role_module_action_access(db, user=current_user, module_key=module_key, action="view")
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


def resolve_source(db: Session, current_user, module_key: str) -> tuple[ReportSource, list[ReportField]]:
    """The source and its fields, after checking the viewer may view the module."""
    source = BUILT_IN_SOURCES.get(module_key)
    if source:
        _require_view(db, current_user, source.permission_module_key or module_key)
        return source, source.fields(db, current_user)
    return _custom_source(db, current_user, module_key)


def can_view_module(db: Session, current_user, module_key: str) -> bool:
    try:
        resolve_source(db, current_user, module_key)
        return True
    except HTTPException:
        return False


def list_sources(db: Session, current_user) -> list[tuple[ReportSource, list[ReportField]]]:
    results: list[tuple[ReportSource, list[ReportField]]] = []
    for module_key, source in BUILT_IN_SOURCES.items():
        try:
            _require_view(db, current_user, source.permission_module_key or module_key)
        except (PermissionError, ValueError):
            continue
        results.append((source, source.fields(db, current_user)))
    definitions = (
        db.query(CustomModuleDefinition)
        .filter(
            CustomModuleDefinition.tenant_id == current_user.tenant_id,
            CustomModuleDefinition.is_active.is_(True),
            CustomModuleDefinition.deleted_at.is_(None),
        )
        .order_by(CustomModuleDefinition.name.asc())
        .all()
    )
    for definition in definitions:
        try:
            results.append(_custom_source(db, current_user, definition.key))
        except HTTPException:
            continue
    return [(source, fields) for source, fields in results if any(item.can_group for item in fields)]


def field_options(db: Session, tenant_id: int, item: ReportField) -> list[dict[str, str]] | None:
    """Choices for a filter on a field whose values are a short, known list."""
    if item.labels == "stage":
        labels, ranks = stage_order(db, tenant_id)
        return [{"value": key, "label": labels[key]} for key in sorted(ranks, key=ranks.get)]
    if item.labels == "pipeline":
        rows = db.query(SalesPipeline.id, SalesPipeline.name).filter(SalesPipeline.tenant_id == tenant_id).order_by(SalesPipeline.name)
        return [{"value": str(pid), "label": name or f"Pipeline {pid}"} for pid, name in rows]
    return None


def source_payload(source: ReportSource, fields: list[ReportField], db: Session | None = None, tenant_id: int | None = None) -> dict[str, Any]:
    dimensions = [item for item in fields if item.can_group]
    field_payloads = []
    for item in fields:
        payload = item.payload()
        if item.labels:
            payload["reference"] = item.labels
        options = field_options(db, tenant_id, item) if db is not None and tenant_id is not None else None
        if options is not None:
            payload["options"] = options
        field_payloads.append(payload)
    return {
        "module_key": source.module_key,
        "label": source.label,
        "fields": field_payloads,
        "default_date_field": source.default_date_field if any(item.key == source.default_date_field for item in fields) else None,
        "default_columns": [key for key in source.default_columns if any(item.key == key for item in fields)],
        "supports_scope": source.scope_clause is not None,
        "has_record_pages": source.record_path is not None,
        # The version 1 shape, still read by anything built against it.
        "dimensions": [legacy_field_payload(item) for item in dimensions],
        "metrics": [legacy_field_payload(item) for item in fields if item.can_measure],
        "filter_fields": [legacy_field_payload(item) for item in fields],
        "default_dimension": dimensions[0].key if dimensions else None,
    }


def legacy_field_payload(item: ReportField) -> dict[str, str]:
    legacy_type = {"money": "number", "datetime": "date", "user": "text", "reference": "text"}.get(item.field_type, item.field_type)
    return {"key": item.key, "label": item.label, "field_type": legacy_type}


# ---------------------------------------------------------------------------- labels

EMPTY_KEY = "__empty__"
_KEYLIKE = re.compile(r"^[a-z0-9]+(?:[_-][a-z0-9]+)*$")


def humanize(value: str) -> str:
    """`closed_won` → `Closed won`. Free text a person typed is left exactly as typed."""
    if not _KEYLIKE.match(value):
        return value
    words = value.replace("-", " ").replace("_", " ")
    return words[:1].upper() + words[1:]


def _int_keys(keys: set[str]) -> set[int]:
    result: set[int] = set()
    for key in keys:
        try:
            result.add(int(key))
        except (TypeError, ValueError):
            continue
    return result


def _user_labels(db: Session, tenant_id: int, keys: set[str]) -> dict[str, str]:
    ids = _int_keys(keys)
    if not ids:
        return {}
    labels = {}
    for user in db.query(User).filter(User.tenant_id == tenant_id, User.id.in_(ids)).all():
        full_name = " ".join(part for part in [user.first_name, user.last_name] if part).strip()
        labels[str(user.id)] = full_name or user.email or f"User {user.id}"
    return labels


def _team_labels(db: Session, tenant_id: int, keys: set[str]) -> dict[str, str]:
    ids = _int_keys(keys)
    if not ids:
        return {}
    return {str(team.id): team.name or f"Team {team.id}" for team in db.query(Team).filter(Team.tenant_id == tenant_id, Team.id.in_(ids)).all()}


def _organization_labels(db: Session, tenant_id: int, keys: set[str]) -> dict[str, str]:
    ids = _int_keys(keys)
    if not ids:
        return {}
    rows = db.query(SalesOrganization.org_id, SalesOrganization.org_name).filter(
        SalesOrganization.tenant_id == tenant_id, SalesOrganization.org_id.in_(ids)
    )
    return {str(org_id): name or f"Account {org_id}" for org_id, name in rows}


def _contact_labels(db: Session, tenant_id: int, keys: set[str]) -> dict[str, str]:
    ids = _int_keys(keys)
    if not ids:
        return {}
    rows = db.query(SalesContact.contact_id, SalesContact.first_name, SalesContact.last_name).filter(
        SalesContact.tenant_id == tenant_id, SalesContact.contact_id.in_(ids)
    )
    return {str(cid): " ".join(p for p in [first, last] if p).strip() or f"Contact {cid}" for cid, first, last in rows}


def _pipeline_labels(db: Session, tenant_id: int, keys: set[str]) -> dict[str, str]:
    ids = _int_keys(keys)
    if not ids:
        return {}
    rows = db.query(SalesPipeline.id, SalesPipeline.name).filter(SalesPipeline.tenant_id == tenant_id, SalesPipeline.id.in_(ids))
    return {str(pid): name or f"Pipeline {pid}" for pid, name in rows}


def stage_order(db: Session, tenant_id: int) -> tuple[dict[str, str], dict[str, int]]:
    """Stage key → label and → rank: the default pipeline's order first, then the others."""
    rows = (
        db.query(SalesPipelineStage.key, SalesPipelineStage.label, SalesPipelineStage.position, SalesPipeline.is_default)
        .join(SalesPipeline, SalesPipeline.id == SalesPipelineStage.pipeline_id)
        .filter(SalesPipelineStage.tenant_id == tenant_id, SalesPipeline.tenant_id == tenant_id)
        .order_by(SalesPipeline.is_default.desc(), SalesPipeline.id.asc(), SalesPipelineStage.position.asc())
        .all()
    )
    labels: dict[str, str] = {}
    ranks: dict[str, int] = {}
    for key, label, _position, _is_default in rows:
        if key not in labels:
            labels[key] = label or humanize(key)
            ranks[key] = len(ranks)
    return labels, ranks


def _stage_labels(db: Session, tenant_id: int, keys: set[str]) -> dict[str, str]:
    labels, _ranks = stage_order(db, tenant_id)
    return {key: labels.get(key) or humanize(key) for key in keys}


def _module_labels(db: Session, tenant_id: int, keys: set[str]) -> dict[str, str]:
    return {key: BUILT_IN_SOURCES[key].label if key in BUILT_IN_SOURCES else humanize(key) for key in keys}


def _humanized(db: Session, tenant_id: int, keys: set[str]) -> dict[str, str]:
    return {key: humanize(key) for key in keys}


LABEL_RESOLVERS: dict[str, Callable[[Session, int, set[str]], dict[str, str]]] = {
    "user": _user_labels,
    "team": _team_labels,
    "organization": _organization_labels,
    "contact": _contact_labels,
    "pipeline": _pipeline_labels,
    "stage": _stage_labels,
    "module": _module_labels,
    "humanize": _humanized,
}


def resolve_labels(db: Session, tenant_id: int, item: ReportField, keys: set[str]) -> dict[str, str]:
    present = {key for key in keys if key != EMPTY_KEY}
    resolver = LABEL_RESOLVERS.get(item.labels or "")
    labels = resolver(db, tenant_id, present) if resolver and present else {}
    if item.field_type == "user":
        empty = "Unassigned"
    elif item.field_type == "boolean":
        labels.update({"true": "Yes", "false": "No"})
        empty = "No value"
    else:
        empty = "No value"
    resolved = {key: labels.get(key, key) for key in present}
    if EMPTY_KEY in keys:
        resolved[EMPTY_KEY] = empty
    return resolved


def field_rank(db: Session, tenant_id: int, item: ReportField) -> dict[str, int] | None:
    """A natural order for a field's groups, where one exists (pipeline stages)."""
    if item.labels == "stage":
        return stage_order(db, tenant_id)[1]
    return None
