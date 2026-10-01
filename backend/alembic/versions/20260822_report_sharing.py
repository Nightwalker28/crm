"""saved reports: a description and who can see them

Revision ID: 20260822_report_sharing
Revises: 20260821_crm_event_public_id
Create Date: 2026-10-01

11-reports.md Phase 1. Every existing report keeps exactly the audience it had: the
server default makes it `private`, so nothing is shared by this migration. The check
constraint matches what the service accepts.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260822_report_sharing"
down_revision: Union[str, None] = "20260821_crm_event_public_id"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("user_module_reports", sa.Column("description", sa.Text(), nullable=True))
    op.add_column(
        "user_module_reports",
        sa.Column("visibility", sa.String(length=20), nullable=False, server_default="private"),
    )
    op.create_check_constraint(
        "ck_user_module_reports_visibility",
        "user_module_reports",
        "visibility IN ('private', 'everyone')",
    )
    op.create_index(
        "ix_user_module_reports_tenant_visibility",
        "user_module_reports",
        ["tenant_id", "visibility"],
    )


def downgrade() -> None:
    op.drop_index("ix_user_module_reports_tenant_visibility", table_name="user_module_reports")
    op.drop_constraint("ck_user_module_reports_visibility", "user_module_reports", type_="check")
    op.drop_column("user_module_reports", "visibility")
    op.drop_column("user_module_reports", "description")
