"""Harden client portal account and discount constraints

Revision ID: 20260509_client_portal_hardening
Revises: 20260508_client_portal
Create Date: 2026-05-09 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260509_client_portal_hardening"
down_revision: Union[str, None] = "20260508_client_portal"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _constraint_exists(bind, table_name: str, constraint_name: str) -> bool:
    inspector = sa.inspect(bind)
    constraints = inspector.get_unique_constraints(table_name) + inspector.get_check_constraints(table_name)
    return constraint_name in {constraint["name"] for constraint in constraints}


def upgrade() -> None:
    bind = op.get_bind()

    if not _constraint_exists(bind, "customer_groups", "ck_customer_groups_discount_type"):
        op.create_check_constraint(
            "ck_customer_groups_discount_type",
            "customer_groups",
            "discount_type IN ('none', 'percent', 'fixed')",
        )
    if not _constraint_exists(bind, "customer_groups", "ck_customer_groups_discount_value_required"):
        op.create_check_constraint(
            "ck_customer_groups_discount_value_required",
            "customer_groups",
            "((discount_type = 'none' AND discount_value IS NULL) OR "
            "(discount_type IN ('percent', 'fixed') AND discount_value IS NOT NULL AND discount_value >= 0))",
        )
    if not _constraint_exists(bind, "customer_groups", "ck_customer_groups_percent_discount_max"):
        op.create_check_constraint(
            "ck_customer_groups_percent_discount_max",
            "customer_groups",
            "discount_type != 'percent' OR discount_value <= 100",
        )
    if not _constraint_exists(bind, "client_accounts", "ck_client_accounts_status"):
        op.create_check_constraint(
            "ck_client_accounts_status",
            "client_accounts",
            "status IN ('pending', 'active', 'inactive')",
        )
    if not _constraint_exists(bind, "client_accounts", "uq_client_accounts_tenant_contact"):
        op.create_unique_constraint(
            "uq_client_accounts_tenant_contact",
            "client_accounts",
            ["tenant_id", "contact_id"],
        )
    if not _constraint_exists(bind, "client_accounts", "uq_client_accounts_tenant_organization"):
        op.create_unique_constraint(
            "uq_client_accounts_tenant_organization",
            "client_accounts",
            ["tenant_id", "organization_id"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    if _constraint_exists(bind, "client_accounts", "uq_client_accounts_tenant_organization"):
        op.drop_constraint("uq_client_accounts_tenant_organization", "client_accounts", type_="unique")
    if _constraint_exists(bind, "client_accounts", "uq_client_accounts_tenant_contact"):
        op.drop_constraint("uq_client_accounts_tenant_contact", "client_accounts", type_="unique")
    if _constraint_exists(bind, "client_accounts", "ck_client_accounts_status"):
        op.drop_constraint("ck_client_accounts_status", "client_accounts", type_="check")
    if _constraint_exists(bind, "customer_groups", "ck_customer_groups_percent_discount_max"):
        op.drop_constraint("ck_customer_groups_percent_discount_max", "customer_groups", type_="check")
    if _constraint_exists(bind, "customer_groups", "ck_customer_groups_discount_value_required"):
        op.drop_constraint("ck_customer_groups_discount_value_required", "customer_groups", type_="check")
    if _constraint_exists(bind, "customer_groups", "ck_customer_groups_discount_type"):
        op.drop_constraint("ck_customer_groups_discount_type", "customer_groups", type_="check")
