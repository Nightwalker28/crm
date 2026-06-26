"""Make auth token timestamps timezone-aware server defaults

Revision ID: 20260711_token_timestamps
Revises: 20260710_number_counters
Create Date: 2026-06-26
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260711_token_timestamps"
down_revision: Union[str, None] = "20260710_number_counters"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name: str) -> bool:
    return sa.inspect(bind).has_table(table_name)


def _column_exists(bind, table_name: str, column_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return any(column["name"] == column_name for column in sa.inspect(bind).get_columns(table_name))


def _alter_timestamp_column(
    table_name: str,
    column_name: str,
    *,
    existing_type,
    target_type,
    nullable: bool,
    server_default=None,
) -> None:
    bind = op.get_bind()
    if not _column_exists(bind, table_name, column_name):
        return

    kwargs = {
        "existing_type": existing_type,
        "type_": target_type,
        "existing_nullable": nullable,
        "nullable": nullable,
        "server_default": server_default,
    }
    if bind.dialect.name == "postgresql":
        kwargs["postgresql_using"] = f"{column_name} AT TIME ZONE 'UTC'"

    op.alter_column(table_name, column_name, **kwargs)


def _backfill_missing_created_at(table_name: str) -> None:
    if not _column_exists(op.get_bind(), table_name, "created_at"):
        return
    op.execute(
        sa.text(f"UPDATE {table_name} SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL")
    )


def upgrade() -> None:
    _backfill_missing_created_at("refresh_tokens")
    _backfill_missing_created_at("user_setup_tokens")
    _alter_timestamp_column(
        "refresh_tokens",
        "created_at",
        existing_type=sa.DateTime(),
        target_type=sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )
    _alter_timestamp_column(
        "user_setup_tokens",
        "created_at",
        existing_type=sa.DateTime(),
        target_type=sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )
    _alter_timestamp_column(
        "user_setup_tokens",
        "consumed_at",
        existing_type=sa.DateTime(),
        target_type=sa.DateTime(timezone=True),
        nullable=True,
        server_default=None,
    )


def downgrade() -> None:
    _alter_timestamp_column(
        "refresh_tokens",
        "created_at",
        existing_type=sa.DateTime(timezone=True),
        target_type=sa.DateTime(),
        nullable=True,
        server_default=None,
    )
    _alter_timestamp_column(
        "user_setup_tokens",
        "created_at",
        existing_type=sa.DateTime(timezone=True),
        target_type=sa.DateTime(),
        nullable=False,
        server_default=None,
    )
    bind = op.get_bind()
    if not _column_exists(bind, "user_setup_tokens", "consumed_at"):
        return

    kwargs = {
        "existing_type": sa.DateTime(timezone=True),
        "type_": sa.DateTime(),
        "existing_nullable": True,
        "nullable": True,
        "server_default": None,
    }
    if bind.dialect.name == "postgresql":
        kwargs["postgresql_using"] = "consumed_at AT TIME ZONE 'UTC'"
    op.alter_column("user_setup_tokens", "consumed_at", **kwargs)
