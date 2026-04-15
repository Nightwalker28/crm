"""remove json custom field bridge columns

Revision ID: 20260415_rm_cf_json
Revises: 20260415_cf_backfill
Create Date: 2026-04-15 10:45:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260415_rm_cf_json"
down_revision = "20260415_cf_backfill"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("finance_io", "custom_data")
    op.drop_column("sales_contacts", "custom_data")
    op.drop_column("sales_opportunities", "custom_data")
    op.drop_column("sales_organizations", "custom_data")


def downgrade() -> None:
    op.add_column("sales_organizations", sa.Column("custom_data", sa.JSON(), nullable=True))
    op.add_column("sales_opportunities", sa.Column("custom_data", sa.JSON(), nullable=True))
    op.add_column("sales_contacts", sa.Column("custom_data", sa.JSON(), nullable=True))
    op.add_column("finance_io", sa.Column("custom_data", sa.JSON(), nullable=True))
