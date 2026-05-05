"""Add user admin list indexes

Revision ID: 20260517_user_admin_indexes
Revises: 20260516_sales_search_docs
Create Date: 2026-05-17 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260517_user_admin_indexes"
down_revision: Union[str, None] = "20260516_sales_search_docs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _index_exists(bind, table_name: str, index_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return index_name in {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def _create_index_if_missing(index_name: str, table_name: str, columns: list[str]) -> None:
    bind = op.get_bind()
    if _table_exists(bind, table_name) and not _index_exists(bind, table_name, index_name):
        op.create_index(index_name, table_name, columns)


def upgrade() -> None:
    _create_index_if_missing("ix_users_tenant_status", "users", ["tenant_id", "is_active"])
    _create_index_if_missing("ix_users_tenant_team", "users", ["tenant_id", "team_id"])


def downgrade() -> None:
    bind = op.get_bind()
    if _index_exists(bind, "users", "ix_users_tenant_team"):
        op.drop_index("ix_users_tenant_team", table_name="users")
    if _index_exists(bind, "users", "ix_users_tenant_status"):
        op.drop_index("ix_users_tenant_status", table_name="users")
