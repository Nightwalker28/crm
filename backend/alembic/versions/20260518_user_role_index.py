"""Add user tenant role index

Revision ID: 20260518_user_role_index
Revises: 20260517_user_admin_indexes
Create Date: 2026-05-18 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260518_user_role_index"
down_revision: Union[str, None] = "20260517_user_admin_indexes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _index_exists(bind, table_name: str, index_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return index_name in {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "users") and not _index_exists(bind, "users", "ix_users_tenant_role"):
        op.create_index("ix_users_tenant_role", "users", ["tenant_id", "role_id"])


def downgrade() -> None:
    bind = op.get_bind()
    if _index_exists(bind, "users", "ix_users_tenant_role"):
        op.drop_index("ix_users_tenant_role", table_name="users")
