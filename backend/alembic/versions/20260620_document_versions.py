"""add document versions and templates

Revision ID: 20260620_doc_versions
Revises: 20260619_booking_links
Create Date: 2026-05-28
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260620_doc_versions"
down_revision: Union[str, None] = "20260619_booking_links"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _column_exists(bind, table_name: str, column_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return column_name in {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def _index_exists(bind, table_name: str, index_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return index_name in {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def _constraint_exists(bind, table_name: str, constraint_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    inspector = sa.inspect(bind)
    unique_names = {constraint["name"] for constraint in inspector.get_unique_constraints(table_name)}
    foreign_names = {constraint["name"] for constraint in inspector.get_foreign_keys(table_name)}
    return constraint_name in unique_names or constraint_name in foreign_names


def upgrade() -> None:
    bind = op.get_bind()
    if not _column_exists(bind, "documents", "is_template"):
        op.add_column("documents", sa.Column("is_template", sa.Boolean(), server_default="false", nullable=False))
    if not _column_exists(bind, "documents", "template_category"):
        op.add_column("documents", sa.Column("template_category", sa.String(length=120), nullable=True))
    if not _column_exists(bind, "documents", "current_version_id"):
        op.add_column("documents", sa.Column("current_version_id", sa.BigInteger(), nullable=True))

    if not _table_exists(bind, "document_versions"):
        op.create_table(
            "document_versions",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("document_id", sa.BigInteger(), nullable=False),
            sa.Column("version_number", sa.Integer(), nullable=False),
            sa.Column("storage_key", sa.Text(), nullable=False),
            sa.Column("file_name", sa.String(length=255), nullable=False),
            sa.Column("mime_type", sa.String(length=120), nullable=False),
            sa.Column("size_bytes", sa.BigInteger(), nullable=False),
            sa.Column("checksum", sa.String(length=128), nullable=True),
            sa.Column("uploaded_by_id", sa.BigInteger(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["uploaded_by_id"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("storage_key", name="uq_document_versions_storage_key"),
            sa.UniqueConstraint("tenant_id", "document_id", "version_number", name="uq_document_versions_document_number"),
        )

    indexes = [
        ("documents", "ix_documents_is_template", ["is_template"]),
        ("documents", "ix_documents_template_category", ["template_category"]),
        ("documents", "ix_documents_current_version_id", ["current_version_id"]),
        ("document_versions", "ix_document_versions_id", ["id"]),
        ("document_versions", "ix_document_versions_tenant_id", ["tenant_id"]),
        ("document_versions", "ix_document_versions_document_id", ["document_id"]),
        ("document_versions", "ix_document_versions_uploaded_by_id", ["uploaded_by_id"]),
        ("document_versions", "ix_document_versions_created_at", ["created_at"]),
        ("document_versions", "ix_document_versions_storage_key", ["storage_key"]),
        ("document_versions", "ix_document_versions_tenant_document", ["tenant_id", "document_id"]),
    ]
    for table_name, index_name, columns in indexes:
        if not _index_exists(bind, table_name, index_name):
            op.create_index(index_name, table_name, columns, unique=False)
    if _table_exists(bind, "document_versions") and not _constraint_exists(bind, "document_versions", "uq_document_versions_storage_key"):
        op.create_unique_constraint("uq_document_versions_storage_key", "document_versions", ["storage_key"])

    if not _constraint_exists(bind, "documents", "fk_documents_current_version_id"):
        op.create_foreign_key(
            "fk_documents_current_version_id",
            "documents",
            "document_versions",
            ["current_version_id"],
            ["id"],
            ondelete="SET NULL",
        )

    op.execute(
        """
        INSERT INTO document_versions (
            tenant_id,
            document_id,
            version_number,
            storage_key,
            file_name,
            mime_type,
            size_bytes,
            uploaded_by_id,
            created_at
        )
        SELECT
            documents.tenant_id,
            documents.id,
            1,
            documents.storage_path,
            documents.original_filename,
            documents.content_type,
            documents.file_size_bytes,
            documents.uploaded_by_user_id,
            documents.created_at
        FROM documents
        WHERE NOT EXISTS (
            SELECT 1
            FROM document_versions
            WHERE document_versions.document_id = documents.id
              AND document_versions.version_number = 1
        )
        """
    )
    op.execute(
        """
        UPDATE documents
        SET current_version_id = document_versions.id
        FROM document_versions
        WHERE document_versions.document_id = documents.id
          AND document_versions.version_number = 1
          AND documents.current_version_id IS NULL
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    if _constraint_exists(bind, "documents", "fk_documents_current_version_id"):
        op.drop_constraint("fk_documents_current_version_id", "documents", type_="foreignkey")
    if _constraint_exists(bind, "document_versions", "uq_document_versions_storage_key"):
        op.drop_constraint("uq_document_versions_storage_key", "document_versions", type_="unique")
    for table_name, index_names in (
        (
            "document_versions",
            (
                "ix_document_versions_tenant_document",
                "ix_document_versions_storage_key",
                "ix_document_versions_created_at",
                "ix_document_versions_uploaded_by_id",
                "ix_document_versions_document_id",
                "ix_document_versions_tenant_id",
                "ix_document_versions_id",
            ),
        ),
        (
            "documents",
            (
                "ix_documents_current_version_id",
                "ix_documents_template_category",
                "ix_documents_is_template",
            ),
        ),
    ):
        if _table_exists(bind, table_name):
            for index_name in index_names:
                if _index_exists(bind, table_name, index_name):
                    op.drop_index(index_name, table_name=table_name)
    if _table_exists(bind, "document_versions"):
        op.drop_table("document_versions")
    for column_name in ("current_version_id", "template_category", "is_template"):
        if _column_exists(bind, "documents", column_name):
            op.drop_column("documents", column_name)
