"""add order fulfillment details

Revision ID: 20260725_order_fulfillment
Revises: 20260724_quote_line_items
Create Date: 2026-07-16
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260725_order_fulfillment"
down_revision: Union[str, None] = "20260724_quote_line_items"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("sales_orders", sa.Column("delivery_date", sa.Date(), nullable=True))
    op.add_column("sales_orders", sa.Column("delivery_address", sa.Text(), nullable=True))
    op.add_column("sales_orders", sa.Column("payment_terms", sa.Text(), nullable=True))
    op.add_column("sales_orders", sa.Column("notes", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("sales_orders", "notes")
    op.drop_column("sales_orders", "payment_terms")
    op.drop_column("sales_orders", "delivery_address")
    op.drop_column("sales_orders", "delivery_date")
