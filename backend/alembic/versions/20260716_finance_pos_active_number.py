"""make POS invoice numbers active-row scoped

Revision ID: 20260716_fin_pos_number
Revises: 20260715_catalog_slug
Create Date: 2026-06-27
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260716_fin_pos_number"
down_revision: Union[str, None] = "20260715_catalog_slug"
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
    if not _table_exists(bind, "finance_pos_invoices"):
        return
    if _index_exists(bind, "finance_pos_invoices", "ix_finance_pos_invoices_tenant_number"):
        op.drop_index("ix_finance_pos_invoices_tenant_number", table_name="finance_pos_invoices")
    if not _index_exists(bind, "finance_pos_invoices", "uq_finance_pos_invoices_active_tenant_number"):
        op.create_index(
            "uq_finance_pos_invoices_active_tenant_number",
            "finance_pos_invoices",
            ["tenant_id", "invoice_number"],
            unique=True,
            postgresql_where=sa.text("deleted_at IS NULL"),
            sqlite_where=sa.text("deleted_at IS NULL"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "finance_pos_invoices"):
        return
    if _index_exists(bind, "finance_pos_invoices", "uq_finance_pos_invoices_active_tenant_number"):
        op.drop_index("uq_finance_pos_invoices_active_tenant_number", table_name="finance_pos_invoices")
    if not _index_exists(bind, "finance_pos_invoices", "ix_finance_pos_invoices_tenant_number"):
        op.create_index("ix_finance_pos_invoices_tenant_number", "finance_pos_invoices", ["tenant_id", "invoice_number"], unique=True)
