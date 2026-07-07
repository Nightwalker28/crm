"""add sales organization updated timestamp

Revision ID: 20260718_sales_org_updated_at
Revises: 20260717_search_hot_indexes
Create Date: 2026-07-07
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260718_sales_org_updated_at"
down_revision: Union[str, None] = "20260717_search_hot_indexes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _column_exists(bind, table_name: str, column_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return column_name in {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "sales_organizations") or _column_exists(bind, "sales_organizations", "updated_at"):
        return

    op.add_column(
        "sales_organizations",
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        sa.text(
            "UPDATE sales_organizations "
            "SET updated_at = COALESCE(created_time, CURRENT_TIMESTAMP) "
            "WHERE updated_at IS NULL"
        )
    )
    op.alter_column(
        "sales_organizations",
        "updated_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )


def downgrade() -> None:
    bind = op.get_bind()
    if not _column_exists(bind, "sales_organizations", "updated_at"):
        return
    op.drop_column("sales_organizations", "updated_at")
