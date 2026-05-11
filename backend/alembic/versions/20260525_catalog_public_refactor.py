"""move website catalog publishing onto catalog modules

Revision ID: 20260525_catalog_public_refactor
Revises: 20260524_catalog_services
Create Date: 2026-05-12
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260525_catalog_public_refactor"
down_revision: Union[str, None] = "20260524_catalog_services"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(bind, table_name: str) -> set[str]:
    return {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def _tables(bind) -> set[str]:
    return set(sa.inspect(bind).get_table_names())


def upgrade() -> None:
    bind = op.get_bind()
    tables = _tables(bind)

    product_columns = _columns(bind, "catalog_products")
    if "slug" not in product_columns:
        op.add_column("catalog_products", sa.Column("slug", sa.String(length=160), nullable=True))
        op.create_index("ix_catalog_products_slug", "catalog_products", ["slug"])
        op.create_unique_constraint("uq_catalog_products_tenant_slug", "catalog_products", ["tenant_id", "slug"])
    if "is_public" not in product_columns:
        op.add_column("catalog_products", sa.Column("is_public", sa.SmallInteger(), server_default="0", nullable=False))
        op.create_index("ix_catalog_products_is_public", "catalog_products", ["is_public"])

    service_columns = _columns(bind, "catalog_services")
    if "slug" not in service_columns:
        op.add_column("catalog_services", sa.Column("slug", sa.String(length=160), nullable=True))
        op.create_index("ix_catalog_services_slug", "catalog_services", ["slug"])
        op.create_unique_constraint("uq_catalog_services_tenant_slug", "catalog_services", ["tenant_id", "slug"])
    if "is_public" not in service_columns:
        op.add_column("catalog_services", sa.Column("is_public", sa.SmallInteger(), server_default="0", nullable=False))
        op.create_index("ix_catalog_services_is_public", "catalog_services", ["is_public"])

    bind.execute(
        sa.text(
            """
            UPDATE catalog_products
            SET slug = LEFT(TRIM(BOTH '-' FROM regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')) || '-' || id, 160)
            WHERE slug IS NULL
            """
        )
    )
    bind.execute(
        sa.text(
            """
            UPDATE catalog_services
            SET slug = LEFT(TRIM(BOTH '-' FROM regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')) || '-' || id, 160)
            WHERE slug IS NULL
            """
        )
    )

    if "website_catalog_items" in tables:
        bind.execute(
            sa.text(
                """
                INSERT INTO catalog_products (
                    tenant_id, name, slug, description, sku, currency, public_unit_price,
                    stock_status, stock_quantity, is_public, is_active, created_by_user_id,
                    updated_by_user_id, created_at, updated_at
                )
                SELECT
                    tenant_id, name, slug, description, sku, currency, public_unit_price,
                    stock_status, stock_quantity, is_public, is_active, created_by_user_id,
                    updated_by_user_id, created_at, updated_at
                FROM website_catalog_items
                WHERE item_type = 'product'
                ON CONFLICT DO NOTHING
                """
            )
        )
        bind.execute(
            sa.text(
                """
                INSERT INTO catalog_services (
                    tenant_id, name, slug, description, currency, public_unit_price,
                    is_public, is_active, created_by_user_id, updated_by_user_id,
                    created_at, updated_at
                )
                SELECT
                    tenant_id, name, slug, description, currency, public_unit_price,
                    is_public, is_active, created_by_user_id, updated_by_user_id,
                    created_at, updated_at
                FROM website_catalog_items
                WHERE item_type = 'service'
                ON CONFLICT DO NOTHING
                """
            )
        )

    line_columns = _columns(bind, "website_integration_order_lines")
    if "catalog_product_id" not in line_columns:
        op.add_column("website_integration_order_lines", sa.Column("catalog_product_id", sa.BigInteger(), nullable=True))
        op.create_index("ix_website_integration_order_lines_catalog_product_id", "website_integration_order_lines", ["catalog_product_id"])
        op.create_foreign_key(
            "fk_website_order_lines_catalog_product_id",
            "website_integration_order_lines",
            "catalog_products",
            ["catalog_product_id"],
            ["id"],
            ondelete="SET NULL",
        )
    if "catalog_service_id" not in line_columns:
        op.add_column("website_integration_order_lines", sa.Column("catalog_service_id", sa.BigInteger(), nullable=True))
        op.create_index("ix_website_integration_order_lines_catalog_service_id", "website_integration_order_lines", ["catalog_service_id"])
        op.create_foreign_key(
            "fk_website_order_lines_catalog_service_id",
            "website_integration_order_lines",
            "catalog_services",
            ["catalog_service_id"],
            ["id"],
            ondelete="SET NULL",
        )
    if "item_type" not in line_columns:
        op.add_column("website_integration_order_lines", sa.Column("item_type", sa.String(length=20), server_default="product", nullable=False))

    if "website_catalog_items" in tables:
        bind.execute(
            sa.text(
                """
                UPDATE website_integration_order_lines AS lines
                SET catalog_product_id = products.id,
                    item_type = 'product'
                FROM website_catalog_items AS legacy
                JOIN catalog_products AS products
                  ON products.tenant_id = legacy.tenant_id
                 AND products.slug = legacy.slug
                WHERE lines.catalog_item_id = legacy.id
                  AND legacy.item_type = 'product'
                  AND lines.catalog_product_id IS NULL
                """
            )
        )
        bind.execute(
            sa.text(
                """
                UPDATE website_integration_order_lines AS lines
                SET catalog_service_id = services.id,
                    item_type = 'service'
                FROM website_catalog_items AS legacy
                JOIN catalog_services AS services
                  ON services.tenant_id = legacy.tenant_id
                 AND services.slug = legacy.slug
                WHERE lines.catalog_item_id = legacy.id
                  AND legacy.item_type = 'service'
                  AND lines.catalog_service_id IS NULL
                """
            )
        )


def downgrade() -> None:
    bind = op.get_bind()
    line_columns = _columns(bind, "website_integration_order_lines")
    if "item_type" in line_columns:
        op.drop_column("website_integration_order_lines", "item_type")
    if "catalog_service_id" in line_columns:
        op.drop_constraint("fk_website_order_lines_catalog_service_id", "website_integration_order_lines", type_="foreignkey")
        op.drop_index("ix_website_integration_order_lines_catalog_service_id", table_name="website_integration_order_lines")
        op.drop_column("website_integration_order_lines", "catalog_service_id")
    if "catalog_product_id" in line_columns:
        op.drop_constraint("fk_website_order_lines_catalog_product_id", "website_integration_order_lines", type_="foreignkey")
        op.drop_index("ix_website_integration_order_lines_catalog_product_id", table_name="website_integration_order_lines")
        op.drop_column("website_integration_order_lines", "catalog_product_id")

    service_columns = _columns(bind, "catalog_services")
    if "is_public" in service_columns:
        op.drop_index("ix_catalog_services_is_public", table_name="catalog_services")
        op.drop_column("catalog_services", "is_public")
    if "slug" in service_columns:
        op.drop_constraint("uq_catalog_services_tenant_slug", "catalog_services", type_="unique")
        op.drop_index("ix_catalog_services_slug", table_name="catalog_services")
        op.drop_column("catalog_services", "slug")

    product_columns = _columns(bind, "catalog_products")
    if "is_public" in product_columns:
        op.drop_index("ix_catalog_products_is_public", table_name="catalog_products")
        op.drop_column("catalog_products", "is_public")
    if "slug" in product_columns:
        op.drop_constraint("uq_catalog_products_tenant_slug", "catalog_products", type_="unique")
        op.drop_index("ix_catalog_products_slug", table_name="catalog_products")
        op.drop_column("catalog_products", "slug")
