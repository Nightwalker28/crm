"""store provider references on each document version

Revision ID: 20260730_doc_version_refs
Revises: 20260729_doc_uploaded_default
Create Date: 2026-08-05
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260730_doc_version_refs"
down_revision: Union[str, None] = "20260729_doc_uploaded_default"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("document_upload_operations", sa.Column("association_failures", sa.JSON(), server_default="[]", nullable=False))
    op.add_column("document_versions", sa.Column("storage_provider", sa.String(length=40), server_default="local", nullable=False))
    op.add_column("document_versions", sa.Column("provider_file_id", sa.String(length=512), nullable=True))
    op.add_column("document_versions", sa.Column("provider_parent_id", sa.String(length=512), nullable=True))
    op.add_column("document_versions", sa.Column("provider_account_id", sa.BigInteger(), nullable=True))
    op.add_column("document_versions", sa.Column("provider_path", sa.Text(), nullable=True))
    op.add_column("document_versions", sa.Column("external_web_url", sa.Text(), nullable=True))
    op.add_column("document_versions", sa.Column("provider_created_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("document_versions", sa.Column("provider_status", sa.String(length=30), server_default="available", nullable=False))
    op.create_foreign_key(
        "fk_document_versions_provider_account_id",
        "document_versions",
        "document_storage_connections",
        ["provider_account_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.execute(
        "UPDATE document_versions AS version SET "
        "storage_provider = document.storage_provider, "
        "provider_file_id = CASE WHEN document.storage_provider <> 'local' THEN version.storage_key ELSE NULL END, "
        "provider_account_id = document.provider_account_id, "
        "provider_path = CASE WHEN document.current_version_id = version.id THEN document.provider_path ELSE NULL END, "
        "external_web_url = CASE WHEN document.current_version_id = version.id THEN document.external_web_url ELSE NULL END, "
        "provider_created_at = CASE WHEN document.current_version_id = version.id THEN document.provider_created_at ELSE NULL END, "
        "provider_status = CASE WHEN document.current_version_id = version.id THEN document.provider_status ELSE 'available' END "
        "FROM documents AS document WHERE document.id = version.document_id AND document.tenant_id = version.tenant_id"
    )
    op.create_index("ix_document_versions_storage_provider", "document_versions", ["storage_provider"])
    op.create_index("ix_document_versions_provider_file_id", "document_versions", ["provider_file_id"])
    op.create_index("ix_document_versions_provider_account_id", "document_versions", ["provider_account_id"])
    op.create_index("ix_document_versions_provider_status", "document_versions", ["provider_status"])


def downgrade() -> None:
    for index_name in (
        "ix_document_versions_provider_status",
        "ix_document_versions_provider_account_id",
        "ix_document_versions_provider_file_id",
        "ix_document_versions_storage_provider",
    ):
        op.drop_index(index_name, table_name="document_versions")
    op.drop_constraint("fk_document_versions_provider_account_id", "document_versions", type_="foreignkey")
    for column_name in (
        "provider_status",
        "provider_created_at",
        "external_web_url",
        "provider_path",
        "provider_account_id",
        "provider_parent_id",
        "provider_file_id",
        "storage_provider",
    ):
        op.drop_column("document_versions", column_name)
    op.drop_column("document_upload_operations", "association_failures")
