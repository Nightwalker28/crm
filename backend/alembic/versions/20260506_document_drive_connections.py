"""Add document storage provider connections

Revision ID: 20260506_doc_drive_conn
Revises: 20260505_document_hardening
Create Date: 2026-05-06 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260506_doc_drive_conn"
down_revision: Union[str, None] = "20260505_document_hardening"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "document_storage_connections" in inspector.get_table_names():
        return

    op.create_table(
        "document_storage_connections",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("provider", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="connected", nullable=False),
        sa.Column("account_email", sa.String(length=255), nullable=True),
        sa.Column("scopes", sa.JSON(), nullable=True),
        sa.Column("access_token", sa.Text(), nullable=True),
        sa.Column("refresh_token", sa.Text(), nullable=True),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("provider_root_id", sa.String(length=255), nullable=True),
        sa.Column("provider_root_name", sa.String(length=255), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "user_id", "provider", name="uq_document_storage_connections_user_provider"),
    )
    op.create_index("ix_document_storage_connections_id", "document_storage_connections", ["id"])
    op.create_index("ix_document_storage_connections_tenant_id", "document_storage_connections", ["tenant_id"])
    op.create_index("ix_document_storage_connections_user_id", "document_storage_connections", ["user_id"])
    op.create_index("ix_document_storage_connections_provider", "document_storage_connections", ["provider"])
    op.create_index("ix_document_storage_connections_status", "document_storage_connections", ["status"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "document_storage_connections" not in inspector.get_table_names():
        return
    op.drop_index("ix_document_storage_connections_status", table_name="document_storage_connections")
    op.drop_index("ix_document_storage_connections_provider", table_name="document_storage_connections")
    op.drop_index("ix_document_storage_connections_user_id", table_name="document_storage_connections")
    op.drop_index("ix_document_storage_connections_tenant_id", table_name="document_storage_connections")
    op.drop_index("ix_document_storage_connections_id", table_name="document_storage_connections")
    op.drop_table("document_storage_connections")
