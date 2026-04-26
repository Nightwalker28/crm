"""Repair department and team id sequences once

Revision ID: 20260427_dept_team_seq
Revises: 20260427_token_expiry_tz
Create Date: 2026-04-27 00:00:00.000000
"""

from alembic import op


revision = "20260427_dept_team_seq"
down_revision = "20260427_token_expiry_tz"
branch_labels = None
depends_on = None


TABLES = ("departments", "teams")


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    for table_name in TABLES:
        op.execute(
            f"""
            DO $$
            DECLARE
                seq_name text;
                max_id bigint;
            BEGIN
                seq_name := pg_get_serial_sequence('{table_name}', 'id');
                IF seq_name IS NULL THEN
                    RETURN;
                END IF;

                EXECUTE format('SELECT COALESCE(MAX(id), 0) FROM %I', '{table_name}')
                INTO max_id;

                IF max_id > 0 THEN
                    PERFORM setval(seq_name, max_id, true);
                ELSE
                    PERFORM setval(seq_name, 1, false);
                END IF;
            END $$;
            """
        )


def downgrade() -> None:
    pass
