"""allow standard users to connect own mailbox

Revision ID: 20260423_mail_user_connect
Revises: 20260423_mail_foundation
Create Date: 2026-04-23 10:15:00.000000
"""

from alembic import op


revision = "20260423_mail_user_connect"
down_revision = "20260423_mail_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE role_module_permissions AS permission
        SET can_edit = 1
        FROM roles, modules
        WHERE permission.role_id = roles.id
          AND permission.module_id = modules.id
          AND modules.name = 'mail'
          AND roles.name = 'User'
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE role_module_permissions AS permission
        SET can_edit = 0
        FROM roles, modules
        WHERE permission.role_id = roles.id
          AND permission.module_id = modules.id
          AND modules.name = 'mail'
          AND roles.name = 'User'
        """
    )
