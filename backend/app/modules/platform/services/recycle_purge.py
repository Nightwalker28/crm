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
    ("finance_io", "id"),
    ("finance_pos_invoices", "id"),
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
