"""scope document storage keys and normalize local paths

Revision ID: 20260709_doc_storage
Revises: 20260708_domain_verify
Create Date: 2026-06-22
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260709_doc_storage"
down_revision: Union[str, None] = "20260708_domain_verify"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _constraint_exists(bind, table_name: str, constraint_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return constraint_name in {constraint["name"] for constraint in sa.inspect(bind).get_unique_constraints(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "documents"):
        op.execute(
            """
            UPDATE documents
            SET storage_path = regexp_replace(storage_path, '^/*documents/', '')
            WHERE storage_provider = 'local'
              AND storage_path ~ '^/*documents/'
            """
        )
        if _constraint_exists(bind, "documents", "documents_storage_path_key"):
            op.drop_constraint("documents_storage_path_key", "documents", type_="unique")
        if not _constraint_exists(bind, "documents", "uq_documents_tenant_provider_storage_path"):
            op.create_unique_constraint(
                "uq_documents_tenant_provider_storage_path",
                "documents",
                ["tenant_id", "storage_provider", "storage_path"],
            )

    if _table_exists(bind, "document_versions"):
        op.execute(
            """
            UPDATE document_versions
            SET storage_key = regexp_replace(document_versions.storage_key, '^/*documents/', '')
            FROM documents
            WHERE document_versions.document_id = documents.id
              AND documents.storage_provider = 'local'
              AND document_versions.storage_key ~ '^/*documents/'
            """
        )
        if _constraint_exists(bind, "document_versions", "uq_document_versions_storage_key"):
            op.drop_constraint("uq_document_versions_storage_key", "document_versions", type_="unique")
        if not _constraint_exists(bind, "document_versions", "uq_document_versions_document_storage_key"):
            op.create_unique_constraint(
                "uq_document_versions_document_storage_key",
                "document_versions",
                ["tenant_id", "document_id", "storage_key"],
            )


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "document_versions"):
        if _constraint_exists(bind, "document_versions", "uq_document_versions_document_storage_key"):
            op.drop_constraint("uq_document_versions_document_storage_key", "document_versions", type_="unique")
        if not _constraint_exists(bind, "document_versions", "uq_document_versions_storage_key"):
            op.create_unique_constraint("uq_document_versions_storage_key", "document_versions", ["storage_key"])

    if _table_exists(bind, "documents"):
        if _constraint_exists(bind, "documents", "uq_documents_tenant_provider_storage_path"):
            op.drop_constraint("uq_documents_tenant_provider_storage_path", "documents", type_="unique")
        if not _constraint_exists(bind, "documents", "documents_storage_path_key"):
            op.create_unique_constraint("documents_storage_path_key", "documents", ["storage_path"])
