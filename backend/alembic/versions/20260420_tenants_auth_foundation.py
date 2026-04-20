"""add tenant foundation for cloud auth

Revision ID: 20260420_tenants_auth_foundation
Revises: 20260420_data_transfer_progress
Create Date: 2026-04-20
"""

from alembic import op
import sqlalchemy as sa


revision = "20260420_tenants_auth_foundation"
down_revision = "20260420_data_transfer_progress"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tenants",
        sa.Column("id", sa.BigInteger(), primary_key=True, nullable=False),
        sa.Column("slug", sa.String(length=120), nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("is_active", sa.SmallInteger(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.UniqueConstraint("slug", name="uq_tenants_slug"),
    )
    op.create_index("ix_tenants_id", "tenants", ["id"])
    op.create_index("ix_tenants_slug", "tenants", ["slug"])

    op.create_table(
        "tenant_domains",
        sa.Column("id", sa.BigInteger(), primary_key=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("hostname", sa.String(length=255), nullable=False),
        sa.Column("is_primary", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.UniqueConstraint("hostname", name="uq_tenant_domains_hostname"),
    )
    op.create_index("ix_tenant_domains_id", "tenant_domains", ["id"])
    op.create_index("ix_tenant_domains_tenant_id", "tenant_domains", ["tenant_id"])
    op.create_index("ix_tenant_domains_hostname", "tenant_domains", ["hostname"])

    op.add_column("users", sa.Column("tenant_id", sa.BigInteger(), nullable=True))
    op.create_index("ix_users_tenant_id", "users", ["tenant_id"])
    op.create_foreign_key(
        "fk_users_tenant_id_tenants",
        "users",
        "tenants",
        ["tenant_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.execute(
        """
        INSERT INTO tenants (id, slug, name, is_active)
        VALUES (1, 'default', 'Default Tenant', 1)
        ON CONFLICT (id) DO NOTHING
        """
    )
    op.execute("UPDATE users SET tenant_id = 1 WHERE tenant_id IS NULL")

    op.alter_column("users", "tenant_id", nullable=False)
    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key")
    op.create_unique_constraint("uq_users_tenant_email", "users", ["tenant_id", "email"])


def downgrade() -> None:
    op.drop_constraint("uq_users_tenant_email", "users", type_="unique")
    op.drop_constraint("fk_users_tenant_id_tenants", "users", type_="foreignkey")
    op.drop_index("ix_users_tenant_id", table_name="users")
    op.drop_column("users", "tenant_id")

    op.drop_index("ix_tenant_domains_hostname", table_name="tenant_domains")
    op.drop_index("ix_tenant_domains_tenant_id", table_name="tenant_domains")
    op.drop_index("ix_tenant_domains_id", table_name="tenant_domains")
    op.drop_table("tenant_domains")

    op.drop_index("ix_tenants_slug", table_name="tenants")
    op.drop_index("ix_tenants_id", table_name="tenants")
    op.drop_table("tenants")

    op.create_unique_constraint("users_email_key", "users", ["email"])
