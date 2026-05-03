"""Add IMAP SMTP mail connection settings

Revision ID: 20260503_mail_imap_smtp
Revises: 20260430_refresh_last_used
Create Date: 2026-05-03
"""

from alembic import op
import sqlalchemy as sa


revision = "20260503_mail_imap_smtp"
down_revision = "20260430_refresh_last_used"
branch_labels = None
depends_on = None


def _table_exists(bind, table_name: str) -> bool:
    return sa.inspect(bind).has_table(table_name)


def _column_exists(bind, table_name: str, column_name: str) -> bool:
    columns = sa.inspect(bind).get_columns(table_name)
    return any(column["name"] == column_name for column in columns)


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "user_mail_connections"):
        return

    columns = [
        ("imap_host", sa.Column("imap_host", sa.String(length=255), nullable=True)),
        ("imap_port", sa.Column("imap_port", sa.BigInteger(), nullable=True)),
        ("imap_security", sa.Column("imap_security", sa.String(length=20), nullable=True)),
        ("imap_username", sa.Column("imap_username", sa.String(length=255), nullable=True)),
        ("smtp_host", sa.Column("smtp_host", sa.String(length=255), nullable=True)),
        ("smtp_port", sa.Column("smtp_port", sa.BigInteger(), nullable=True)),
        ("smtp_security", sa.Column("smtp_security", sa.String(length=20), nullable=True)),
        ("smtp_username", sa.Column("smtp_username", sa.String(length=255), nullable=True)),
        ("encrypted_password", sa.Column("encrypted_password", sa.Text(), nullable=True)),
    ]
    for column_name, column in columns:
        if not _column_exists(bind, "user_mail_connections", column_name):
            op.add_column("user_mail_connections", column)


def downgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "user_mail_connections"):
        return

    for column_name in [
        "encrypted_password",
        "smtp_username",
        "smtp_security",
        "smtp_port",
        "smtp_host",
        "imap_username",
        "imap_security",
        "imap_port",
        "imap_host",
    ]:
        if _column_exists(bind, "user_mail_connections", column_name):
            op.drop_column("user_mail_connections", column_name)
