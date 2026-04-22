"""enforce custom field tenant uniqueness

Revision ID: 20260422_cf_uniqs
Revises: 20260422_profile_uniqs
Create Date: 2026-04-22 00:40:00.000000
"""

from alembic import op


revision = "20260422_cf_uniqs"
down_revision = "20260422_profile_uniqs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        WITH canonical AS (
            SELECT
                id,
                MIN(id) OVER (
                    PARTITION BY tenant_id, module_key, field_key
                ) AS keep_id
            FROM custom_field_definitions
        )
        UPDATE custom_field_values AS value_row
        SET field_definition_id = canonical.keep_id
        FROM canonical
        WHERE value_row.field_definition_id = canonical.id
          AND canonical.id <> canonical.keep_id
        """
    )

    op.execute(
        """
        DELETE FROM custom_field_definitions AS definition_row
        USING (
            SELECT id
            FROM (
                SELECT
                    id,
                    ROW_NUMBER() OVER (
                        PARTITION BY tenant_id, module_key, field_key
                        ORDER BY id ASC
                    ) AS row_num
                FROM custom_field_definitions
            ) ranked
            WHERE row_num > 1
        ) duplicates
        WHERE definition_row.id = duplicates.id
        """
    )

    op.execute(
        """
        DELETE FROM custom_field_values AS value_row
        USING (
            SELECT id
            FROM (
                SELECT
                    id,
                    ROW_NUMBER() OVER (
                        PARTITION BY tenant_id, module_key, record_id, field_definition_id
                        ORDER BY id DESC
                    ) AS row_num
                FROM custom_field_values
            ) ranked
            WHERE row_num > 1
        ) duplicates
        WHERE value_row.id = duplicates.id
        """
    )

    op.create_unique_constraint(
        "uq_custom_field_defs_tenant_module_key",
        "custom_field_definitions",
        ["tenant_id", "module_key", "field_key"],
    )
    op.create_unique_constraint(
        "uq_custom_field_values_tenant_record_field",
        "custom_field_values",
        ["tenant_id", "module_key", "record_id", "field_definition_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_custom_field_values_tenant_record_field",
        "custom_field_values",
        type_="unique",
    )
    op.drop_constraint(
        "uq_custom_field_defs_tenant_module_key",
        "custom_field_definitions",
        type_="unique",
    )
