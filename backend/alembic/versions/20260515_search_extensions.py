"""Ensure Postgres search extensions

Revision ID: 20260515_search_extensions
Revises: 20260514_constraints_dept
Create Date: 2026-05-15 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260515_search_extensions"
down_revision: Union[str, None] = "20260514_constraints_dept"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
                CREATE EXTENSION IF NOT EXISTS pg_trgm;
                CREATE EXTENSION IF NOT EXISTS unaccent;
            EXCEPTION
                WHEN insufficient_privilege OR undefined_file THEN
                    RAISE NOTICE 'Search extensions could not be enabled by this migration';
            END
            $$;
            """
        )
    )


def downgrade() -> None:
    pass
