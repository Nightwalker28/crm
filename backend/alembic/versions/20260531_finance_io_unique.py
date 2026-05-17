"""Enforce active insertion order number uniqueness

Revision ID: 20260531_finance_io_unique
Revises: 20260530_sidebar_cleanup
Create Date: 2026-05-17
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260531_finance_io_unique"
down_revision: Union[str, None] = "20260530_sidebar_cleanup"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_io_active_number
        ON finance_io (tenant_id, module_id, io_number)
        WHERE deleted_at IS NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_finance_io_active_number")
