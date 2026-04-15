"""backfill relational custom field values from json columns

Revision ID: 20260415_cf_backfill
Revises: 20260414_custom_field_values
Create Date: 2026-04-15 09:30:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260415_cf_backfill"
down_revision = "20260414_custom_field_values"
branch_labels = None
depends_on = None


MODULE_TABLES = {
    "finance_io": ("finance_io", "id"),
    "sales_contacts": ("sales_contacts", "contact_id"),
    "sales_organizations": ("sales_organizations", "org_id"),
    "sales_opportunities": ("sales_opportunities", "opportunity_id"),
}


def upgrade() -> None:
    bind = op.get_bind()
    metadata = sa.MetaData()

    definitions = sa.Table("custom_field_definitions", metadata, autoload_with=bind)
    values = sa.Table("custom_field_values", metadata, autoload_with=bind)

    definition_rows = bind.execute(
        sa.select(
            definitions.c.id,
            definitions.c.module_key,
            definitions.c.field_key,
            definitions.c.field_type,
        )
    ).mappings().all()

    definition_map: dict[tuple[str, str], dict] = {
        (row["module_key"], row["field_key"]): dict(row) for row in definition_rows
    }

    for module_key, (table_name, record_id_column) in MODULE_TABLES.items():
        table = sa.Table(table_name, metadata, autoload_with=bind)
        rows = bind.execute(
            sa.select(getattr(table.c, record_id_column), table.c.custom_data).where(table.c.custom_data.is_not(None))
        ).mappings().all()

        inserts: list[dict] = []
        for row in rows:
            record_id = row[record_id_column]
            payload = row["custom_data"]
            if not isinstance(payload, dict):
                continue

            for field_key, raw_value in payload.items():
                definition = definition_map.get((module_key, field_key))
                if not definition or raw_value is None:
                    continue

                insert_row = {
                    "module_key": module_key,
                    "record_id": record_id,
                    "field_definition_id": definition["id"],
                    "value_text": None,
                    "value_number": None,
                    "value_date": None,
                    "value_boolean": None,
                }
                field_type = definition["field_type"]
                if field_type in {"text", "long_text"}:
                    insert_row["value_text"] = str(raw_value)
                elif field_type == "number":
                    insert_row["value_number"] = raw_value
                elif field_type == "date":
                    insert_row["value_date"] = str(raw_value)
                elif field_type == "boolean":
                    insert_row["value_boolean"] = bool(raw_value)
                else:
                    continue
                inserts.append(insert_row)

        if inserts:
            op.bulk_insert(values, inserts)


def downgrade() -> None:
    bind = op.get_bind()
    metadata = sa.MetaData()
    values = sa.Table("custom_field_values", metadata, autoload_with=bind)
    bind.execute(values.delete())
