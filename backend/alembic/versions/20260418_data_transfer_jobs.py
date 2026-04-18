"""add data transfer jobs table

Revision ID: 20260418_data_jobs
Revises: 20260418_import_duplicate_mode
Create Date: 2026-04-18
"""

from alembic import op
import sqlalchemy as sa


revision = "20260418_data_jobs"
down_revision = "20260418_import_duplicate_mode"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "data_transfer_jobs",
        sa.Column("id", sa.BigInteger(), primary_key=True, nullable=False),
        sa.Column("actor_user_id", sa.BigInteger(), nullable=True),
        sa.Column("module_key", sa.String(length=100), nullable=False),
        sa.Column("operation_type", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="queued"),
        sa.Column("mode", sa.String(length=20), nullable=False, server_default="background"),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("summary", sa.JSON(), nullable=True),
        sa.Column("result_file_path", sa.Text(), nullable=True),
        sa.Column("result_file_name", sa.String(length=255), nullable=True),
        sa.Column("result_media_type", sa.String(length=100), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_data_transfer_jobs_id", "data_transfer_jobs", ["id"])
    op.create_index("ix_data_transfer_jobs_actor_user_id", "data_transfer_jobs", ["actor_user_id"])
    op.create_index("ix_data_transfer_jobs_module_key", "data_transfer_jobs", ["module_key"])
    op.create_index("ix_data_transfer_jobs_operation_type", "data_transfer_jobs", ["operation_type"])
    op.create_index("ix_data_transfer_jobs_status", "data_transfer_jobs", ["status"])
    op.create_index("ix_data_transfer_jobs_created_at", "data_transfer_jobs", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_data_transfer_jobs_created_at", table_name="data_transfer_jobs")
    op.drop_index("ix_data_transfer_jobs_status", table_name="data_transfer_jobs")
    op.drop_index("ix_data_transfer_jobs_operation_type", table_name="data_transfer_jobs")
    op.drop_index("ix_data_transfer_jobs_module_key", table_name="data_transfer_jobs")
    op.drop_index("ix_data_transfer_jobs_actor_user_id", table_name="data_transfer_jobs")
    op.drop_index("ix_data_transfer_jobs_id", table_name="data_transfer_jobs")
    op.drop_table("data_transfer_jobs")
