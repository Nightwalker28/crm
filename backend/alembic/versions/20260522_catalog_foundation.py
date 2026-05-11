"""add catalog module foundation

Revision ID: 20260522_catalog_foundation
Revises: 20260521_website_orders
Create Date: 2026-05-22 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260522_catalog_foundation"
down_revision: Union[str, None] = "20260521_website_orders"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


CATALOG_MODULES = (
    {
        "name": "catalog_products",
        "base_route": "/dashboard/catalog/products",
        "description": "Catalog products",
    },
    {
        "name": "catalog_services",
        "base_route": "/dashboard/catalog/services",
        "description": "Catalog services",
    },
)


def upgrade() -> None:
    bind = op.get_bind()

    for module in CATALOG_MODULES:
        bind.execute(
            sa.text(
                """
                INSERT INTO modules (name, base_route, description, is_enabled, import_duplicate_mode)
                VALUES (:name, :base_route, :description, 1, 'skip')
                ON CONFLICT (name) DO UPDATE
                SET base_route = EXCLUDED.base_route,
                    description = EXCLUDED.description,
                    is_enabled = EXCLUDED.is_enabled
                """
            ),
            module,
        )

    bind.execute(
        sa.text(
            """
            INSERT INTO tenant_module_configs (tenant_id, module_id, is_enabled, import_duplicate_mode)
            SELECT tenants.id, modules.id, 1, 'skip'
            FROM tenants
            CROSS JOIN modules
            WHERE modules.name IN ('catalog_products', 'catalog_services')
            ON CONFLICT (tenant_id, module_id) DO NOTHING
            """
        )
    )

    bind.execute(
        sa.text(
            """
            INSERT INTO department_module_permissions (department_id, module_id)
            SELECT departments.id, modules.id
            FROM departments
            CROSS JOIN modules
            WHERE modules.name IN ('catalog_products', 'catalog_services')
              AND NOT EXISTS (
                  SELECT 1
                  FROM department_module_permissions existing
                  WHERE existing.department_id = departments.id
                    AND existing.module_id = modules.id
              )
            """
        )
    )

    bind.execute(
        sa.text(
            """
            INSERT INTO team_module_permissions (team_id, module_id)
            SELECT teams.id, modules.id
            FROM teams
            CROSS JOIN modules
            WHERE modules.name IN ('catalog_products', 'catalog_services')
              AND NOT EXISTS (
                  SELECT 1
                  FROM team_module_permissions existing
                  WHERE existing.team_id = teams.id
                    AND existing.module_id = modules.id
              )
            """
        )
    )

    bind.execute(
        sa.text(
            """
            INSERT INTO role_module_permissions (
                role_id,
                module_id,
                can_view,
                can_create,
                can_edit,
                can_delete,
                can_restore,
                can_export,
                can_configure
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
            WHERE modules.name IN ('catalog_products', 'catalog_services')
              AND NOT EXISTS (
                  SELECT 1
                  FROM role_module_permissions existing
                  WHERE existing.role_id = roles.id
                    AND existing.module_id = modules.id
              )
            """
        )
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM role_module_permissions
        WHERE module_id IN (SELECT id FROM modules WHERE name IN ('catalog_products', 'catalog_services'))
        """
    )
    op.execute(
        """
        DELETE FROM team_module_permissions
        WHERE module_id IN (SELECT id FROM modules WHERE name IN ('catalog_products', 'catalog_services'))
        """
    )
    op.execute(
        """
        DELETE FROM department_module_permissions
        WHERE module_id IN (SELECT id FROM modules WHERE name IN ('catalog_products', 'catalog_services'))
        """
    )
    op.execute(
        """
        DELETE FROM tenant_module_configs
        WHERE module_id IN (SELECT id FROM modules WHERE name IN ('catalog_products', 'catalog_services'))
        """
    )
    op.execute("DELETE FROM modules WHERE name IN ('catalog_products', 'catalog_services')")
