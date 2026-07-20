"""add tenant domain verification check timestamp

Revision ID: 20260727_domain_checked
Revises: 20260726_sales_updated_at
Create Date: 2026-07-20
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260727_domain_checked"
down_revision: Union[str, None] = "20260726_sales_updated_at"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tenant_domains",
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        sa.text(
            "UPDATE tenant_domains "
            "SET last_checked_at = CASE "
            "WHEN status = 'verified' THEN COALESCE(verified_at, updated_at, created_at) "
            "WHEN status = 'failed' THEN COALESCE(updated_at, created_at) "
            "ELSE NULL END"
        )
    )


def downgrade() -> None:
    op.drop_column("tenant_domains", "last_checked_at")
