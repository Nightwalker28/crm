"""add team module permissions

Revision ID: 20260417_team_module_access
Revises: 20260416_saved_views
Create Date: 2026-04-17
"""

from alembic import op
import sqlalchemy as sa


revision = "20260417_team_module_access"
down_revision = "20260416_saved_views"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "team_module_permissions",
        sa.Column("id", sa.BigInteger(), primary_key=True, nullable=False),
        sa.Column("team_id", sa.BigInteger(), sa.ForeignKey("teams.id", ondelete="CASCADE"), nullable=False),
        sa.Column("module_id", sa.BigInteger(), sa.ForeignKey("modules.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("team_id", "module_id", name="uq_team_module_permissions_team_module"),
    )
    op.create_index("ix_team_module_permissions_id", "team_module_permissions", ["id"])
    op.create_index("ix_team_module_permissions_team_id", "team_module_permissions", ["team_id"])
    op.create_index("ix_team_module_permissions_module_id", "team_module_permissions", ["module_id"])

    op.execute(
        """
        INSERT INTO team_module_permissions (team_id, module_id)
        SELECT DISTINCT teams.id, department_module_permissions.module_id
        FROM teams
        JOIN department_module_permissions
          ON department_module_permissions.department_id = teams.department_id
        WHERE teams.department_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_index("ix_team_module_permissions_module_id", table_name="team_module_permissions")
    op.drop_index("ix_team_module_permissions_team_id", table_name="team_module_permissions")
    op.drop_index("ix_team_module_permissions_id", table_name="team_module_permissions")
    op.drop_table("team_module_permissions")
