from __future__ import annotations

import re

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings


IDENTIFIER_PATTERN = re.compile(r"^[a-z_][a-z0-9_]*$")
PURGE_TARGETS: tuple[tuple[str, str], ...] = (
    ("sales_leads", "lead_id"),
    ("sales_contacts", "contact_id"),
    ("sales_organizations", "org_id"),
    ("sales_opportunities", "opportunity_id"),
    ("sales_quotes", "quote_id"),
    # Draft credit notes before invoices (they point at them); the guard keeps any invoice
    # that a credit note or payment still references.
    ("finance_credit_notes", "id"),
    ("finance_pos_invoices", "id"),
    ("purchase_bills", "id"),
    # Removed inventory drafts go before products: their lines reference products.
    ("inventory_adjustments", "id"),
    ("inventory_transfers", "id"),
    # Receipts before purchase orders, and both before products: lines point at them.
    ("purchase_receipts", "id"),
    ("purchase_orders", "id"),
    # Returns before deliveries: a return's lines point at its delivery's lines.
    ("inventory_returns", "id"),
    ("inventory_deliveries", "id"),
    ("catalog_products", "id"),
    ("catalog_services", "id"),
    ("tasks", "id"),
    ("calendar_events", "id"),
    ("documents", "id"),
    ("custom_module_records", "id"),
)
RECORD_TAG_MODULE_KEYS = {"sales_leads": "sales_leads"}
# The module key a table's records keep their custom field values under (13b §3.4).
FIELD_VALUE_MODULE_KEYS = {
    "sales_leads": "sales_leads", "sales_contacts": "sales_contacts", "sales_organizations": "sales_organizations",
    "sales_opportunities": "sales_opportunities", "sales_quotes": "sales_quotes", "finance_credit_notes": "finance_credit_notes",
    "finance_pos_invoices": "finance_pos", "purchase_bills": "purchase_bills", "inventory_adjustments": "inventory_adjustments",
    "inventory_transfers": "inventory_transfers", "purchase_receipts": "purchase_receipts", "purchase_orders": "purchase_orders",
    "inventory_returns": "inventory_returns", "inventory_deliveries": "inventory_deliveries", "catalog_products": "catalog_products",
    "catalog_services": "catalog_services",
}
# A product with stock history is kept: the ledger is append-only and references it
# (ON DELETE RESTRICT). Without this guard one such product fails every purge run.
PURGE_GUARDS = {
    "catalog_products": """
            AND NOT EXISTS (SELECT 1 FROM inventory_stock_moves m WHERE m.product_id = catalog_products.id)
            AND NOT EXISTS (SELECT 1 FROM inventory_adjustment_lines l WHERE l.product_id = catalog_products.id)
            AND NOT EXISTS (SELECT 1 FROM inventory_transfer_lines l WHERE l.product_id = catalog_products.id)
            AND NOT EXISTS (SELECT 1 FROM inventory_delivery_lines l WHERE l.product_id = catalog_products.id)
            AND NOT EXISTS (SELECT 1 FROM inventory_return_lines l WHERE l.product_id = catalog_products.id)
            AND NOT EXISTS (SELECT 1 FROM purchase_order_lines l WHERE l.product_id = catalog_products.id)""",
    "finance_pos_invoices": """
            AND NOT EXISTS (SELECT 1 FROM finance_credit_notes c WHERE c.invoice_id = finance_pos_invoices.id)
            AND NOT EXISTS (SELECT 1 FROM finance_payment_allocations a WHERE a.invoice_id = finance_pos_invoices.id)""",
    "finance_credit_notes": """
            AND NOT EXISTS (SELECT 1 FROM finance_payment_allocations a WHERE a.credit_note_id = finance_credit_notes.id)""",
    "purchase_bills": """
            AND NOT EXISTS (SELECT 1 FROM finance_payment_allocations a WHERE a.bill_id = purchase_bills.id)""",
    # A removed draft purchase order that a receipt points at stays until the receipt goes.
    "purchase_orders": """
            AND NOT EXISTS (SELECT 1 FROM purchase_receipts r WHERE r.order_id = purchase_orders.id)""",
    # A removed draft delivery that a return still points at stays until the return goes.
    "inventory_deliveries": """
            AND NOT EXISTS (SELECT 1 FROM inventory_returns r WHERE r.delivery_id = inventory_deliveries.id)""",
}
# A product without history can still hold zero balance rows, which also restrict the delete.
PURGE_PREPARE = {
    "catalog_products": text(
        """
        DELETE FROM inventory_stock_levels
        USING catalog_products
        WHERE inventory_stock_levels.product_id = catalog_products.id
            AND inventory_stock_levels.tenant_id = catalog_products.tenant_id
            AND inventory_stock_levels.on_hand = 0
            AND inventory_stock_levels.reserved = 0
            AND catalog_products.deleted_at < now() - (:retention_days * interval '1 day')
            AND NOT EXISTS (SELECT 1 FROM inventory_stock_moves m WHERE m.product_id = catalog_products.id)
            AND NOT EXISTS (SELECT 1 FROM inventory_adjustment_lines l WHERE l.product_id = catalog_products.id)
            AND NOT EXISTS (SELECT 1 FROM inventory_transfer_lines l WHERE l.product_id = catalog_products.id)
            AND NOT EXISTS (SELECT 1 FROM inventory_delivery_lines l WHERE l.product_id = catalog_products.id)
            AND NOT EXISTS (SELECT 1 FROM inventory_return_lines l WHERE l.product_id = catalog_products.id)
            AND NOT EXISTS (SELECT 1 FROM purchase_order_lines l WHERE l.product_id = catalog_products.id)
        """
    ),
}


def _quote_purge_identifier(identifier: str) -> str:
    if not IDENTIFIER_PATTERN.fullmatch(identifier):
        raise ValueError("Unsafe recycle purge identifier")
    return f'"{identifier}"'


def _build_purge_statement(table_name: str, pk_column: str):
    table_identifier = _quote_purge_identifier(table_name)
    pk_identifier = _quote_purge_identifier(pk_column)
    tag_module_key = RECORD_TAG_MODULE_KEYS.get(table_name)
    tag_cleanup = ""
    if tag_module_key:
        tag_cleanup = f""",
        deleted_tag_links AS (
            DELETE FROM record_tag_links
            WHERE tenant_id IN (
                SELECT {table_identifier}.tenant_id
                FROM {table_identifier}
                JOIN rows_to_delete ON {table_identifier}.{pk_identifier} = rows_to_delete.{pk_identifier}
            )
            AND module_key = '{tag_module_key}'
            AND entity_id IN (SELECT CAST({pk_identifier} AS text) FROM rows_to_delete)
            RETURNING id
        )"""
    value_module_key = FIELD_VALUE_MODULE_KEYS.get(table_name)
    if value_module_key:
        tag_cleanup += f""",
        deleted_field_values AS (
            DELETE FROM field_values
            WHERE module_key = '{value_module_key}'
            AND record_id IN (SELECT {pk_identifier} FROM rows_to_delete)
            AND tenant_id IN (
                SELECT {table_identifier}.tenant_id
                FROM {table_identifier}
                JOIN rows_to_delete ON {table_identifier}.{pk_identifier} = rows_to_delete.{pk_identifier}
            )
            RETURNING id
        )"""
    elif table_name == "custom_module_records":
        tag_cleanup += f""",
        deleted_field_values AS (
            DELETE FROM field_values
            USING custom_module_records r
            JOIN custom_module_definitions d ON d.id = r.custom_module_id
            JOIN modules m ON m.id = d.module_id
            WHERE r.id IN (SELECT {pk_identifier} FROM rows_to_delete)
            AND field_values.record_id = r.id
            AND field_values.tenant_id = r.tenant_id
            AND field_values.module_key = m.name
            RETURNING field_values.id
        )"""
    return text(
        f"""
        WITH rows_to_delete AS (
            SELECT {pk_identifier}
            FROM {table_identifier}
            WHERE deleted_at < now() - (:retention_days * interval '1 day'){PURGE_GUARDS.get(table_name, "")}
            ORDER BY deleted_at ASC, {pk_identifier} ASC
            LIMIT :batch_size
        ){tag_cleanup}
        DELETE FROM {table_identifier}
        USING rows_to_delete
        WHERE {table_identifier}.{pk_identifier} = rows_to_delete.{pk_identifier}
        """
    )


def purge_expired_recycle_bin_records(db: Session, *, retention_days: int | None = None, batch_size: int | None = None) -> dict[str, int]:
    days = retention_days if retention_days is not None else settings.RECYCLE_BIN_RETENTION_DAYS
    limit = batch_size if batch_size is not None else settings.RECYCLE_BIN_PURGE_BATCH_SIZE
    purged: dict[str, int] = {}
    for table_name, pk_column in PURGE_TARGETS:
        if table_name in PURGE_PREPARE:
            db.execute(PURGE_PREPARE[table_name], {"retention_days": days})
        result = db.execute(
            _build_purge_statement(table_name, pk_column),
            {"retention_days": days, "batch_size": limit},
        )
        purged[table_name] = int(result.rowcount or 0)
    db.commit()
    return purged
