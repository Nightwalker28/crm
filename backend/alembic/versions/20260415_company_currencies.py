"""add company operating currencies

Revision ID: 20260415_company_currencies
Revises: 20260415_module_enable
Create Date: 2026-04-15
"""

from alembic import op
import sqlalchemy as sa


revision = "20260415_company_currencies"
down_revision = "20260415_module_enable"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("company_profiles", sa.Column("operating_currencies", sa.JSON(), nullable=True))
    op.execute("UPDATE company_profiles SET operating_currencies = '[\"USD\"]'::json WHERE operating_currencies IS NULL")


def downgrade() -> None:
    op.drop_column("company_profiles", "operating_currencies")
