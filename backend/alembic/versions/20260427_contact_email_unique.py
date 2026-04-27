"""add unique active contact email guard

Revision ID: 20260427_contact_email_unique
Revises: 20260427_sv_sys_unique
Create Date: 2026-04-27
"""

from alembic import op


revision = "20260427_contact_email_unique"
down_revision = "20260427_sv_sys_unique"
branch_labels = None
depends_on = None


INDEX_NAME = "uq_sales_contacts_tenant_email"


def upgrade() -> None:
    op.execute(
        f"""
        CREATE UNIQUE INDEX {INDEX_NAME}
        ON sales_contacts (tenant_id, lower(primary_email))
        WHERE deleted_at IS NULL
        """
    )


def downgrade() -> None:
    op.drop_index(INDEX_NAME, table_name="sales_contacts")
