"""add client portal document shares

Revision ID: 20260702_client_docs
Revises: 20260701_client_support
Create Date: 2026-06-11
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260702_client_docs"
down_revision: Union[str, None] = "20260701_client_support"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "document_client_shares"):
        op.create_table(
            "document_client_shares",
            sa.Column("id", sa.BigInteger().with_variant(sa.Integer, "sqlite"), primary_key=True, autoincrement=True),
            sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("document_id", sa.BigInteger(), sa.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("contact_id", sa.BigInteger(), sa.ForeignKey("sales_contacts.contact_id", ondelete="CASCADE"), nullable=True, index=True),
            sa.Column("organization_id", sa.BigInteger(), sa.ForeignKey("sales_organizations.org_id", ondelete="CASCADE"), nullable=True, index=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True, index=True),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True, index=True),
            sa.Column("created_by_user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.CheckConstraint("contact_id IS NOT NULL OR organization_id IS NOT NULL", name="ck_document_client_shares_target"),
        )
        op.create_index("ix_document_client_shares_tenant_document", "document_client_shares", ["tenant_id", "document_id"])
        op.create_index("ix_document_client_shares_tenant_contact", "document_client_shares", ["tenant_id", "contact_id"])
        op.create_index("ix_document_client_shares_tenant_org", "document_client_shares", ["tenant_id", "organization_id"])


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "document_client_shares"):
        op.drop_index("ix_document_client_shares_tenant_org", table_name="document_client_shares")
        op.drop_index("ix_document_client_shares_tenant_contact", table_name="document_client_shares")
        op.drop_index("ix_document_client_shares_tenant_document", table_name="document_client_shares")
        op.drop_table("document_client_shares")
