"""Clean stale module sidebar routes

Revision ID: 20260530_sidebar_cleanup
Revises: 20260529_sidebar_tabs
Create Date: 2026-05-14
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260530_sidebar_cleanup"
down_revision: Union[str, None] = "20260529_sidebar_tabs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


STALE_MODULES = ("dashboard", "sales", "settings", "users", "modules", "whatsapp")


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE modules
            SET base_route = NULL
            WHERE name IN :module_names
            """
        ).bindparams(sa.bindparam("module_names", expanding=True)),
        {"module_names": STALE_MODULES},
    )
    bind.execute(
        sa.text(
            """
            UPDATE tenant_module_configs
            SET sidebar_tab_key = 'none'
            WHERE module_id IN (
                SELECT id FROM modules WHERE name IN :module_names
            )
            """
        ).bindparams(sa.bindparam("module_names", expanding=True)),
        {"module_names": STALE_MODULES},
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE tenant_module_configs
            SET sidebar_tab_key = NULL
            WHERE sidebar_tab_key = 'none'
              AND module_id IN (
                  SELECT id FROM modules WHERE name IN :module_names
              )
            """
        ).bindparams(sa.bindparam("module_names", expanding=True)),
        {"module_names": STALE_MODULES},
    )
    legacy_routes = {
        "dashboard": "/dashboard",
        "sales": "/dashboard/sales",
        "settings": "/dashboard/settings",
        "users": "/dashboard/settings/users",
        "modules": "/dashboard/settings/modules",
        "whatsapp": "/dashboard/whatsapp",
    }
    for module_name, base_route in legacy_routes.items():
        bind.execute(
            sa.text("UPDATE modules SET base_route = :base_route WHERE name = :module_name"),
            {"base_route": base_route, "module_name": module_name},
        )
