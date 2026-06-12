"""add mail password encryption key version

Revision ID: 20260707_mail_pwd_key
Revises: 20260706_token_encryption
Create Date: 2026-06-12
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260707_mail_pwd_key"
down_revision: Union[str, None] = "20260706_token_encryption"
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
    if _table_exists(bind, "user_mail_connections") and not _column_exists(bind, "user_mail_connections", "encrypted_password_key_version"):
        op.add_column("user_mail_connections", sa.Column("encrypted_password_key_version", sa.String(length=32), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "user_mail_connections") and _column_exists(bind, "user_mail_connections", "encrypted_password_key_version"):
        op.drop_column("user_mail_connections", "encrypted_password_key_version")
