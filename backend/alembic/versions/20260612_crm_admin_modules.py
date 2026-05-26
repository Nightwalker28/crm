"""seed CRM administration modules

Revision ID: 20260612_crm_admin_modules
Revises: 20260611_quote_opportunity
Create Date: 2026-05-26
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260612_crm_admin_modules"
down_revision: Union[str, None] = "20260611_quote_opportunity"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


CRM_ADMIN_MODULES: tuple[tuple[str, str, str], ...] = (
    ("reports", "/dashboard/reports", "CRM reports and saved report views"),
    ("message_templates", "/dashboard/settings/message-templates", "Reusable CRM message templates for communication channels"),
)


def _seed_module(module_name: str, base_route: str, description: str) -> None:
    op.execute(
        sa.text(
            """
            INSERT INTO modules (name, base_route, description, is_enabled)
            VALUES (:module_name, :base_route, :description, 1)
            ON CONFLICT (name) DO UPDATE
            SET base_route = EXCLUDED.base_route,
                description = EXCLUDED.description,
                is_enabled = 1
            """
        ).bindparams(module_name=module_name, base_route=base_route, description=description)
    )
    op.execute(
        sa.text(
            """
            INSERT INTO department_module_permissions (department_id, module_id)
            SELECT departments.id, modules.id
            FROM departments
            CROSS JOIN modules
            WHERE modules.name = :module_name
            ON CONFLICT (department_id, module_id) DO NOTHING
            """
        ).bindparams(module_name=module_name)
    )
    op.execute(
        sa.text(
            """
            INSERT INTO team_module_permissions (team_id, module_id)
            SELECT teams.id, modules.id
            FROM teams
            CROSS JOIN modules
            WHERE modules.name = :module_name
            ON CONFLICT (team_id, module_id) DO NOTHING
            """
        ).bindparams(module_name=module_name)
    )
    op.execute(
        sa.text(
            """
            INSERT INTO role_module_permissions (
                role_id, module_id, can_view, can_create, can_edit, can_delete, can_restore, can_export, can_configure
            )
            SELECT
                roles.id,
                modules.id,
                1,
                CASE WHEN roles.level >= 10 THEN 1 ELSE 0 END,
                CASE WHEN roles.level >= 10 THEN 1 ELSE 0 END,
                CASE WHEN roles.level >= 90 THEN 1 ELSE 0 END,
                CASE WHEN roles.level >= 90 THEN 1 ELSE 0 END,
                CASE WHEN roles.level >= 90 THEN 1 ELSE 0 END,
                CASE WHEN roles.level >= 100 THEN 1 ELSE 0 END
            FROM roles
            CROSS JOIN modules
            WHERE modules.name = :module_name
            ON CONFLICT (role_id, module_id) DO NOTHING
            """
        ).bindparams(module_name=module_name)
    )


def upgrade() -> None:
    for module_name, base_route, description in CRM_ADMIN_MODULES:
        _seed_module(module_name, base_route, description)


def downgrade() -> None:
    module_names = [module_name for module_name, _base_route, _description in CRM_ADMIN_MODULES]
    op.execute(sa.text("DELETE FROM role_module_permissions WHERE module_id IN (SELECT id FROM modules WHERE name IN :module_names)").bindparams(sa.bindparam("module_names", expanding=True, value=module_names)))
    op.execute(sa.text("DELETE FROM team_module_permissions WHERE module_id IN (SELECT id FROM modules WHERE name IN :module_names)").bindparams(sa.bindparam("module_names", expanding=True, value=module_names)))
    op.execute(sa.text("DELETE FROM department_module_permissions WHERE module_id IN (SELECT id FROM modules WHERE name IN :module_names)").bindparams(sa.bindparam("module_names", expanding=True, value=module_names)))
    op.execute(sa.text("DELETE FROM tenant_module_configs WHERE module_id IN (SELECT id FROM modules WHERE name IN :module_names)").bindparams(sa.bindparam("module_names", expanding=True, value=module_names)))
    op.execute(sa.text("DELETE FROM modules WHERE name IN :module_names").bindparams(sa.bindparam("module_names", expanding=True, value=module_names)))
