"""Add product reorder settings for E2 low stock alerts.

Revision ID: 20260829_inventory_reorder
Revises: 20260828_inventory_documents
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260829_inventory_reorder"
down_revision: Union[str, None] = "20260828_inventory_documents"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("catalog_products", sa.Column("reorder_point", sa.Numeric(12, 4), nullable=False, server_default="0"))
    op.add_column("catalog_products", sa.Column("reorder_quantity", sa.Numeric(12, 4), nullable=False, server_default="0"))
    op.create_check_constraint("ck_catalog_products_reorder_point_nonnegative", "catalog_products", "reorder_point >= 0")
    op.create_check_constraint("ck_catalog_products_reorder_quantity_nonnegative", "catalog_products", "reorder_quantity >= 0")


def downgrade() -> None:
    op.drop_constraint("ck_catalog_products_reorder_quantity_nonnegative", "catalog_products", type_="check")
    op.drop_constraint("ck_catalog_products_reorder_point_nonnegative", "catalog_products", type_="check")
    op.drop_column("catalog_products", "reorder_quantity")
    op.drop_column("catalog_products", "reorder_point")
