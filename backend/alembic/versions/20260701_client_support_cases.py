"""add client support case category

Revision ID: 20260701_client_support
Revises: 20260630_client_portal_orders
Create Date: 2026-06-11
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260701_client_support"
down_revision: Union[str, None] = "20260630_client_portal_orders"
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
    if _table_exists(bind, "support_cases") and not _column_exists(bind, "support_cases", "category"):
        op.add_column("support_cases", sa.Column("category", sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    if _column_exists(bind, "support_cases", "category"):
        op.drop_column("support_cases", "category")
