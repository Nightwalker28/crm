"""Add insertion order number sequence

Revision ID: 20260428_io_number_seq
Revises: 20260427_contact_email_unique
Create Date: 2026-04-28
"""

from alembic import op


revision = "20260428_io_number_seq"
down_revision = "20260427_contact_email_unique"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        DECLARE
            next_value bigint;
        BEGIN
            SELECT COALESCE(MAX(CAST(SUBSTRING(io_number FROM 5) AS bigint)), 0) + 1
            INTO next_value
            FROM finance_io
            WHERE io_number ~ '^IOAI[0-9]+$';

            CREATE SEQUENCE IF NOT EXISTS finance_io_number_seq;
            PERFORM setval('finance_io_number_seq', next_value, false);
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP SEQUENCE IF EXISTS finance_io_number_seq")
