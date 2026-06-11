"""add mfa foundation

Revision ID: 20260703_mfa_foundation
Revises: 20260702_client_docs
Create Date: 2026-06-11
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260703_mfa_foundation"
down_revision: Union[str, None] = "20260702_client_docs"
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
    if _table_exists(bind, "users"):
        if not _column_exists(bind, "users", "mfa_enabled"):
            op.add_column("users", sa.Column("mfa_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
        if not _column_exists(bind, "users", "encrypted_totp_secret"):
            op.add_column("users", sa.Column("encrypted_totp_secret", sa.Text(), nullable=True))
        if not _column_exists(bind, "users", "mfa_secret_key_version"):
            op.add_column("users", sa.Column("mfa_secret_key_version", sa.String(length=32), nullable=True))
        if not _column_exists(bind, "users", "mfa_verified_at"):
            op.add_column("users", sa.Column("mfa_verified_at", sa.DateTime(timezone=True), nullable=True))

    if not _table_exists(bind, "user_mfa_backup_codes"):
        op.create_table(
            "user_mfa_backup_codes",
            sa.Column("id", sa.BigInteger().with_variant(sa.Integer, "sqlite"), primary_key=True, autoincrement=True),
            sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("code_hash", sa.String(length=64), nullable=False, unique=True, index=True),
            sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_user_mfa_backup_codes_user_consumed", "user_mfa_backup_codes", ["user_id", "consumed_at"])


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "user_mfa_backup_codes"):
        op.drop_index("ix_user_mfa_backup_codes_user_consumed", table_name="user_mfa_backup_codes")
        op.drop_table("user_mfa_backup_codes")
    if _table_exists(bind, "users"):
        for column_name in ("mfa_verified_at", "mfa_secret_key_version", "encrypted_totp_secret", "mfa_enabled"):
            if _column_exists(bind, "users", column_name):
                op.drop_column("users", column_name)
