"""add linked customer organization to insertion orders

Revision ID: 20260413_io_customer_link
Revises: 20260413_audit_recycle
Create Date: 2026-04-13 19:10:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260413_io_customer_link"
down_revision = "20260413_audit_recycle"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "finance_io",
        sa.Column("customer_organization_id", sa.BigInteger(), nullable=True),
    )
    op.create_foreign_key(
        "fk_finance_io_customer_organization_id",
        "finance_io",
        "sales_organizations",
        ["customer_organization_id"],
        ["org_id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_finance_io_customer_organization_id",
        "finance_io",
        ["customer_organization_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_finance_io_customer_organization_id", table_name="finance_io")
    op.drop_constraint("fk_finance_io_customer_organization_id", "finance_io", type_="foreignkey")
    op.drop_column("finance_io", "customer_organization_id")
