"""Add department_module_permissions table"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "20241209_dept_mod_perms"
down_revision = "20241208_base_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "department_module_permissions" in inspector.get_table_names():
        return

    op.create_table(
        "department_module_permissions",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("department_id", sa.BigInteger(), nullable=False),
        sa.Column("module_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["module_id"], ["modules.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_department_module_permissions_id"),
        "department_module_permissions",
        ["id"],
        unique=False,
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "department_module_permissions" not in inspector.get_table_names():
        return

    op.drop_index(
        op.f("ix_department_module_permissions_id"),
        table_name="department_module_permissions",
    )
    op.drop_table("department_module_permissions")
