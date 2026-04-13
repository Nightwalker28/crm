"""add activity logs and recycle columns for sales records

Revision ID: 20260413_audit_recycle
Revises: 20260413_profile_company
Create Date: 2026-04-13 17:20:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260413_audit_recycle"
down_revision = "20260413_profile_company"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sales_organizations", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("sales_contacts", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_sales_organizations_deleted_at", "sales_organizations", ["deleted_at"], unique=False)
    op.create_index("ix_sales_contacts_deleted_at", "sales_contacts", ["deleted_at"], unique=False)

    op.create_table(
        "activity_logs",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("actor_user_id", sa.BigInteger(), nullable=True),
        sa.Column("module_key", sa.String(length=100), nullable=False),
        sa.Column("entity_type", sa.String(length=100), nullable=False),
        sa.Column("entity_id", sa.String(length=100), nullable=False),
        sa.Column("action", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("before_state", sa.JSON(), nullable=True),
        sa.Column("after_state", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_activity_logs_actor_user_id", "activity_logs", ["actor_user_id"], unique=False)
    op.create_index("ix_activity_logs_module_key", "activity_logs", ["module_key"], unique=False)
    op.create_index("ix_activity_logs_entity_type", "activity_logs", ["entity_type"], unique=False)
    op.create_index("ix_activity_logs_entity_id", "activity_logs", ["entity_id"], unique=False)
    op.create_index("ix_activity_logs_action", "activity_logs", ["action"], unique=False)
    op.create_index("ix_activity_logs_created_at", "activity_logs", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_activity_logs_created_at", table_name="activity_logs")
    op.drop_index("ix_activity_logs_action", table_name="activity_logs")
    op.drop_index("ix_activity_logs_entity_id", table_name="activity_logs")
    op.drop_index("ix_activity_logs_entity_type", table_name="activity_logs")
    op.drop_index("ix_activity_logs_module_key", table_name="activity_logs")
    op.drop_index("ix_activity_logs_actor_user_id", table_name="activity_logs")
    op.drop_table("activity_logs")

    op.drop_index("ix_sales_contacts_deleted_at", table_name="sales_contacts")
    op.drop_index("ix_sales_organizations_deleted_at", table_name="sales_organizations")
    op.drop_column("sales_contacts", "deleted_at")
    op.drop_column("sales_organizations", "deleted_at")
