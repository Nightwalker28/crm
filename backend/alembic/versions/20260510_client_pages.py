"""Add client pages and public action records

Revision ID: 20260510_client_pages
Revises: 20260509_client_portal_hardening
Create Date: 2026-05-10 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260510_client_pages"
down_revision: Union[str, None] = "20260509_client_portal_hardening"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "client_pages"):
        op.create_table(
            "client_pages",
            sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
            sa.Column("contact_id", sa.BigInteger(), sa.ForeignKey("sales_contacts.contact_id", ondelete="CASCADE"), nullable=True),
            sa.Column("organization_id", sa.BigInteger(), sa.ForeignKey("sales_organizations.org_id", ondelete="CASCADE"), nullable=True),
            sa.Column("title", sa.String(length=180), nullable=False),
            sa.Column("summary", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
            sa.Column("pricing_items", sa.JSON(), nullable=False),
            sa.Column("document_ids", sa.JSON(), nullable=True),
            sa.Column("source_module_key", sa.String(length=100), nullable=True),
            sa.Column("source_entity_id", sa.String(length=100), nullable=True),
            sa.Column("public_token_hash", sa.String(length=64), nullable=True),
            sa.Column("public_token_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_by_user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("updated_by_user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.CheckConstraint(
                "(contact_id IS NOT NULL AND organization_id IS NULL) OR "
                "(contact_id IS NULL AND organization_id IS NOT NULL)",
                name="ck_client_pages_one_linked_record",
            ),
            sa.CheckConstraint("status IN ('draft', 'published', 'archived')", name="ck_client_pages_status"),
        )
        op.create_index("ix_client_pages_tenant_id", "client_pages", ["tenant_id"])
        op.create_index("ix_client_pages_contact_id", "client_pages", ["contact_id"])
        op.create_index("ix_client_pages_organization_id", "client_pages", ["organization_id"])
        op.create_index("ix_client_pages_status", "client_pages", ["status"])
        op.create_index("ix_client_pages_source_module_key", "client_pages", ["source_module_key"])
        op.create_index("ix_client_pages_source_entity_id", "client_pages", ["source_entity_id"])
        op.create_index("ix_client_pages_public_token_hash", "client_pages", ["public_token_hash"], unique=True)
        op.create_index("ix_client_pages_created_by_user_id", "client_pages", ["created_by_user_id"])
        op.create_index("ix_client_pages_updated_by_user_id", "client_pages", ["updated_by_user_id"])

    if not _table_exists(bind, "client_page_actions"):
        op.create_table(
            "client_page_actions",
            sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
            sa.Column("client_page_id", sa.BigInteger(), sa.ForeignKey("client_pages.id", ondelete="CASCADE"), nullable=False),
            sa.Column("client_account_id", sa.BigInteger(), sa.ForeignKey("client_accounts.id", ondelete="SET NULL"), nullable=True),
            sa.Column("action", sa.String(length=30), nullable=False),
            sa.Column("message", sa.Text(), nullable=True),
            sa.Column("actor_name", sa.String(length=150), nullable=True),
            sa.Column("actor_email", sa.String(length=150), nullable=True),
            sa.Column("request_metadata", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.CheckConstraint("action IN ('accept', 'request_changes')", name="ck_client_page_actions_action"),
        )
        op.create_index("ix_client_page_actions_tenant_id", "client_page_actions", ["tenant_id"])
        op.create_index("ix_client_page_actions_client_page_id", "client_page_actions", ["client_page_id"])
        op.create_index("ix_client_page_actions_client_account_id", "client_page_actions", ["client_account_id"])
        op.create_index("ix_client_page_actions_action", "client_page_actions", ["action"])
        op.create_index("ix_client_page_actions_created_at", "client_page_actions", ["created_at"])


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "client_page_actions"):
        op.drop_index("ix_client_page_actions_created_at", table_name="client_page_actions")
        op.drop_index("ix_client_page_actions_action", table_name="client_page_actions")
        op.drop_index("ix_client_page_actions_client_account_id", table_name="client_page_actions")
        op.drop_index("ix_client_page_actions_client_page_id", table_name="client_page_actions")
        op.drop_index("ix_client_page_actions_tenant_id", table_name="client_page_actions")
        op.drop_table("client_page_actions")
    if _table_exists(bind, "client_pages"):
        op.drop_index("ix_client_pages_updated_by_user_id", table_name="client_pages")
        op.drop_index("ix_client_pages_created_by_user_id", table_name="client_pages")
        op.drop_index("ix_client_pages_public_token_hash", table_name="client_pages")
        op.drop_index("ix_client_pages_source_entity_id", table_name="client_pages")
        op.drop_index("ix_client_pages_source_module_key", table_name="client_pages")
        op.drop_index("ix_client_pages_status", table_name="client_pages")
        op.drop_index("ix_client_pages_organization_id", table_name="client_pages")
        op.drop_index("ix_client_pages_contact_id", table_name="client_pages")
        op.drop_index("ix_client_pages_tenant_id", table_name="client_pages")
        op.drop_table("client_pages")
