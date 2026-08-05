"""add provider-neutral cloud document references

Revision ID: 20260728_cloud_doc_refs
Revises: 20260727_domain_checked
Create Date: 2026-08-05
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260728_cloud_doc_refs"
down_revision: Union[str, None] = "20260727_domain_checked"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("provider_file_id", sa.String(length=512), nullable=True))
    op.add_column("documents", sa.Column("provider_parent_id", sa.String(length=512), nullable=True))
    op.add_column("documents", sa.Column("provider_account_id", sa.BigInteger(), nullable=True))
    op.add_column("documents", sa.Column("display_name", sa.String(length=255), nullable=True))
    op.add_column("documents", sa.Column("checksum", sa.String(length=128), nullable=True))
    op.add_column("documents", sa.Column("provider_path", sa.Text(), nullable=True))
    op.add_column("documents", sa.Column("external_web_url", sa.Text(), nullable=True))
    op.add_column("documents", sa.Column("provider_created_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("documents", sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True))
    op.add_column("documents", sa.Column("provider_status", sa.String(length=30), server_default="available", nullable=False))
    op.add_column("documents", sa.Column("category", sa.String(length=120), nullable=True))
    op.add_column("documents", sa.Column("tags", sa.JSON(), server_default="[]", nullable=False))
    op.create_foreign_key(
        "fk_documents_provider_account_id",
        "documents",
        "document_storage_connections",
        ["provider_account_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.execute(
        "UPDATE documents SET display_name = title, uploaded_at = created_at, "
        "provider_file_id = CASE WHEN storage_provider <> 'local' THEN storage_path ELSE NULL END"
    )
    op.alter_column("documents", "display_name", existing_type=sa.String(length=255), nullable=False)
    op.alter_column("documents", "uploaded_at", existing_type=sa.DateTime(timezone=True), nullable=False)
    op.create_index("ix_documents_provider_file_id", "documents", ["provider_file_id"])
    op.create_index("ix_documents_provider_account_id", "documents", ["provider_account_id"])
    op.create_index("ix_documents_uploaded_at", "documents", ["uploaded_at"])
    op.create_index("ix_documents_provider_status", "documents", ["provider_status"])
    op.create_index("ix_documents_category", "documents", ["category"])

    op.create_table(
        "document_upload_operations",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=True),
        sa.Column("document_id", sa.BigInteger(), nullable=True),
        sa.Column("provider_account_id", sa.BigInteger(), nullable=True),
        sa.Column("idempotency_key", sa.String(length=64), nullable=False),
        sa.Column("storage_provider", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=30), server_default="pending", nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=120), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("checksum", sa.String(length=128), nullable=False),
        sa.Column("provider_file_id", sa.String(length=512), nullable=True),
        sa.Column("provider_parent_id", sa.String(length=512), nullable=True),
        sa.Column("provider_path", sa.Text(), nullable=True),
        sa.Column("external_web_url", sa.Text(), nullable=True),
        sa.Column("provider_created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["provider_account_id"], ["document_storage_connections.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "user_id", "idempotency_key", name="uq_document_upload_operation_key"),
    )
    op.create_index("ix_document_upload_operations_id", "document_upload_operations", ["id"])
    op.create_index("ix_document_upload_operations_tenant_id", "document_upload_operations", ["tenant_id"])
    op.create_index("ix_document_upload_operations_user_id", "document_upload_operations", ["user_id"])
    op.create_index("ix_document_upload_operations_document_id", "document_upload_operations", ["document_id"])
    op.create_index("ix_document_upload_operations_provider_account_id", "document_upload_operations", ["provider_account_id"])
    op.create_index("ix_document_upload_operations_status", "document_upload_operations", ["status"])
    op.create_index("ix_document_upload_operations_tenant_status", "document_upload_operations", ["tenant_id", "status"])


def downgrade() -> None:
    op.drop_table("document_upload_operations")
    for index_name in (
        "ix_documents_category",
        "ix_documents_provider_status",
        "ix_documents_uploaded_at",
        "ix_documents_provider_account_id",
        "ix_documents_provider_file_id",
    ):
        op.drop_index(index_name, table_name="documents")
    op.drop_constraint("fk_documents_provider_account_id", "documents", type_="foreignkey")
    for column_name in (
        "tags",
        "category",
        "provider_status",
        "uploaded_at",
        "provider_created_at",
        "external_web_url",
        "provider_path",
        "checksum",
        "display_name",
        "provider_account_id",
        "provider_parent_id",
        "provider_file_id",
    ):
        op.drop_column("documents", column_name)
