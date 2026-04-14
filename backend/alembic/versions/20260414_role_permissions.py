"""add role module permissions

Revision ID: 20260414_role_permissions
Revises: 20260414_io_contact_link
Create Date: 2026-04-14 12:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260414_role_permissions"
down_revision = "20260414_io_contact_link"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "role_module_permissions",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("role_id", sa.BigInteger(), nullable=False),
        sa.Column("module_id", sa.BigInteger(), nullable=False),
        sa.Column("can_view", sa.SmallInteger(), nullable=False, server_default="1"),
        sa.Column("can_create", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("can_edit", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("can_delete", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("can_restore", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("can_export", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("can_configure", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["module_id"], ["modules.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_role_module_permissions_role_id", "role_module_permissions", ["role_id"], unique=False)
    op.create_index("ix_role_module_permissions_module_id", "role_module_permissions", ["module_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_role_module_permissions_module_id", table_name="role_module_permissions")
    op.drop_index("ix_role_module_permissions_role_id", table_name="role_module_permissions")
    op.drop_table("role_module_permissions")
