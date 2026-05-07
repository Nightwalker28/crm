"""Add website integration catalog APIs

Revision ID: 20260520_website_integrations
Revises: 20260519_client_page_polish
Create Date: 2026-05-20 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260520_website_integrations"
down_revision: Union[str, None] = "20260519_client_page_polish"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _ensure_module(bind) -> None:
    existing = bind.execute(
        sa.text("SELECT id FROM modules WHERE name = :name"),
        {"name": "website_integrations"},
    ).scalar()
    if existing:
        module_id = existing
    else:
        bind.execute(
            sa.text(
                "INSERT INTO modules (name, base_route, description, is_enabled, import_duplicate_mode) "
                "VALUES (:name, NULL, :description, 1, 'skip')"
            ),
            {
                "name": "website_integrations",
                "description": "Public website and WordPress catalog integration APIs",
            },
        )
        module_id = bind.execute(
            sa.text("SELECT id FROM modules WHERE name = :name"),
            {"name": "website_integrations"},
        ).scalar()

    role_rows = bind.execute(sa.text("SELECT id, name FROM roles")).fetchall()
    for role_id, role_name in role_rows:
        exists = bind.execute(
            sa.text(
                "SELECT id FROM role_module_permissions "
                "WHERE role_id = :role_id AND module_id = :module_id"
            ),
            {"role_id": role_id, "module_id": module_id},
        ).scalar()
        if exists:
            continue
        can_configure = 1 if role_name in {"Admin", "Superuser"} else 0
        can_delete = 1 if role_name in {"Admin", "Superuser"} else 0
        bind.execute(
            sa.text(
                "INSERT INTO role_module_permissions "
                "(role_id, module_id, can_view, can_create, can_edit, can_delete, can_restore, can_export, can_configure) "
                "VALUES (:role_id, :module_id, 1, :can_create, :can_edit, :can_delete, 0, 1, :can_configure)"
            ),
            {
                "role_id": role_id,
                "module_id": module_id,
                "can_create": 1 if role_name in {"Admin", "Superuser"} else 0,
                "can_edit": 1 if role_name in {"Admin", "Superuser"} else 0,
                "can_delete": can_delete,
                "can_configure": can_configure,
            },
        )


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "website_integration_api_keys"):
        op.create_table(
            "website_integration_api_keys",
            sa.Column("id", sa.BigInteger(), nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("key_prefix", sa.String(length=24), nullable=False),
            sa.Column("key_hash", sa.String(length=64), nullable=False),
            sa.Column("scopes", sa.JSON(), nullable=True),
            sa.Column("allowed_origins", sa.JSON(), nullable=True),
            sa.Column("status", sa.String(length=20), server_default="active", nullable=False),
            sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_by_user_id", sa.BigInteger(), nullable=True),
            sa.Column("revoked_by_user_id", sa.BigInteger(), nullable=True),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.CheckConstraint("status IN ('active', 'revoked')", name="ck_website_integration_keys_status"),
            sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["revoked_by_user_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("key_hash", name="uq_website_integration_keys_hash"),
            sa.UniqueConstraint("tenant_id", "name", name="uq_website_integration_keys_tenant_name"),
        )
        op.create_index("ix_website_integration_api_keys_id", "website_integration_api_keys", ["id"])
        op.create_index("ix_website_integration_api_keys_tenant_id", "website_integration_api_keys", ["tenant_id"])
        op.create_index("ix_website_integration_api_keys_key_prefix", "website_integration_api_keys", ["key_prefix"])
        op.create_index("ix_website_integration_api_keys_status", "website_integration_api_keys", ["status"])
        op.create_index("ix_website_integration_api_keys_last_used_at", "website_integration_api_keys", ["last_used_at"])

    if not _table_exists(bind, "website_catalog_items"):
        op.create_table(
            "website_catalog_items",
            sa.Column("id", sa.BigInteger(), nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("item_type", sa.String(length=20), server_default="product", nullable=False),
            sa.Column("slug", sa.String(length=160), nullable=False),
            sa.Column("sku", sa.String(length=100), nullable=True),
            sa.Column("name", sa.String(length=180), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("currency", sa.String(length=3), server_default="USD", nullable=False),
            sa.Column("public_unit_price", sa.Numeric(12, 4), nullable=False),
            sa.Column("stock_status", sa.String(length=20), server_default="untracked", nullable=False),
            sa.Column("stock_quantity", sa.Numeric(12, 4), nullable=True),
            sa.Column("media_url", sa.String(length=500), nullable=True),
            sa.Column("metadata_json", sa.JSON(), nullable=True),
            sa.Column("is_public", sa.SmallInteger(), server_default="0", nullable=False),
            sa.Column("is_active", sa.SmallInteger(), server_default="1", nullable=False),
            sa.Column("created_by_user_id", sa.BigInteger(), nullable=True),
            sa.Column("updated_by_user_id", sa.BigInteger(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.CheckConstraint("item_type IN ('product', 'service', 'bundle')", name="ck_website_catalog_items_type"),
            sa.CheckConstraint(
                "stock_status IN ('untracked', 'in_stock', 'out_of_stock', 'preorder')",
                name="ck_website_catalog_items_stock_status",
            ),
            sa.CheckConstraint("public_unit_price >= 0", name="ck_website_catalog_items_public_price_nonnegative"),
            sa.CheckConstraint("stock_quantity IS NULL OR stock_quantity >= 0", name="ck_website_catalog_items_stock_nonnegative"),
            sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("tenant_id", "sku", name="uq_website_catalog_items_tenant_sku"),
            sa.UniqueConstraint("tenant_id", "slug", name="uq_website_catalog_items_tenant_slug"),
        )
        op.create_index("ix_website_catalog_items_id", "website_catalog_items", ["id"])
        op.create_index("ix_website_catalog_items_tenant_id", "website_catalog_items", ["tenant_id"])
        op.create_index("ix_website_catalog_items_slug", "website_catalog_items", ["slug"])
        op.create_index("ix_website_catalog_items_sku", "website_catalog_items", ["sku"])
        op.create_index("ix_website_catalog_items_name", "website_catalog_items", ["name"])
        op.create_index("ix_website_catalog_items_item_type", "website_catalog_items", ["item_type"])
        op.create_index("ix_website_catalog_items_stock_status", "website_catalog_items", ["stock_status"])
        op.create_index("ix_website_catalog_items_is_public", "website_catalog_items", ["is_public"])
        op.create_index("ix_website_catalog_items_is_active", "website_catalog_items", ["is_active"])
        op.create_index("ix_website_catalog_items_updated_at", "website_catalog_items", ["updated_at"])
        op.create_index(
            "ix_website_catalog_items_public_active",
            "website_catalog_items",
            ["tenant_id", "is_public", "is_active"],
        )

    _ensure_module(bind)


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "website_catalog_items"):
        op.drop_table("website_catalog_items")
    if _table_exists(bind, "website_integration_api_keys"):
        op.drop_table("website_integration_api_keys")
    module_id = bind.execute(
        sa.text("SELECT id FROM modules WHERE name = :name"),
        {"name": "website_integrations"},
    ).scalar()
    if module_id:
        bind.execute(sa.text("DELETE FROM role_module_permissions WHERE module_id = :module_id"), {"module_id": module_id})
        bind.execute(sa.text("DELETE FROM modules WHERE id = :module_id"), {"module_id": module_id})
