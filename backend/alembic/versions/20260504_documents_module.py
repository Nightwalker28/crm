"""Add documents module storage

Revision ID: 20260504_documents_module
Revises: 20260503_mail_imap_smtp
Create Date: 2026-05-04
"""

from alembic import op
import sqlalchemy as sa


revision = "20260504_documents_module"
down_revision = "20260503_mail_imap_smtp"
branch_labels = None
depends_on = None


def _table_exists(bind, table_name: str) -> bool:
    return sa.inspect(bind).has_table(table_name)


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "documents"):
        op.create_table(
            "documents",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("uploaded_by_user_id", sa.BigInteger(), nullable=True),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("original_filename", sa.String(length=255), nullable=False),
            sa.Column("content_type", sa.String(length=120), nullable=False),
            sa.Column("extension", sa.String(length=20), nullable=False),
            sa.Column("file_size_bytes", sa.BigInteger(), nullable=False),
            sa.Column("storage_path", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["uploaded_by_user_id"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("storage_path"),
        )
        op.create_index("ix_documents_id", "documents", ["id"])
        op.create_index("ix_documents_tenant_id", "documents", ["tenant_id"])
        op.create_index("ix_documents_uploaded_by_user_id", "documents", ["uploaded_by_user_id"])
        op.create_index("ix_documents_title", "documents", ["title"])
        op.create_index("ix_documents_extension", "documents", ["extension"])
        op.create_index("ix_documents_created_at", "documents", ["created_at"])
        op.create_index("ix_documents_deleted_at", "documents", ["deleted_at"])

    if not _table_exists(bind, "document_links"):
        op.create_table(
            "document_links",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("document_id", sa.BigInteger(), nullable=False),
            sa.Column("module_key", sa.String(length=100), nullable=False),
            sa.Column("entity_id", sa.String(length=100), nullable=False),
            sa.Column("created_by_user_id", sa.BigInteger(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("tenant_id", "document_id", "module_key", "entity_id", name="uq_document_links_document_record"),
        )
        op.create_index("ix_document_links_id", "document_links", ["id"])
        op.create_index("ix_document_links_tenant_id", "document_links", ["tenant_id"])
        op.create_index("ix_document_links_document_id", "document_links", ["document_id"])
        op.create_index("ix_document_links_module_key", "document_links", ["module_key"])
        op.create_index("ix_document_links_entity_id", "document_links", ["entity_id"])
        op.create_index("ix_document_links_created_by_user_id", "document_links", ["created_by_user_id"])

    module_table = sa.table(
        "modules",
        sa.column("name", sa.String),
        sa.column("base_route", sa.String),
        sa.column("description", sa.Text),
        sa.column("is_enabled", sa.SmallInteger),
    )
    existing = bind.execute(sa.text("SELECT id FROM modules WHERE name = 'documents'")).first()
    if existing is None:
        op.bulk_insert(
            module_table,
            [
                {
                    "name": "documents",
                    "base_route": "/dashboard/documents",
                    "description": "Controlled document uploads and record-linked files",
                    "is_enabled": 1,
                }
            ],
        )
    else:
        bind.execute(
            sa.text(
                "UPDATE modules SET base_route = :base_route, description = :description WHERE name = 'documents'"
            ),
            {
                "base_route": "/dashboard/documents",
                "description": "Controlled document uploads and record-linked files",
            },
        )

    bind.execute(
        sa.text(
            """
            INSERT INTO department_module_permissions (department_id, module_id)
            SELECT d.id, m.id
            FROM departments d
            CROSS JOIN modules m
            WHERE m.name = 'documents'
              AND NOT EXISTS (
                SELECT 1 FROM department_module_permissions existing
                WHERE existing.department_id = d.id AND existing.module_id = m.id
              )
            """
        )
    )
    bind.execute(
        sa.text(
            """
            INSERT INTO team_module_permissions (team_id, module_id)
            SELECT t.id, m.id
            FROM teams t
            CROSS JOIN modules m
            WHERE m.name = 'documents'
              AND NOT EXISTS (
                SELECT 1 FROM team_module_permissions existing
                WHERE existing.team_id = t.id AND existing.module_id = m.id
              )
            """
        )
    )
    bind.execute(
        sa.text(
            """
            INSERT INTO role_module_permissions (
                role_id,
                module_id,
                can_view,
                can_create,
                can_edit,
                can_delete,
                can_restore,
                can_export,
                can_configure
            )
            SELECT
                r.id,
                m.id,
                1,
                1,
                1,
                CASE WHEN r.level >= 90 THEN 1 ELSE 0 END,
                CASE WHEN r.level >= 90 THEN 1 ELSE 0 END,
                CASE WHEN r.level >= 90 THEN 1 ELSE 0 END,
                CASE WHEN r.level >= 100 THEN 1 ELSE 0 END
            FROM roles r
            CROSS JOIN modules m
            WHERE m.name = 'documents'
              AND NOT EXISTS (
                SELECT 1 FROM role_module_permissions existing
                WHERE existing.role_id = r.id AND existing.module_id = m.id
              )
            """
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "document_links"):
        op.drop_table("document_links")
    if _table_exists(bind, "documents"):
        op.drop_table("documents")
