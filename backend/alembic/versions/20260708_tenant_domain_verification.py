"""add tenant domain verification fields

Revision ID: 20260708_domain_verify
Revises: 20260707_mail_pwd_key
Create Date: 2026-06-12
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260708_domain_verify"
down_revision: Union[str, None] = "20260707_mail_pwd_key"
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


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "tenant_domains"):
        return

    if not _column_exists(bind, "tenant_domains", "status"):
        op.add_column("tenant_domains", sa.Column("status", sa.String(length=20), nullable=True))
        op.execute("UPDATE tenant_domains SET status = 'verified' WHERE status IS NULL")
        op.alter_column("tenant_domains", "status", nullable=False, server_default="pending")
    if not _column_exists(bind, "tenant_domains", "verification_token"):
        op.add_column("tenant_domains", sa.Column("verification_token", sa.String(length=96), nullable=True))
    if not _column_exists(bind, "tenant_domains", "verified_at"):
        op.add_column("tenant_domains", sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True))
        op.execute("UPDATE tenant_domains SET verified_at = CURRENT_TIMESTAMP WHERE status = 'verified' AND verified_at IS NULL")
    if not _column_exists(bind, "tenant_domains", "updated_at"):
        op.add_column("tenant_domains", sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True))

    if not _index_exists(bind, "tenant_domains", "ix_tenant_domains_verification_token"):
        op.create_index("ix_tenant_domains_verification_token", "tenant_domains", ["verification_token"], unique=True)
    if not _index_exists(bind, "tenant_domains", "ix_tenant_domains_status"):
        op.create_index("ix_tenant_domains_status", "tenant_domains", ["status"])


def downgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "tenant_domains"):
        return
    if _index_exists(bind, "tenant_domains", "ix_tenant_domains_status"):
        op.drop_index("ix_tenant_domains_status", table_name="tenant_domains")
    if _index_exists(bind, "tenant_domains", "ix_tenant_domains_verification_token"):
        op.drop_index("ix_tenant_domains_verification_token", table_name="tenant_domains")
    for column_name in ("updated_at", "verified_at", "verification_token", "status"):
        if _column_exists(bind, "tenant_domains", column_name):
            op.drop_column("tenant_domains", column_name)
