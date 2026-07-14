"""add lead next follow-up planning date

Revision ID: 20260722_lead_followup
Revises: 20260721_task_query_indexes
Create Date: 2026-07-14
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260722_lead_followup"
down_revision: Union[str, None] = "20260721_task_query_indexes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


INDEX_NAME = "ix_sales_leads_tenant_next_follow_up_active"


def upgrade() -> None:
    op.add_column("sales_leads", sa.Column("next_follow_up_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(
        INDEX_NAME,
        "sales_leads",
        ["tenant_id", "next_follow_up_at"],
        postgresql_where=sa.text("deleted_at IS NULL AND next_follow_up_at IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(INDEX_NAME, table_name="sales_leads")
    op.drop_column("sales_leads", "next_follow_up_at")
