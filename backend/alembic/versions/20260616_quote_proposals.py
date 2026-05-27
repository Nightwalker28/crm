"""add sales quote proposal tracking

Revision ID: 20260616_quote_proposals
Revises: 20260615_automation_rules
Create Date: 2026-05-27
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260616_quote_proposals"
down_revision: Union[str, None] = "20260615_automation_rules"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _index_exists(bind, table_name: str, index_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return index_name in {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "sales_quote_documents"):
        op.create_table(
            "sales_quote_documents",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("quote_id", sa.BigInteger(), nullable=False),
            sa.Column("document_id", sa.BigInteger(), nullable=True),
            sa.Column("template_name", sa.Text(), server_default="default_quote_proposal", nullable=False),
            sa.Column("status", sa.Text(), server_default="generated", nullable=False),
            sa.Column("title", sa.Text(), nullable=False),
            sa.Column("content_text", sa.Text(), nullable=False),
            sa.Column("public_token_hash", sa.Text(), nullable=True),
            sa.Column("public_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("sent_to", sa.Text(), nullable=True),
            sa.Column("generated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_by_id", sa.BigInteger(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.CheckConstraint("status IN ('generated', 'sent', 'expired')", name="ck_sales_quote_documents_status"),
            sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["quote_id"], ["sales_quotes.quote_id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("public_token_hash"),
        )
    if not _table_exists(bind, "sales_quote_open_events"):
        op.create_table(
            "sales_quote_open_events",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("quote_id", sa.BigInteger(), nullable=False),
            sa.Column("quote_document_id", sa.Integer(), nullable=False),
            sa.Column("event_type", sa.Text(), nullable=False),
            sa.Column("recipient_email", sa.Text(), nullable=True),
            sa.Column("ip_hash", sa.Text(), nullable=True),
            sa.Column("user_agent_hash", sa.Text(), nullable=True),
            sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.CheckConstraint("event_type IN ('sent', 'opened', 'viewed', 'downloaded')", name="ck_sales_quote_open_events_type"),
            sa.ForeignKeyConstraint(["quote_document_id"], ["sales_quote_documents.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["quote_id"], ["sales_quotes.quote_id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )

    indexes = [
        ("sales_quote_documents", "ix_sales_quote_documents_id", ["id"]),
        ("sales_quote_documents", "ix_sales_quote_documents_tenant_id", ["tenant_id"]),
        ("sales_quote_documents", "ix_sales_quote_documents_quote_id", ["quote_id"]),
        ("sales_quote_documents", "ix_sales_quote_documents_document_id", ["document_id"]),
        ("sales_quote_documents", "ix_sales_quote_documents_tenant_quote", ["tenant_id", "quote_id"]),
        ("sales_quote_documents", "ix_sales_quote_documents_tenant_status", ["tenant_id", "status"]),
        ("sales_quote_documents", "ix_sales_quote_documents_token_hash", ["public_token_hash"]),
        ("sales_quote_open_events", "ix_sales_quote_open_events_id", ["id"]),
        ("sales_quote_open_events", "ix_sales_quote_open_events_tenant_id", ["tenant_id"]),
        ("sales_quote_open_events", "ix_sales_quote_open_events_quote_id", ["quote_id"]),
        ("sales_quote_open_events", "ix_sales_quote_open_events_quote_document_id", ["quote_document_id"]),
        ("sales_quote_open_events", "ix_sales_quote_open_events_document", ["quote_document_id"]),
        ("sales_quote_open_events", "ix_sales_quote_open_events_tenant_quote", ["tenant_id", "quote_id"]),
        ("sales_quote_open_events", "ix_sales_quote_open_events_occurred", ["tenant_id", "occurred_at"]),
    ]
    for table_name, index_name, columns in indexes:
        if not _index_exists(bind, table_name, index_name):
            op.create_index(index_name, table_name, columns, unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    for table_name, index_names in (
        (
            "sales_quote_open_events",
            (
                "ix_sales_quote_open_events_occurred",
                "ix_sales_quote_open_events_tenant_quote",
                "ix_sales_quote_open_events_document",
                "ix_sales_quote_open_events_quote_document_id",
                "ix_sales_quote_open_events_quote_id",
                "ix_sales_quote_open_events_tenant_id",
                "ix_sales_quote_open_events_id",
            ),
        ),
        (
            "sales_quote_documents",
            (
                "ix_sales_quote_documents_token_hash",
                "ix_sales_quote_documents_tenant_status",
                "ix_sales_quote_documents_tenant_quote",
                "ix_sales_quote_documents_document_id",
                "ix_sales_quote_documents_quote_id",
                "ix_sales_quote_documents_tenant_id",
                "ix_sales_quote_documents_id",
            ),
        ),
    ):
        if _table_exists(bind, table_name):
            for index_name in index_names:
                if _index_exists(bind, table_name, index_name):
                    op.drop_index(index_name, table_name=table_name)
    for table_name in ("sales_quote_open_events", "sales_quote_documents"):
        if _table_exists(bind, table_name):
            op.drop_table(table_name)
