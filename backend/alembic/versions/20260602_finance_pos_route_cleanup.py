"""Clean stale finance invoice module routes.

Revision ID: 20260602_finance_pos_cleanup
Revises: 20260601_module_perm_uniques
Create Date: 2026-06-02 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260602_finance_pos_cleanup"
down_revision = "20260601_module_perm_uniques"
branch_labels = None
depends_on = None


STALE_ROUTE = "/dashboard/finance/invoices"
CANONICAL_ROUTE = "/dashboard/finance/pos"
CANONICAL_MODULE = "finance_pos"


def _copy_permissions(bind, source_module_ids: list[int], target_module_id: int) -> None:
    if not source_module_ids:
        return

    bind.execute(
        sa.text(
            """
            INSERT INTO department_module_permissions (department_id, module_id)
            SELECT DISTINCT source.department_id, :target_module_id
            FROM department_module_permissions AS source
            WHERE source.module_id IN :source_module_ids
              AND NOT EXISTS (
                  SELECT 1
                  FROM department_module_permissions AS existing
                  WHERE existing.department_id = source.department_id
                    AND existing.module_id = :target_module_id
              )
            """
        ).bindparams(sa.bindparam("source_module_ids", expanding=True)),
        {"source_module_ids": source_module_ids, "target_module_id": target_module_id},
    )
    bind.execute(
        sa.text(
            """
            INSERT INTO team_module_permissions (team_id, module_id)
            SELECT DISTINCT source.team_id, :target_module_id
            FROM team_module_permissions AS source
            WHERE source.module_id IN :source_module_ids
              AND NOT EXISTS (
                  SELECT 1
                  FROM team_module_permissions AS existing
                  WHERE existing.team_id = source.team_id
                    AND existing.module_id = :target_module_id
              )
            """
        ).bindparams(sa.bindparam("source_module_ids", expanding=True)),
        {"source_module_ids": source_module_ids, "target_module_id": target_module_id},
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
                source.role_id,
                :target_module_id,
                max(source.can_view),
                max(source.can_create),
                max(source.can_edit),
                max(source.can_delete),
                max(source.can_restore),
                max(source.can_export),
                max(source.can_configure)
            FROM role_module_permissions AS source
            WHERE source.module_id IN :source_module_ids
              AND NOT EXISTS (
                  SELECT 1
                  FROM role_module_permissions AS existing
                  WHERE existing.role_id = source.role_id
                    AND existing.module_id = :target_module_id
              )
            GROUP BY source.role_id
            """
        ).bindparams(sa.bindparam("source_module_ids", expanding=True)),
        {"source_module_ids": source_module_ids, "target_module_id": target_module_id},
    )


def upgrade() -> None:
    bind = op.get_bind()
    canonical_id = bind.execute(
        sa.text("SELECT id FROM modules WHERE name = :module_name"),
        {"module_name": CANONICAL_MODULE},
    ).scalar()

    if canonical_id is not None:
        bind.execute(
            sa.text(
                """
                UPDATE modules
                SET base_route = :base_route,
                    description = 'POS mode invoices and walk-in sales'
                WHERE id = :module_id
                """
            ),
            {"base_route": CANONICAL_ROUTE, "module_id": canonical_id},
        )

    stale_rows = bind.execute(
        sa.text(
            """
            SELECT id
            FROM modules
            WHERE base_route = :stale_route
              AND name <> :canonical_module
            """
        ),
        {
            "stale_route": STALE_ROUTE,
            "canonical_module": CANONICAL_MODULE,
        },
    ).fetchall()
    stale_module_ids = [row[0] for row in stale_rows]

    if canonical_id is not None:
        _copy_permissions(bind, stale_module_ids, canonical_id)

    if not stale_module_ids:
        return

    for table_name in (
        "tenant_module_configs",
        "department_module_permissions",
        "team_module_permissions",
        "role_module_permissions",
    ):
        bind.execute(
            sa.text(f"DELETE FROM {table_name} WHERE module_id IN :module_ids").bindparams(
                sa.bindparam("module_ids", expanding=True)
            ),
            {"module_ids": stale_module_ids},
        )
    bind.execute(
        sa.text("DELETE FROM modules WHERE id IN :module_ids").bindparams(
            sa.bindparam("module_ids", expanding=True)
        ),
        {"module_ids": stale_module_ids},
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE modules
            SET base_route = :stale_route
            WHERE name = :canonical_module
              AND base_route = :canonical_route
            """
        ),
        {
            "stale_route": STALE_ROUTE,
            "canonical_route": CANONICAL_ROUTE,
            "canonical_module": CANONICAL_MODULE,
        },
    )
