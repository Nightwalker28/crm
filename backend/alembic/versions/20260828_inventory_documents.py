"""E2 Phase 2: transfer documents and draft lookup indexes.

Revision ID: 20260828_inventory_documents
Revises: 20260827_inventory_append_only
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260828_inventory_documents"
down_revision: Union[str, None] = "20260827_inventory_append_only"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("ix_inventory_adjustments_tenant_status_id", "inventory_adjustments", ["tenant_id", "status", "id"])
    op.create_table(
        "inventory_transfers",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("number", sa.String(50), nullable=False),
        sa.Column("from_warehouse_id", sa.BigInteger(), sa.ForeignKey("inventory_warehouses.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("to_warehouse_id", sa.BigInteger(), sa.ForeignKey("inventory_warehouses.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("notes", sa.Text()),
        sa.Column("posted_at", sa.DateTime(timezone=True)),
        sa.Column("posted_by", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("tenant_id", "number", name="uq_inventory_transfer_number"),
        sa.CheckConstraint("status IN ('draft', 'posted', 'cancelled')", name="ck_inventory_transfer_status"),
        sa.CheckConstraint("from_warehouse_id <> to_warehouse_id", name="ck_inventory_transfer_distinct_warehouses"),
    )
    op.create_index("ix_inventory_transfers_tenant_id", "inventory_transfers", ["tenant_id"])
    op.create_index("ix_inventory_transfers_tenant_status_id", "inventory_transfers", ["tenant_id", "status", "id"])
    op.create_table(
        "inventory_transfer_lines",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("transfer_id", sa.BigInteger(), sa.ForeignKey("inventory_transfers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id", sa.BigInteger(), sa.ForeignKey("catalog_products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("quantity", sa.Numeric(12, 4), nullable=False),
        sa.UniqueConstraint("transfer_id", "product_id", name="uq_inventory_transfer_line_product"),
        sa.CheckConstraint("quantity > 0", name="ck_inventory_transfer_positive_quantity"),
    )
    op.create_index("ix_inventory_transfer_lines_tenant_id", "inventory_transfer_lines", ["tenant_id"])
    op.create_index("ix_inventory_transfer_lines_transfer_id", "inventory_transfer_lines", ["transfer_id"])


def downgrade() -> None:
    op.drop_table("inventory_transfer_lines")
    op.drop_table("inventory_transfers")
    op.drop_index("ix_inventory_adjustments_tenant_status_id", table_name="inventory_adjustments")
