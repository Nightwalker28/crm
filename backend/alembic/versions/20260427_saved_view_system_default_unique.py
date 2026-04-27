"""add unique system saved-view guard

Revision ID: 20260427_sv_sys_unique
Revises: 20260427_dept_team_seq
Create Date: 2026-04-27
"""

from alembic import op


revision = "20260427_sv_sys_unique"
down_revision = "20260427_dept_team_seq"
branch_labels = None
depends_on = None


INDEX_NAME = "uq_user_saved_views_system_default"


def upgrade() -> None:
    op.execute(
        """
        DELETE FROM user_saved_views duplicate
        USING user_saved_views keeper
        WHERE duplicate.user_id = keeper.user_id
          AND duplicate.module_key = keeper.module_key
          AND duplicate.id > keeper.id
          AND duplicate.config -> '_meta' ->> 'system_default' = 'true'
          AND keeper.config -> '_meta' ->> 'system_default' = 'true'
        """
    )
    op.execute(
        f"""
        CREATE UNIQUE INDEX {INDEX_NAME}
        ON user_saved_views (user_id, module_key)
        WHERE config -> '_meta' ->> 'system_default' = 'true'
        """
    )


def downgrade() -> None:
    op.drop_index(INDEX_NAME, table_name="user_saved_views")
