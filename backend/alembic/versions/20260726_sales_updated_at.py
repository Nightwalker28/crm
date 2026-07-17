"""add sales record update timestamps and invoice relationship indexes

Revision ID: 20260726_sales_updated_at
Revises: 20260725_order_fulfillment
Create Date: 2026-07-17
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260726_sales_updated_at"
down_revision: Union[str, None] = "20260725_order_fulfillment"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


SALES_TABLES = ("sales_leads", "sales_contacts", "sales_opportunities")


def upgrade() -> None:
    for table_name in SALES_TABLES:
        op.add_column(table_name, sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True))
        op.execute(
            sa.text(
                f"UPDATE {table_name} "
                "SET updated_at = COALESCE(created_time, CURRENT_TIMESTAMP) "
                "WHERE updated_at IS NULL"
            )
        )
        op.alter_column(
            table_name,
            "updated_at",
            existing_type=sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        )

    op.create_index(
        "ix_finance_pos_invoices_tenant_contact_active",
        "finance_pos_invoices",
        ["tenant_id", "customer_contact_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "ix_finance_pos_invoices_tenant_org_active",
        "finance_pos_invoices",
        ["tenant_id", "customer_organization_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_finance_pos_invoices_tenant_org_active", table_name="finance_pos_invoices")
    op.drop_index("ix_finance_pos_invoices_tenant_contact_active", table_name="finance_pos_invoices")
    for table_name in reversed(SALES_TABLES):
        op.drop_column(table_name, "updated_at")
