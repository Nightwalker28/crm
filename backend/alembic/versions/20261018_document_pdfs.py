"""Document PDFs: snapshots, per-type settings and company branding (13d §3.3)

`document_pdf_snapshots` keeps the PDF an issued document was downloaded or sent as (files
under uploads/document-pdfs/, never the public media folder). `document_settings` holds, per
document type, the printed title, default terms and notes, and the email template *Send*
starts with. `company_profiles` gains the document layout (modern, classic, compact), a brand
colour, a footer and bank details. Nothing is backfilled: no snapshot exists until a document
is downloaded, and every company starts on the modern layout.

Revision ID: 20261018_document_pdfs
Revises: 20261017_line_editor
Create Date: 2026-10-09
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20261018_document_pdfs"
down_revision: Union[str, None] = "20261017_line_editor"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "document_pdf_snapshots",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("module_key", sa.String(100), nullable=False),
        sa.Column("entity_id", sa.BigInteger(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("file_path", sa.String(500), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reason", sa.String(100), nullable=True),
        sa.Column("created_by", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("tenant_id", "module_key", "entity_id", "version", name="uq_document_pdf_snapshots_version"),
    )
    op.create_index("ix_document_pdf_snapshots_tenant_id", "document_pdf_snapshots", ["tenant_id"])
    op.create_index("ix_document_pdf_snapshots_record", "document_pdf_snapshots", ["tenant_id", "module_key", "entity_id"])
    op.create_table(
        "document_settings",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("title", sa.String(120), nullable=True),
        sa.Column("default_terms", sa.Text(), nullable=True),
        sa.Column("default_notes", sa.Text(), nullable=True),
        sa.Column("email_template_id", sa.BigInteger(), sa.ForeignKey("message_templates.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("tenant_id", "kind", name="uq_document_settings_tenant_kind"),
    )
    op.create_index("ix_document_settings_tenant_id", "document_settings", ["tenant_id"])
    op.add_column("company_profiles", sa.Column("document_layout", sa.String(20), nullable=False, server_default="modern"))
    op.add_column("company_profiles", sa.Column("brand_color", sa.String(20), nullable=True))
    op.add_column("company_profiles", sa.Column("document_footer", sa.Text(), nullable=True))
    op.add_column("company_profiles", sa.Column("bank_details", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("company_profiles", "bank_details")
    op.drop_column("company_profiles", "document_footer")
    op.drop_column("company_profiles", "brand_color")
    op.drop_column("company_profiles", "document_layout")
    op.drop_table("document_settings")
    op.drop_table("document_pdf_snapshots")
