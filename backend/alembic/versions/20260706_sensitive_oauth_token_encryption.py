"""add oauth token encryption key versions

Revision ID: 20260706_token_encryption
Revises: 20260705_tenant_oidc
Create Date: 2026-06-12
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260706_token_encryption"
down_revision: Union[str, None] = "20260705_tenant_oidc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TOKEN_TABLES = (
    "user_mail_connections",
    "user_calendar_connections",
    "document_storage_connections",
)


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _column_exists(bind, table_name: str, column_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return column_name in {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    for table_name in TOKEN_TABLES:
        if not _table_exists(bind, table_name):
            continue
        for column_name in ("access_token_key_version", "refresh_token_key_version"):
            if not _column_exists(bind, table_name, column_name):
                op.add_column(table_name, sa.Column(column_name, sa.String(length=32), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    for table_name in reversed(TOKEN_TABLES):
        if not _table_exists(bind, table_name):
            continue
        for column_name in ("refresh_token_key_version", "access_token_key_version"):
            if _column_exists(bind, table_name, column_name):
                op.drop_column(table_name, column_name)
