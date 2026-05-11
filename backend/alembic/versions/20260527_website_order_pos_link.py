"""link website orders to pos invoices

Revision ID: 20260527_website_order_pos_link
Revises: 20260526_finance_pos_invoices
Create Date: 2026-05-12
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260527_website_order_pos_link"
down_revision: Union[str, None] = "20260526_finance_pos_invoices"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("website_integration_orders", sa.Column("pos_invoice_id", sa.BigInteger(), nullable=True))
    op.create_index("ix_website_integration_orders_pos_invoice_id", "website_integration_orders", ["pos_invoice_id"])
    op.create_foreign_key(
        "fk_website_orders_pos_invoice_id",
        "website_integration_orders",
        "finance_pos_invoices",
        ["pos_invoice_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_website_orders_pos_invoice_id", "website_integration_orders", type_="foreignkey")
    op.drop_index("ix_website_integration_orders_pos_invoice_id", table_name="website_integration_orders")
    op.drop_column("website_integration_orders", "pos_invoice_id")
