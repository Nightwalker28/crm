"""Invoice lines get tenant_id, like every other document line table (13a I1).

Tenant backups filter every exported table by tenant_id, so since E5 every backup failed
on `finance_pos_invoice_lines`. Backfilled from the invoice.

Revision ID: 20261004_invoice_line_tenant
Revises: 20260905_costing
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261004_invoice_line_tenant"
down_revision: Union[str, None] = "20260905_costing"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("finance_pos_invoice_lines", sa.Column("tenant_id", sa.BigInteger(), nullable=True))
    op.execute(
        "UPDATE finance_pos_invoice_lines SET tenant_id = "
        "(SELECT tenant_id FROM finance_pos_invoices WHERE finance_pos_invoices.id = finance_pos_invoice_lines.invoice_id)"
    )
    op.alter_column("finance_pos_invoice_lines", "tenant_id", nullable=False)
    op.create_foreign_key(
        "fk_finance_pos_invoice_lines_tenant_id", "finance_pos_invoice_lines", "tenants", ["tenant_id"], ["id"], ondelete="CASCADE"
    )
    op.create_index("ix_finance_pos_invoice_lines_tenant_id", "finance_pos_invoice_lines", ["tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_finance_pos_invoice_lines_tenant_id", table_name="finance_pos_invoice_lines")
    op.drop_constraint("fk_finance_pos_invoice_lines_tenant_id", "finance_pos_invoice_lines", type_="foreignkey")
    op.drop_column("finance_pos_invoice_lines", "tenant_id")
