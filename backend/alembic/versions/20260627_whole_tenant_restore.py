"""allow whole tenant restore runs

Revision ID: 20260627_whole_tenant_restore
Revises: 20260626_tenant_restore_runs
Create Date: 2026-06-08
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260627_whole_tenant_restore"
down_revision: Union[str, None] = "20260626_tenant_restore_runs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("ck_tenant_restore_runs_type", "tenant_restore_runs", type_="check")
    op.drop_constraint("ck_tenant_restore_runs_mode", "tenant_restore_runs", type_="check")
    op.create_check_constraint(
        "ck_tenant_restore_runs_type",
        "tenant_restore_runs",
        "restore_type IN ('tenant_module', 'tenant_whole')",
    )
    op.create_check_constraint(
        "ck_tenant_restore_runs_mode",
        "tenant_restore_runs",
        "mode IN ('preview_only', 'create_missing', 'update_existing', 'skip_duplicates', 'replace_module_data', 'replace_tenant_data')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_tenant_restore_runs_type", "tenant_restore_runs", type_="check")
    op.drop_constraint("ck_tenant_restore_runs_mode", "tenant_restore_runs", type_="check")
    op.create_check_constraint(
        "ck_tenant_restore_runs_type",
        "tenant_restore_runs",
        "restore_type = 'tenant_module'",
    )
    op.create_check_constraint(
        "ck_tenant_restore_runs_mode",
        "tenant_restore_runs",
        "mode IN ('preview_only', 'create_missing', 'update_existing', 'skip_duplicates', 'replace_module_data')",
    )
