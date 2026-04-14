"""add linked customer contact to insertion orders

Revision ID: 20260414_io_contact_link
Revises: 20260413_io_customer_link
Create Date: 2026-04-14 09:15:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260414_io_contact_link"
down_revision = "20260413_io_customer_link"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "finance_io",
        sa.Column("customer_contact_id", sa.BigInteger(), nullable=True),
    )
    op.create_foreign_key(
        "fk_finance_io_customer_contact_id",
        "finance_io",
        "sales_contacts",
        ["customer_contact_id"],
        ["contact_id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_finance_io_customer_contact_id",
        "finance_io",
        ["customer_contact_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_finance_io_customer_contact_id", table_name="finance_io")
    op.drop_constraint("fk_finance_io_customer_contact_id", "finance_io", type_="foreignkey")
    op.drop_column("finance_io", "customer_contact_id")
