"""add stable public booking handles

Revision ID: 20260810_booking_handles
Revises: 20260731_team_access_hierarchy
Create Date: 2026-08-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260810_booking_handles"
down_revision: Union[str, None] = "20260731_team_access_hierarchy"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("booking_handle", sa.String(length=60), nullable=True))
    op.execute(
        """
        WITH normalized AS (
            SELECT
                id,
                CASE
                    WHEN length(base_handle) >= 3
                         AND base_handle NOT IN (
                             'admin', 'api', 'app', 'book', 'booking', 'dashboard',
                             'help', 'login', 'logout', 'null', 'settings', 'signup',
                             'support', 'www'
                         )
                    THEN left(base_handle, 47)
                    ELSE 'member'
                END AS safe_base
            FROM (
                SELECT
                    id,
                    trim(BOTH '-' FROM regexp_replace(
                        lower(concat_ws('-', nullif(trim(first_name), ''), nullif(trim(last_name), ''))),
                        '[^a-z0-9]+',
                        '-',
                        'g'
                    )) AS base_handle
                FROM users
            ) AS source
        )
        UPDATE users
        SET booking_handle = normalized.safe_base || '-' || left(md5(users.tenant_id::text || ':' || users.id::text), 12)
        FROM normalized
        WHERE normalized.id = users.id
        """
    )
    op.alter_column("users", "booking_handle", existing_type=sa.String(length=60), nullable=False)
    op.create_unique_constraint("uq_users_booking_handle", "users", ["booking_handle"])
    op.create_index("ix_users_booking_handle", "users", ["booking_handle"], unique=False)
    op.create_check_constraint(
        "ck_users_booking_handle_format",
        "users",
        "booking_handle ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'",
    )


def downgrade() -> None:
    op.drop_constraint("ck_users_booking_handle_format", "users", type_="check")
    op.drop_index("ix_users_booking_handle", table_name="users")
    op.drop_constraint("uq_users_booking_handle", "users", type_="unique")
    op.drop_column("users", "booking_handle")
