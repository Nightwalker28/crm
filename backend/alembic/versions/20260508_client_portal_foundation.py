"""Add client portal access foundation

Revision ID: 20260508_client_portal
Revises: 20260507_followups
Create Date: 2026-05-08 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260508_client_portal"
down_revision: Union[str, None] = "20260507_followups"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _column_exists(bind, table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "customer_groups"):
        op.create_table(
            "customer_groups",
            sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
            sa.Column("group_key", sa.String(length=80), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("discount_type", sa.String(length=20), nullable=False, server_default="none"),
            sa.Column("discount_value", sa.Numeric(10, 4), nullable=True),
            sa.Column("is_default", sa.SmallInteger(), nullable=False, server_default="0"),
            sa.Column("is_active", sa.SmallInteger(), nullable=False, server_default="1"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint("tenant_id", "group_key", name="uq_customer_groups_tenant_key"),
        )
        op.create_index("ix_customer_groups_tenant_id", "customer_groups", ["tenant_id"])
        op.create_index("ix_customer_groups_group_key", "customer_groups", ["group_key"])
        op.create_index("ix_customer_groups_is_default", "customer_groups", ["is_default"])
        op.create_index("ix_customer_groups_is_active", "customer_groups", ["is_active"])
        op.execute(
            """
            INSERT INTO customer_groups (tenant_id, group_key, name, discount_type, discount_value, is_default, is_active)
            SELECT tenants.id, seed.group_key, seed.name, seed.discount_type, seed.discount_value, seed.is_default, 1
            FROM tenants
            CROSS JOIN (
                VALUES
                    ('default', 'Default', 'none', NULL, 1),
                    ('wholesale', 'Wholesale', 'percent', 0, 0),
                    ('retailer', 'Retailer', 'percent', 0, 0),
                    ('vip', 'VIP', 'percent', 0, 0),
                    ('friends_family', 'Friends & Family', 'percent', 0, 0)
            ) AS seed(group_key, name, discount_type, discount_value, is_default)
            ON CONFLICT (tenant_id, group_key) DO NOTHING
            """
        )

    if not _column_exists(bind, "sales_contacts", "customer_group_id"):
        op.add_column("sales_contacts", sa.Column("customer_group_id", sa.BigInteger(), nullable=True))
        op.create_index("ix_sales_contacts_customer_group_id", "sales_contacts", ["customer_group_id"])
        op.create_foreign_key(
            "fk_sales_contacts_customer_group_id_customer_groups",
            "sales_contacts",
            "customer_groups",
            ["customer_group_id"],
            ["id"],
            ondelete="SET NULL",
        )

    if not _column_exists(bind, "sales_organizations", "customer_group_id"):
        op.add_column("sales_organizations", sa.Column("customer_group_id", sa.BigInteger(), nullable=True))
        op.create_index("ix_sales_organizations_customer_group_id", "sales_organizations", ["customer_group_id"])
        op.create_foreign_key(
            "fk_sales_organizations_customer_group_id_customer_groups",
            "sales_organizations",
            "customer_groups",
            ["customer_group_id"],
            ["id"],
            ondelete="SET NULL",
        )

    if not _table_exists(bind, "client_accounts"):
        op.create_table(
            "client_accounts",
            sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
            sa.Column("contact_id", sa.BigInteger(), sa.ForeignKey("sales_contacts.contact_id", ondelete="CASCADE"), nullable=True),
            sa.Column("organization_id", sa.BigInteger(), sa.ForeignKey("sales_organizations.org_id", ondelete="CASCADE"), nullable=True),
            sa.Column("email", sa.String(length=150), nullable=False),
            sa.Column("password_hash", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
            sa.Column("setup_token_hash", sa.String(length=64), nullable=True),
            sa.Column("setup_token_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_by_user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("updated_by_user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.CheckConstraint(
                "(contact_id IS NOT NULL AND organization_id IS NULL) OR "
                "(contact_id IS NULL AND organization_id IS NOT NULL)",
                name="ck_client_accounts_one_linked_record",
            ),
            sa.UniqueConstraint("tenant_id", "email", name="uq_client_accounts_tenant_email"),
        )
        op.create_index("ix_client_accounts_tenant_id", "client_accounts", ["tenant_id"])
        op.create_index("ix_client_accounts_contact_id", "client_accounts", ["contact_id"])
        op.create_index("ix_client_accounts_organization_id", "client_accounts", ["organization_id"])
        op.create_index("ix_client_accounts_email", "client_accounts", ["email"])
        op.create_index("ix_client_accounts_status", "client_accounts", ["status"])
        op.create_index("ix_client_accounts_setup_token_hash", "client_accounts", ["setup_token_hash"], unique=True)
        op.create_index("ix_client_accounts_created_by_user_id", "client_accounts", ["created_by_user_id"])
        op.create_index("ix_client_accounts_updated_by_user_id", "client_accounts", ["updated_by_user_id"])


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "client_accounts"):
        op.drop_index("ix_client_accounts_updated_by_user_id", table_name="client_accounts")
        op.drop_index("ix_client_accounts_created_by_user_id", table_name="client_accounts")
        op.drop_index("ix_client_accounts_setup_token_hash", table_name="client_accounts")
        op.drop_index("ix_client_accounts_status", table_name="client_accounts")
        op.drop_index("ix_client_accounts_email", table_name="client_accounts")
        op.drop_index("ix_client_accounts_organization_id", table_name="client_accounts")
        op.drop_index("ix_client_accounts_contact_id", table_name="client_accounts")
        op.drop_index("ix_client_accounts_tenant_id", table_name="client_accounts")
        op.drop_table("client_accounts")

    if _column_exists(bind, "sales_organizations", "customer_group_id"):
        op.drop_constraint("fk_sales_organizations_customer_group_id_customer_groups", "sales_organizations", type_="foreignkey")
        op.drop_index("ix_sales_organizations_customer_group_id", table_name="sales_organizations")
        op.drop_column("sales_organizations", "customer_group_id")

    if _column_exists(bind, "sales_contacts", "customer_group_id"):
        op.drop_constraint("fk_sales_contacts_customer_group_id_customer_groups", "sales_contacts", type_="foreignkey")
        op.drop_index("ix_sales_contacts_customer_group_id", table_name="sales_contacts")
        op.drop_column("sales_contacts", "customer_group_id")

    if _table_exists(bind, "customer_groups"):
        op.drop_index("ix_customer_groups_is_active", table_name="customer_groups")
        op.drop_index("ix_customer_groups_is_default", table_name="customer_groups")
        op.drop_index("ix_customer_groups_group_key", table_name="customer_groups")
        op.drop_index("ix_customer_groups_tenant_id", table_name="customer_groups")
        op.drop_table("customer_groups")
