"""Add Postgres monitoring and autovacuum settings

Revision ID: 20260513_pg_maintenance
Revises: 20260512_hot_path_idx
Create Date: 2026-05-13 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260513_pg_maintenance"
down_revision: Union[str, None] = "20260512_hot_path_idx"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


HIGH_WRITE_TABLES = (
    "activity_logs",
    "user_notifications",
    "refresh_tokens",
    "data_transfer_jobs",
)


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
                CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
            EXCEPTION
                WHEN insufficient_privilege OR undefined_file THEN
                    RAISE NOTICE 'pg_stat_statements could not be enabled by this migration';
            END
            $$;
            """
        )
    )

    for table_name in HIGH_WRITE_TABLES:
        if _table_exists(bind, table_name):
            op.execute(
                sa.text(
                    f"""
                    ALTER TABLE {table_name} SET (
                        autovacuum_vacuum_scale_factor = 0.01,
                        autovacuum_analyze_scale_factor = 0.005
                    )
                    """
                )
            )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    for table_name in HIGH_WRITE_TABLES:
        if _table_exists(bind, table_name):
            op.execute(sa.text(f"ALTER TABLE {table_name} RESET (autovacuum_vacuum_scale_factor)"))
            op.execute(sa.text(f"ALTER TABLE {table_name} RESET (autovacuum_analyze_scale_factor)"))
