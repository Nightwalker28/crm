"""make catalog slug uniqueness active-row scoped

Revision ID: 20260715_catalog_slug
Revises: 20260714_contract_numbers
Create Date: 2026-06-27
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260715_catalog_slug"
down_revision: Union[str, None] = "20260714_contract_numbers"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _unique_constraint_exists(bind, table_name: str, constraint_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return constraint_name in {constraint["name"] for constraint in sa.inspect(bind).get_unique_constraints(table_name)}


def _index_exists(bind, table_name: str, index_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return index_name in {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def _drop_unique_constraint_if_exists(bind, table_name: str, constraint_name: str) -> None:
    if _unique_constraint_exists(bind, table_name, constraint_name):
        op.drop_constraint(constraint_name, table_name, type_="unique")


def _create_active_slug_index_if_missing(bind, table_name: str, index_name: str) -> None:
    if _table_exists(bind, table_name) and not _index_exists(bind, table_name, index_name):
        op.create_index(
            index_name,
            table_name,
            ["tenant_id", "slug"],
            unique=True,
            postgresql_where=sa.text("deleted_at IS NULL AND slug IS NOT NULL"),
            sqlite_where=sa.text("deleted_at IS NULL AND slug IS NOT NULL"),
        )


def upgrade() -> None:
    bind = op.get_bind()
    _drop_unique_constraint_if_exists(bind, "catalog_products", "uq_catalog_products_tenant_slug")
    _drop_unique_constraint_if_exists(bind, "catalog_services", "uq_catalog_services_tenant_slug")
    _create_active_slug_index_if_missing(bind, "catalog_products", "uq_catalog_products_active_tenant_slug")
    _create_active_slug_index_if_missing(bind, "catalog_services", "uq_catalog_services_active_tenant_slug")


def downgrade() -> None:
    bind = op.get_bind()
    for table_name, index_name in (
        ("catalog_products", "uq_catalog_products_active_tenant_slug"),
        ("catalog_services", "uq_catalog_services_active_tenant_slug"),
    ):
        if _index_exists(bind, table_name, index_name):
            op.drop_index(index_name, table_name=table_name)

    if _table_exists(bind, "catalog_products") and not _unique_constraint_exists(bind, "catalog_products", "uq_catalog_products_tenant_slug"):
        op.create_unique_constraint("uq_catalog_products_tenant_slug", "catalog_products", ["tenant_id", "slug"])
    if _table_exists(bind, "catalog_services") and not _unique_constraint_exists(bind, "catalog_services", "uq_catalog_services_tenant_slug"):
        op.create_unique_constraint("uq_catalog_services_tenant_slug", "catalog_services", ["tenant_id", "slug"])
