"""Use timezone-aware token expiration columns

Revision ID: 20260427_token_expiry_tz
Revises: 20260427_setup_token_bigint
Create Date: 2026-04-27 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260427_token_expiry_tz"
down_revision = "20260427_setup_token_bigint"
branch_labels = None
depends_on = None


TOKEN_EXPIRY_COLUMNS = (
    ("refresh_tokens", "expires_at"),
    ("user_setup_tokens", "expires_at"),
)


def _table_exists(bind, table_name: str) -> bool:
    return sa.inspect(bind).has_table(table_name)


def upgrade() -> None:
    bind = op.get_bind()
    for table_name, column_name in TOKEN_EXPIRY_COLUMNS:
        if not _table_exists(bind, table_name):
            continue

        if bind.dialect.name == "postgresql":
            op.alter_column(
                table_name,
                column_name,
                existing_type=sa.DateTime(),
                type_=sa.DateTime(timezone=True),
                existing_nullable=False,
                postgresql_using=f"{column_name} AT TIME ZONE 'UTC'",
            )
        else:
            op.alter_column(
                table_name,
                column_name,
                existing_type=sa.DateTime(),
                type_=sa.DateTime(timezone=True),
                existing_nullable=False,
            )


def downgrade() -> None:
    bind = op.get_bind()
    for table_name, column_name in TOKEN_EXPIRY_COLUMNS:
        if not _table_exists(bind, table_name):
            continue

        if bind.dialect.name == "postgresql":
            op.alter_column(
                table_name,
                column_name,
                existing_type=sa.DateTime(timezone=True),
                type_=sa.DateTime(),
                existing_nullable=False,
                postgresql_using=f"{column_name} AT TIME ZONE 'UTC'",
            )
        else:
            op.alter_column(
                table_name,
                column_name,
                existing_type=sa.DateTime(timezone=True),
                type_=sa.DateTime(),
                existing_nullable=False,
            )
