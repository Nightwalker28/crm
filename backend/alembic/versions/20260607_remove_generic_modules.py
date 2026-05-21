"""remove temporary generic system modules

Revision ID: 20260607_remove_generic_mods
Revises: 20260606_search_indexes
Create Date: 2026-05-21
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260607_remove_generic_mods"
down_revision: Union[str, None] = "20260606_search_indexes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TEMPORARY_MODULE_KEYS = (
    "sales_leads",
    "sales_activities",
    "sales_notes",
    "sales_quotes",
    "sales_orders",
    "finance_invoices",
    "finance_payments",
    "finance_credit_notes",
    "finance_expenses",
    "purchase_vendors",
    "purchase_orders",
    "inventory_warehouses",
    "inventory_locations",
    "inventory_stock_moves",
    "inventory_stock_adjustments",
    "support_tickets",
    "projects",
    "project_tasks",
)


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _quoted_keys() -> str:
    return ", ".join(f"'{key}'" for key in TEMPORARY_MODULE_KEYS)


def upgrade() -> None:
    bind = op.get_bind()
    keys = _quoted_keys()

    if _table_exists(bind, "module_field_configs"):
        op.execute(sa.text(f"DELETE FROM module_field_configs WHERE module_key IN ({keys})"))

    if _table_exists(bind, "modules"):
        op.execute(sa.text(f"DELETE FROM modules WHERE name IN ({keys})"))

    if _table_exists(bind, "generic_system_records"):
        op.drop_table("generic_system_records")


def downgrade() -> None:
    pass
