"""Add constraints, data-transfer indexes, and user department cache

Revision ID: 20260514_constraints_dept
Revises: 20260513_pg_maintenance
Create Date: 2026-05-14 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260514_constraints_dept"
down_revision: Union[str, None] = "20260513_pg_maintenance"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _column_exists(bind, table_name: str, column_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return column_name in {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def _index_exists(bind, table_name: str, index_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return index_name in {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def _constraint_exists(bind, table_name: str, constraint_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    inspector = sa.inspect(bind)
    checks = {constraint["name"] for constraint in inspector.get_check_constraints(table_name)}
    uniques = {constraint["name"] for constraint in inspector.get_unique_constraints(table_name)}
    foreign_keys = {constraint["name"] for constraint in inspector.get_foreign_keys(table_name)}
    return constraint_name in checks | uniques | foreign_keys


def _add_check_if_missing(table_name: str, constraint_name: str, expression: str) -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        if _table_exists(bind, table_name) and not _constraint_exists(bind, table_name, constraint_name):
            op.execute(
                sa.text(
                    f"ALTER TABLE {table_name} ADD CONSTRAINT {constraint_name} CHECK ({expression}) NOT VALID"
                )
            )
        return
    if _table_exists(bind, table_name) and not _constraint_exists(bind, table_name, constraint_name):
        op.create_check_constraint(constraint_name, table_name, expression)


def _drop_constraint_if_exists(table_name: str, constraint_name: str) -> None:
    bind = op.get_bind()
    if _constraint_exists(bind, table_name, constraint_name):
        op.drop_constraint(constraint_name, table_name=table_name)


def _create_index_if_missing(index_name: str, table_name: str, columns: list[str]) -> None:
    bind = op.get_bind()
    if _table_exists(bind, table_name) and not _index_exists(bind, table_name, index_name):
        op.create_index(index_name, table_name, columns)


def upgrade() -> None:
    bind = op.get_bind()

    if _table_exists(bind, "users") and not _column_exists(bind, "users", "department_id"):
        op.add_column("users", sa.Column("department_id", sa.BigInteger(), nullable=True))
        op.create_index("ix_users_department_id", "users", ["department_id"])
        op.create_foreign_key(
            "fk_users_department_id_departments",
            "users",
            "departments",
            ["department_id"],
            ["id"],
            ondelete="SET NULL",
        )
    elif _column_exists(bind, "users", "department_id"):
        _create_index_if_missing("ix_users_department_id", "users", ["department_id"])
        if not _constraint_exists(bind, "users", "fk_users_department_id_departments"):
            op.create_foreign_key(
                "fk_users_department_id_departments",
                "users",
                "departments",
                ["department_id"],
                ["id"],
                ondelete="SET NULL",
            )

    if _table_exists(bind, "users") and _table_exists(bind, "teams"):
        op.execute(
            sa.text(
                """
                UPDATE users
                SET department_id = teams.department_id
                FROM teams
                WHERE users.team_id = teams.id
                  AND users.tenant_id = teams.tenant_id
                """
            )
        )

    _add_check_if_missing(
        "finance_io",
        "ck_finance_io_status",
        "status IN ('draft', 'issued', 'active', 'completed', 'cancelled', 'imported')",
    )
    _add_check_if_missing(
        "tasks",
        "ck_tasks_status",
        "status IN ('todo', 'in_progress', 'blocked', 'completed')",
    )
    _add_check_if_missing(
        "tasks",
        "ck_tasks_priority",
        "priority IN ('high', 'medium', 'low')",
    )
    _add_check_if_missing(
        "sales_opportunities",
        "ck_sales_opportunities_sales_stage",
        "sales_stage IS NULL OR sales_stage IN ('lead', 'qualified', 'proposal', 'negotiation', 'closed_won', 'closed_lost')",
    )

    _create_index_if_missing("ix_data_transfer_jobs_tenant_status", "data_transfer_jobs", ["tenant_id", "status"])
    _create_index_if_missing("ix_data_transfer_jobs_created_at", "data_transfer_jobs", ["created_at"])


def downgrade() -> None:
    _drop_constraint_if_exists("sales_opportunities", "ck_sales_opportunities_sales_stage")
    _drop_constraint_if_exists("tasks", "ck_tasks_priority")
    _drop_constraint_if_exists("tasks", "ck_tasks_status")
    _drop_constraint_if_exists("finance_io", "ck_finance_io_status")

    bind = op.get_bind()
    if _index_exists(bind, "data_transfer_jobs", "ix_data_transfer_jobs_tenant_status"):
        op.drop_index("ix_data_transfer_jobs_tenant_status", table_name="data_transfer_jobs")
    if _index_exists(bind, "users", "ix_users_department_id"):
        op.drop_index("ix_users_department_id", table_name="users")
    if _constraint_exists(bind, "users", "fk_users_department_id_departments"):
        op.drop_constraint("fk_users_department_id_departments", "users")
    if _column_exists(bind, "users", "department_id"):
        op.drop_column("users", "department_id")
