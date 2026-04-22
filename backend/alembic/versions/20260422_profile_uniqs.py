"""enforce tenant profile and preference uniqueness

Revision ID: 20260422_profile_uniqs
Revises: 20260422_admin_scope
Create Date: 2026-04-22 00:20:00.000000
"""

from alembic import op


revision = "20260422_profile_uniqs"
down_revision = "20260422_admin_scope"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DELETE FROM company_profiles
        WHERE id NOT IN (
            SELECT MIN(id)
            FROM company_profiles
            GROUP BY tenant_id
        )
        """
    )
    op.create_unique_constraint(
        "uq_company_profiles_tenant_id",
        "company_profiles",
        ["tenant_id"],
    )

    op.execute(
        """
        DELETE FROM user_table_preferences
        WHERE id NOT IN (
            SELECT MAX(id)
            FROM user_table_preferences
            GROUP BY user_id, module_key
        )
        """
    )
    op.create_unique_constraint(
        "uq_user_table_preferences_user_module",
        "user_table_preferences",
        ["user_id", "module_key"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_user_table_preferences_user_module",
        "user_table_preferences",
        type_="unique",
    )
    op.drop_constraint(
        "uq_company_profiles_tenant_id",
        "company_profiles",
        type_="unique",
    )
