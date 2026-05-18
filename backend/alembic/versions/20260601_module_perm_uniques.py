"""Add module permission uniqueness constraints.

Revision ID: 20260601_module_perm_uniques
Revises: 20260531_finance_io_unique
Create Date: 2026-06-01 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260601_module_perm_uniques"
down_revision = "20260531_finance_io_unique"
branch_labels = None
depends_on = None


def _unique_exists(inspector, table_name: str, constraint_name: str) -> bool:
    return any(constraint.get("name") == constraint_name for constraint in inspector.get_unique_constraints(table_name))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    bind.execute(
        sa.text(
            """
            DELETE FROM department_module_permissions AS permission
            USING department_module_permissions AS duplicate
            WHERE permission.department_id = duplicate.department_id
              AND permission.module_id = duplicate.module_id
              AND permission.id > duplicate.id
            """
        )
    )
    bind.execute(
        sa.text(
            """
            DELETE FROM team_module_permissions AS permission
            USING team_module_permissions AS duplicate
            WHERE permission.team_id = duplicate.team_id
              AND permission.module_id = duplicate.module_id
              AND permission.id > duplicate.id
            """
        )
    )
    bind.execute(
        sa.text(
            """
            DELETE FROM role_module_permissions AS permission
            USING role_module_permissions AS duplicate
            WHERE permission.role_id = duplicate.role_id
              AND permission.module_id = duplicate.module_id
              AND permission.id > duplicate.id
            """
        )
    )

    if not _unique_exists(inspector, "department_module_permissions", "uq_department_module_permissions_department_module"):
        op.create_unique_constraint(
            "uq_department_module_permissions_department_module",
            "department_module_permissions",
            ["department_id", "module_id"],
        )
    if not _unique_exists(inspector, "team_module_permissions", "uq_team_module_permissions_team_module"):
        op.create_unique_constraint(
            "uq_team_module_permissions_team_module",
            "team_module_permissions",
            ["team_id", "module_id"],
        )
    if not _unique_exists(inspector, "role_module_permissions", "uq_role_module_permissions_role_module"):
        op.create_unique_constraint(
            "uq_role_module_permissions_role_module",
            "role_module_permissions",
            ["role_id", "module_id"],
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if _unique_exists(inspector, "role_module_permissions", "uq_role_module_permissions_role_module"):
        op.drop_constraint("uq_role_module_permissions_role_module", "role_module_permissions", type_="unique")
    if _unique_exists(inspector, "team_module_permissions", "uq_team_module_permissions_team_module"):
        op.drop_constraint("uq_team_module_permissions_team_module", "team_module_permissions", type_="unique")
    if _unique_exists(inspector, "department_module_permissions", "uq_department_module_permissions_department_module"):
        op.drop_constraint(
            "uq_department_module_permissions_department_module",
            "department_module_permissions",
            type_="unique",
        )
