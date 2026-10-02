"""Ready-made reports, grouped by the question they answer (HubSpot's report library).

Each is a version 2 definition (`11-reports.md` §4.2). `list_report_templates` drops the
ones whose module the viewer cannot report on and normalizes the rest against the viewer's
fields, so a template never offers a field the tenant has turned off.
"""

from __future__ import annotations

from typing import Any


def _summary(groupings: list[dict], measures: list[dict] | None = None, **extra: Any) -> dict[str, Any]:
    return {
        "version": 2,
        "format": "summary",
        "groupings": groupings,
        "measures": measures or [{"aggregate": "count"}],
        "scope": extra.pop("scope", "all"),
        "date_filter": extra.pop("date_filter", None),
        "filters": extra.pop("filters", {}),
        "chart": {"type": extra.pop("chart", "column")},
        "sort": {"by": "value", "direction": "desc"},
        **extra,
    }


def _open_tasks() -> dict[str, Any]:
    return {"all_conditions": [{"id": "open", "field": "status", "operator": "is_not", "value": "completed"}], "any_conditions": []}


REPORT_TEMPLATES: list[dict[str, Any]] = [
    {
        "key": "stock-on-hand-by-warehouse", "category": "Inventory", "name": "Stock on hand by warehouse",
        "description": "On hand units in each warehouse.", "module_key": "inventory_stock",
        "config": _summary([{"field": "warehouse"}], [{"aggregate": "sum", "field": "on_hand"}]),
    },
    {
        "key": "low-stock", "category": "Inventory", "name": "Low stock",
        "description": "Products at or below their reorder point.", "module_key": "inventory_stock",
        "config": {"version": 2, "format": "tabular", "groupings": [], "measures": [], "scope": "all",
            "date_filter": None, "filters": {"all_conditions": [{"id": "low", "field": "low_stock", "operator": "is", "value": True}], "any_conditions": []},
            "columns": ["sku", "warehouse", "on_hand", "available", "reorder_point"]},
    },
    {
        "key": "stock-movements-by-type-month", "category": "Inventory", "name": "Movements by type this month",
        "description": "Stock changes grouped by movement type this month.", "module_key": "inventory_movements",
        "config": _summary([{"field": "move_type"}], [{"aggregate": "sum", "field": "quantity"}],
            date_filter={"field": "occurred_at", "range": "this_month"}),
    },
    {
        "key": "backorders-by-product", "category": "Inventory", "name": "Backorders by product",
        "description": "Units confirmed orders still need, by product.", "module_key": "inventory_backorders",
        "config": _summary([{"field": "product"}], [{"aggregate": "sum", "field": "to_deliver"}, {"aggregate": "sum", "field": "waiting"}]),
    },
    {
        "key": "deliveries-this-month", "category": "Inventory", "name": "Deliveries this month",
        "description": "Units shipped this month, by warehouse.", "module_key": "inventory_deliveries",
        "config": _summary([{"field": "warehouse"}], [{"aggregate": "count"}, {"aggregate": "sum", "field": "units"}],
            date_filter={"field": "shipped_on", "range": "this_month"},
            filters={"all_conditions": [{"id": "posted", "field": "status", "operator": "is", "value": "posted"}], "any_conditions": []}),
    },
    {
        "key": "returns-by-reason", "category": "Inventory", "name": "Returns by reason",
        "description": "Received returns grouped by the reason given.", "module_key": "inventory_returns",
        "config": _summary([{"field": "reason"}], [{"aggregate": "count"}, {"aggregate": "sum", "field": "units"}],
            filters={"all_conditions": [{"id": "received", "field": "status", "operator": "is", "value": "received"}], "any_conditions": []}),
    },
    {
        "key": "incoming-by-product", "category": "Purchasing", "name": "Incoming stock by product",
        "description": "Units on placed purchase orders still to arrive, by product.", "module_key": "purchase_lines",
        "config": _summary([{"field": "product"}], [{"aggregate": "sum", "field": "to_receive"}]),
    },
    {
        "key": "spend-by-vendor-month", "category": "Purchasing", "name": "Spend by vendor this month",
        "description": "Purchase orders placed this month, by vendor.", "module_key": "purchase_orders",
        "config": _summary([{"field": "vendor"}], [{"aggregate": "count"}, {"aggregate": "sum", "field": "subtotal"}],
            date_filter={"field": "ordered_at", "range": "this_month"}),
    },
    # E5 (12c-erp-invoicing.md §3.6).
    {
        "key": "overdue-invoices-by-customer", "category": "Finance", "name": "Overdue invoices by customer",
        "description": "What each customer owes past its due date.", "module_key": "finance_pos",
        "config": _summary([{"field": "customer_name"}], [{"aggregate": "count"}, {"aggregate": "sum", "field": "balance_due"}],
            filters={"all_conditions": [{"id": "overdue", "field": "overdue", "operator": "is", "value": True}], "any_conditions": []}),
    },
    {
        "key": "invoiced-this-month", "category": "Finance", "name": "Invoiced this month",
        "description": "Invoices issued this month, by customer.", "module_key": "finance_pos",
        "config": _summary([{"field": "customer_name"}], [{"aggregate": "count"}, {"aggregate": "sum", "field": "total_amount"}],
            date_filter={"field": "issue_date", "range": "this_month"},
            filters={"all_conditions": [{"id": "issued", "field": "status", "operator": "is", "value": "issued"}], "any_conditions": []}),
    },
    {
        "key": "unpaid-invoices-by-due-month", "category": "Finance", "name": "Unpaid invoices by due month",
        "description": "Open balances grouped by the month they fall due.", "module_key": "finance_pos",
        "config": _summary([{"field": "due_date", "granularity": "month"}], [{"aggregate": "count"}, {"aggregate": "sum", "field": "balance_due"}],
            filters={"all_conditions": [{"id": "issued", "field": "status", "operator": "is", "value": "issued"},
                                        {"id": "owing", "field": "balance_due", "operator": "gt", "value": 0}], "any_conditions": []}),
    },
    {
        "key": "bills-due-this-month", "category": "Purchasing", "name": "Bills due this month",
        "description": "Posted vendor bills falling due this month, by vendor.", "module_key": "purchase_bills",
        "config": _summary([{"field": "vendor"}], [{"aggregate": "count"}, {"aggregate": "sum", "field": "balance_due"}],
            date_filter={"field": "due_date", "range": "this_month"},
            filters={"all_conditions": [{"id": "posted", "field": "status", "operator": "is", "value": "posted"}], "any_conditions": []}),
    },
    {
        "key": "billed-spend-by-vendor", "category": "Purchasing", "name": "Billed spend by vendor",
        "description": "What vendors billed this month.", "module_key": "purchase_bills",
        "config": _summary([{"field": "vendor"}], [{"aggregate": "count"}, {"aggregate": "sum", "field": "total"}],
            date_filter={"field": "bill_date", "range": "this_month"},
            filters={"all_conditions": [{"id": "posted", "field": "status", "operator": "is", "value": "posted"}], "any_conditions": []}),
    },
    {
        "key": "deals-pipeline-by-stage",
        "category": "Pipeline",
        "name": "Pipeline by stage",
        "description": "How many deals sit in each stage, and what they are worth.",
        "module_key": "sales_opportunities",
        "config": _summary(
            [{"field": "sales_stage"}],
            [{"aggregate": "count"}, {"aggregate": "sum", "field": "amount"}],
            chart="funnel",
        ),
    },
    {
        "key": "deals-closing-this-quarter-by-owner",
        "category": "Pipeline",
        "name": "Deals closing this quarter, by owner",
        "description": "Each owner's deals expected to close this quarter, by value.",
        "module_key": "sales_opportunities",
        "config": _summary(
            [{"field": "assigned_to"}],
            [{"aggregate": "sum", "field": "amount"}, {"aggregate": "count"}],
            date_filter={"field": "expected_close_date", "range": "this_quarter"},
            chart="bar",
        ),
    },
    {
        "key": "deals-close-month-by-stage",
        "category": "Pipeline",
        "name": "Deal value by close month and stage",
        "description": "Where this year's pipeline lands, month by month.",
        "module_key": "sales_opportunities",
        "config": {
            **_summary(
                [{"field": "expected_close_date", "granularity": "month"}, {"field": "sales_stage"}],
                [{"aggregate": "sum", "field": "amount"}],
                date_filter={"field": "expected_close_date", "range": "this_year"},
            ),
            "format": "matrix",
        },
    },
    {
        "key": "my-open-deals",
        "category": "Pipeline",
        "name": "My deals",
        "description": "A list of your deals with stage, amount and close date.",
        "module_key": "sales_opportunities",
        "config": {
            "version": 2,
            "format": "tabular",
            "groupings": [],
            "measures": [{"aggregate": "count"}],
            "scope": "mine",
            "filters": {},
            "columns": ["opportunity_name", "organization_id", "sales_stage", "amount", "expected_close_date"],
            "sort": {"by": "expected_close_date", "direction": "asc"},
        },
    },
    {
        "key": "leads-by-source",
        "category": "Leads",
        "name": "Leads by source",
        "description": "Where your leads come from.",
        "module_key": "sales_leads",
        "config": _summary([{"field": "source"}], chart="donut"),
    },
    {
        "key": "new-leads-by-month",
        "category": "Leads",
        "name": "New leads by month",
        "description": "Leads created each month this year.",
        "module_key": "sales_leads",
        "config": _summary(
            [{"field": "created_time", "granularity": "month"}],
            date_filter={"field": "created_time", "range": "this_year"},
            chart="line",
        ),
    },
    {
        "key": "lead-status-by-owner",
        "category": "Leads",
        "name": "Lead status by owner",
        "description": "Each owner's leads, split by status.",
        "module_key": "sales_leads",
        "config": {**_summary([{"field": "assigned_to"}, {"field": "status"}]), "format": "matrix"},
    },
    {
        "key": "accounts-by-industry",
        "category": "Accounts and contacts",
        "name": "Accounts by industry",
        "description": "How your accounts spread across industries.",
        "module_key": "sales_organizations",
        "config": _summary([{"field": "industry"}], chart="bar"),
    },
    {
        "key": "contacts-by-country",
        "category": "Accounts and contacts",
        "name": "Contacts by country",
        "description": "Where your contacts are.",
        "module_key": "sales_contacts",
        "config": _summary([{"field": "country"}], chart="bar"),
    },
    {
        "key": "quote-value-by-status",
        "category": "Quotes",
        "name": "Quote value by status",
        "description": "What is drafted, sent, accepted and lost, by value.",
        "module_key": "sales_quotes",
        "config": _summary(
            [{"field": "status"}],
            [{"aggregate": "sum", "field": "total_amount"}, {"aggregate": "count"}],
        ),
    },
    {
        "key": "quotes-issued-by-month",
        "category": "Quotes",
        "name": "Quotes issued by month",
        "description": "Quote volume and value, month by month, this year.",
        "module_key": "sales_quotes",
        "config": _summary(
            [{"field": "issue_date", "granularity": "month"}],
            [{"aggregate": "count"}, {"aggregate": "sum", "field": "total_amount"}],
            date_filter={"field": "issue_date", "range": "this_year"},
            chart="line",
        ),
    },
    {
        "key": "open-tasks-by-priority",
        "category": "Activity",
        "name": "Open tasks by priority",
        "description": "Work still to do, by priority.",
        "module_key": "tasks",
        "config": _summary([{"field": "priority"}], filters=_open_tasks(), chart="bar"),
    },
    {
        "key": "tasks-due-this-week",
        "category": "Activity",
        "name": "Tasks due this week, by status",
        "description": "This week's tasks and how far along they are.",
        "module_key": "tasks",
        "config": _summary(
            [{"field": "status"}],
            date_filter={"field": "due_at", "range": "this_week"},
            chart="donut",
        ),
    },
]
