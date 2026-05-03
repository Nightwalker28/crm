"""Harden document storage metadata

Revision ID: 20260505_document_hardening
Revises: 20260504_documents_module
Create Date: 2026-05-05
"""

from alembic import op
import sqlalchemy as sa


revision = "20260505_document_hardening"
down_revision = "20260504_documents_module"
branch_labels = None
depends_on = None


def _column_exists(bind, table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(bind)
    if not inspector.has_table(table_name):
        return False
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def upgrade() -> None:
    bind = op.get_bind()
    if not _column_exists(bind, "documents", "storage_provider"):
        op.add_column(
            "documents",
            sa.Column("storage_provider", sa.String(length=40), server_default="local", nullable=False),
        )
        op.create_index("ix_documents_storage_provider", "documents", ["storage_provider"])


def downgrade() -> None:
    bind = op.get_bind()
    if _column_exists(bind, "documents", "storage_provider"):
        op.drop_index("ix_documents_storage_provider", table_name="documents")
        op.drop_column("documents", "storage_provider")
