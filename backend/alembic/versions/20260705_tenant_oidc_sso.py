"""add tenant oidc sso settings

Revision ID: 20260705_tenant_oidc
Revises: 20260704_admin_mfa
Create Date: 2026-06-12
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260705_tenant_oidc"
down_revision: Union[str, None] = "20260704_admin_mfa"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "tenant_sso_settings"):
        op.create_table(
            "tenant_sso_settings",
            sa.Column("id", sa.BigInteger().with_variant(sa.Integer, "sqlite"), primary_key=True, autoincrement=True),
            sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("provider_type", sa.String(length=20), nullable=False, server_default="oidc"),
            sa.Column("issuer_url", sa.String(length=500), nullable=True),
            sa.Column("authorization_endpoint", sa.String(length=500), nullable=True),
            sa.Column("token_endpoint", sa.String(length=500), nullable=True),
            sa.Column("userinfo_endpoint", sa.String(length=500), nullable=True),
            sa.Column("jwks_uri", sa.String(length=500), nullable=True),
            sa.Column("client_id", sa.String(length=255), nullable=True),
            sa.Column("encrypted_client_secret", sa.Text(), nullable=True),
            sa.Column("client_secret_key_version", sa.String(length=32), nullable=True),
            sa.Column("allowed_email_domains", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("auto_provision_users", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("default_role_id", sa.BigInteger(), sa.ForeignKey("roles.id", ondelete="SET NULL"), nullable=True),
            sa.Column("default_team_id", sa.BigInteger(), sa.ForeignKey("teams.id", ondelete="SET NULL"), nullable=True),
            sa.Column("email_claim", sa.String(length=100), nullable=False, server_default="email"),
            sa.Column("first_name_claim", sa.String(length=100), nullable=True),
            sa.Column("last_name_claim", sa.String(length=100), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
            sa.Column("last_test_result", sa.JSON(), nullable=True),
            sa.Column("last_successful_login_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_failed_login_reason", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint("tenant_id", name="uq_tenant_sso_settings_tenant"),
        )
        op.create_index("ix_tenant_sso_settings_enabled", "tenant_sso_settings", ["enabled"])


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "tenant_sso_settings"):
        op.drop_index("ix_tenant_sso_settings_enabled", table_name="tenant_sso_settings")
        op.drop_table("tenant_sso_settings")
