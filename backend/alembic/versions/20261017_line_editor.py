"""Section and note lines, a percent discount, optional quote lines and a unit (13d §3.2)

Sales lines (quotes, orders, invoices) gain `line_type` (`item`, `section`, `note`) and
`discount_percent`; quote lines gain `is_optional`; every sales and purchase line gains a free-
text `unit` (F6.2 turns it into a managed list). Existing lines are items with no percent, not
optional and no unit, so nothing is backfilled and no amount changes.

Downgrade refuses while any section, note or optional line exists, since dropping the columns
would turn them into zero-priced items.

Revision ID: 20261017_line_editor
Revises: 20261016_tax_rates
Create Date: 2026-10-09
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20261017_line_editor"
down_revision: Union[str, None] = "20261016_tax_rates"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TYPED_TABLES = ("sales_quote_items", "sales_order_items", "finance_pos_invoice_lines")
UNIT_ONLY_TABLES = ("finance_credit_note_lines", "purchase_order_lines", "purchase_bill_lines")


def upgrade() -> None:
    for table in TYPED_TABLES:
        op.add_column(table, sa.Column("line_type", sa.Text(), nullable=False, server_default="item"))
        op.add_column(table, sa.Column("discount_percent", sa.Numeric(7, 4), nullable=True))
        op.add_column(table, sa.Column("unit", sa.Text(), nullable=True))
        op.create_check_constraint(f"ck_{table}_line_type", table, "line_type IN ('item', 'section', 'note')")
        op.create_check_constraint(f"ck_{table}_discount_percent", table,
                                   "discount_percent IS NULL OR (discount_percent >= 0 AND discount_percent <= 100)")
    op.add_column("sales_quote_items", sa.Column("is_optional", sa.Boolean(), nullable=False, server_default=sa.false()))
    for table in UNIT_ONLY_TABLES:
        op.add_column(table, sa.Column("unit", sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    for table in TYPED_TABLES:
        if bind.execute(sa.text(f"SELECT 1 FROM {table} WHERE line_type <> 'item' LIMIT 1")).first():
            raise RuntimeError(f"{table} has section or note lines; remove them before downgrading 20261017_line_editor")
    if bind.execute(sa.text("SELECT 1 FROM sales_quote_items WHERE is_optional LIMIT 1")).first():
        raise RuntimeError("Quotes have optional lines; remove them before downgrading 20261017_line_editor")
    for table in UNIT_ONLY_TABLES:
        op.drop_column(table, "unit")
    op.drop_column("sales_quote_items", "is_optional")
    for table in TYPED_TABLES:
        op.drop_constraint(f"ck_{table}_discount_percent", table, type_="check")
        op.drop_constraint(f"ck_{table}_line_type", table, type_="check")
        op.drop_column(table, "unit")
        op.drop_column(table, "discount_percent")
        op.drop_column(table, "line_type")
