"""add tenant mfa policy

Revision ID: 20260704_admin_mfa
Revises: 20260703_mfa_foundation
Create Date: 2026-06-11
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260704_admin_mfa"
down_revision: Union[str, None] = "20260703_mfa_foundation"
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
    if _table_exists(bind, "tenants") and not _column_exists(bind, "tenants", "mfa_policy"):
        op.add_column("tenants", sa.Column("mfa_policy", sa.String(length=20), nullable=False, server_default="off"))


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "tenants") and _column_exists(bind, "tenants", "mfa_policy"):
        op.drop_column("tenants", "mfa_policy")
