"""add shared record comments

Revision ID: 20260421_record_comments
Revises: 20260420_tenant_scope
Create Date: 2026-04-21
"""

from alembic import op
import sqlalchemy as sa


revision = "20260421_record_comments"
down_revision = "20260420_tenant_scope"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "record_comments",
        sa.Column("id", sa.BigInteger(), primary_key=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor_user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("module_key", sa.String(length=100), nullable=False),
        sa.Column("entity_id", sa.String(length=100), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_record_comments_id", "record_comments", ["id"])
    op.create_index("ix_record_comments_tenant_id", "record_comments", ["tenant_id"])
    op.create_index("ix_record_comments_actor_user_id", "record_comments", ["actor_user_id"])
    op.create_index("ix_record_comments_module_key", "record_comments", ["module_key"])
    op.create_index("ix_record_comments_entity_id", "record_comments", ["entity_id"])
    op.create_index("ix_record_comments_created_at", "record_comments", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_record_comments_created_at", table_name="record_comments")
    op.drop_index("ix_record_comments_entity_id", table_name="record_comments")
    op.drop_index("ix_record_comments_module_key", table_name="record_comments")
    op.drop_index("ix_record_comments_actor_user_id", table_name="record_comments")
    op.drop_index("ix_record_comments_tenant_id", table_name="record_comments")
    op.drop_index("ix_record_comments_id", table_name="record_comments")
    op.drop_table("record_comments")
