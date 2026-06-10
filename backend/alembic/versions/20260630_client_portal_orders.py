"""extend website orders for client portal lifecycle

Revision ID: 20260630_client_portal_orders
Revises: 20260629_automation_guards
Create Date: 2026-06-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260630_client_portal_orders"
down_revision: Union[str, None] = "20260629_automation_guards"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


PORTAL_STATUSES = "'submitted', 'under_review', 'confirmed', 'in_progress', 'completed', 'cancelled', 'rejected'"


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _check_constraint_exists(bind, table_name: str, constraint_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return constraint_name in {constraint["name"] for constraint in sa.inspect(bind).get_check_constraints(table_name)}


def _replace_status_constraint(expression: str) -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite" or not _table_exists(bind, "website_integration_orders"):
        return
    if _check_constraint_exists(bind, "website_integration_orders", "ck_website_orders_status"):
        op.drop_constraint("ck_website_orders_status", "website_integration_orders", type_="check")
    op.create_check_constraint("ck_website_orders_status", "website_integration_orders", expression)


def upgrade() -> None:
    _replace_status_constraint(f"status IN ({PORTAL_STATUSES})")


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "website_integration_orders"):
        op.execute(sa.text("UPDATE website_integration_orders SET status = 'confirmed' WHERE status NOT IN ('confirmed', 'rejected')"))
    _replace_status_constraint("status IN ('confirmed', 'rejected')")
