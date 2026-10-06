"""One field system (13b Phase 2, F3.1)

`field_definitions` and `field_values` replace both earlier field systems: custom fields on
built-in modules (`custom_field_definitions` / `custom_field_values`) and custom-module fields
(`custom_module_field_definitions` / `custom_module_record_values`). Every definition and value
moves across, and the four old tables are dropped (owner decision 11).

- Old custom-field numbers were stored as JSON floats, so they become `decimal` fields; dates
  stored as strings become real dates.
- A custom module's fields take the module's platform module name as their `module_key`.
- `textarea` becomes `long_text`; `single_select` and `multi_select` become `picklist` and
  `multi_picklist`, each with its own local picklist made from its options. Stored option text
  becomes the value's key.
- The other `validation_json` settings move to `config`.

Revision ID: 20261009_field_system
Revises: 20261008_picklists
Create Date: 2026-10-06
"""

from __future__ import annotations

import json
import re
from decimal import Decimal, InvalidOperation
from typing import Any, Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20261009_field_system"
down_revision: Union[str, None] = "20261008_picklists"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

KEY_RE = re.compile(r"[^a-z0-9]+")
TYPE_MAP = {"textarea": "long_text", "single_select": "picklist", "multi_select": "multi_picklist", "number": "decimal"}
SYSTEM_LIST_KEYS = {
    "lead_status", "lead_source", "industry", "account_type", "region", "salutation", "deal_type", "lost_reason",
    "payment_method", "unit", "shipping_method", "tax_category", "country",
}


def _slug(label: str) -> str:
    return KEY_RE.sub("_", str(label).strip().casefold()).strip("_")[:90] or "value"


def _create_tables() -> None:
    op.create_table(
        "field_definitions",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("module_key", sa.String(100), nullable=False),
        sa.Column("field_key", sa.String(100), nullable=False),
        sa.Column("label", sa.String(150), nullable=False),
        sa.Column("field_type", sa.String(40), nullable=False),
        sa.Column("custom_module_id", sa.BigInteger(), sa.ForeignKey("custom_module_definitions.id", ondelete="CASCADE"), nullable=True),
        sa.Column("picklist_id", sa.BigInteger(), sa.ForeignKey("picklists.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("lookup_module_key", sa.String(100), nullable=True),
        sa.Column("is_required", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_unique", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("display_in_list", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("default_value", sa.JSON(), nullable=True),
        sa.Column("config", sa.JSON(), nullable=True),
        sa.Column("placeholder", sa.String(255), nullable=True),
        sa.Column("help_text", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_field_definitions_id", "field_definitions", ["id"])
    op.create_index("ix_field_definitions_tenant_id", "field_definitions", ["tenant_id"])
    op.create_index("ix_field_definitions_module_key", "field_definitions", ["module_key"])
    op.create_index("ix_field_definitions_custom_module_id", "field_definitions", ["custom_module_id"])
    op.create_index("ix_field_definitions_picklist_id", "field_definitions", ["picklist_id"])
    op.create_index("ix_field_definitions_deleted_at", "field_definitions", ["deleted_at"])
    op.create_index("ix_field_definitions_tenant_module", "field_definitions", ["tenant_id", "module_key", "is_active"])
    op.create_index(
        "uq_field_definitions_tenant_module_key", "field_definitions", ["tenant_id", "module_key", "field_key"],
        unique=True, postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_table(
        "field_values",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("module_key", sa.String(100), nullable=False),
        sa.Column("record_id", sa.BigInteger(), nullable=False),
        sa.Column("field_definition_id", sa.BigInteger(), sa.ForeignKey("field_definitions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("value_text", sa.Text(), nullable=True),
        sa.Column("value_number", sa.Numeric(28, 8), nullable=True),
        sa.Column("value_date", sa.Date(), nullable=True),
        sa.Column("value_datetime", sa.DateTime(timezone=True), nullable=True),
        sa.Column("value_boolean", sa.Boolean(), nullable=True),
        sa.Column("value_json", sa.JSON(), nullable=True),
        sa.Column("value_record_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "module_key", "record_id", "field_definition_id", name="uq_field_values_record_field"),
    )
    op.create_index("ix_field_values_id", "field_values", ["id"])
    op.create_index("ix_field_values_tenant_id", "field_values", ["tenant_id"])
    op.create_index("ix_field_values_module_record", "field_values", ["tenant_id", "module_key", "record_id"])
    op.create_index("ix_field_values_definition_text", "field_values", ["field_definition_id", "value_text"])
    op.create_index("ix_field_values_definition_number", "field_values", ["field_definition_id", "value_number"])
    op.create_index("ix_field_values_definition_date", "field_values", ["field_definition_id", "value_date"])
    op.create_index("ix_field_values_definition_datetime", "field_values", ["field_definition_id", "value_datetime"])
    op.create_index("ix_field_values_definition_record", "field_values", ["field_definition_id", "value_record_id"])


def _decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            pass
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def _local_list(bind, tenant_id: int, label: str, options: list[str]) -> tuple[int, dict[str, str]]:
    """A local picklist for a select field's options; returns its id and option → key."""
    taken = {row[0] for row in bind.execute(sa.text("SELECT key FROM picklists WHERE tenant_id = :t"), {"t": tenant_id})} | SYSTEM_LIST_KEYS
    base = key = _slug(label)
    suffix = 2
    while key in taken:
        key, suffix = f"{base}_{suffix}", suffix + 1
    list_id = bind.execute(
        sa.text("INSERT INTO picklists (tenant_id, key, label, scope, is_system, is_locked) VALUES (:t, :k, :l, 'local', false, false) RETURNING id"),
        {"t": tenant_id, "k": key, "l": label[:150]},
    ).scalar_one()
    keys: dict[str, str] = {}
    for position, option in enumerate(options):
        text = str(option).strip()
        if not text or text in keys:
            continue
        value_key, n = _slug(text), 2
        while value_key in keys.values():
            value_key, n = f"{_slug(text)}_{n}", n + 1
        bind.execute(
            sa.text(
                "INSERT INTO picklist_values (tenant_id, picklist_id, key, label, position, is_active, is_default) "
                "VALUES (:t, :p, :k, :l, :pos, true, false)"
            ),
            {"t": tenant_id, "p": list_id, "k": value_key, "l": text[:150], "pos": position},
        )
        keys[text] = value_key
    return list_id, keys


def _option_key(bind, tenant_id: int, list_id: int, keys: dict[str, str], text: str) -> str:
    """A stored option that the field's options no longer listed still becomes a value."""
    if text in keys:
        return keys[text]
    value_key = _slug(text)
    while value_key in keys.values():
        value_key += "_x"
    bind.execute(
        sa.text(
            "INSERT INTO picklist_values (tenant_id, picklist_id, key, label, position, is_active, is_default) "
            "VALUES (:t, :p, :k, :l, :pos, false, false)"
        ),
        {"t": tenant_id, "p": list_id, "k": value_key, "l": text[:150], "pos": len(keys)},
    )
    keys[text] = value_key
    return value_key


def _move_custom_fields(bind) -> None:
    definitions = bind.execute(sa.text(
        "SELECT id, tenant_id, module_key, field_key, label, field_type, placeholder, help_text, is_required, is_active, sort_order, "
        "created_at, updated_at FROM custom_field_definitions ORDER BY id"
    )).mappings().all()
    for row in definitions:
        kind = TYPE_MAP.get(row["field_type"], row["field_type"])
        new_id = bind.execute(
            sa.text(
                "INSERT INTO field_definitions (tenant_id, module_key, field_key, label, field_type, placeholder, help_text, "
                "is_required, is_active, sort_order, created_at, updated_at) VALUES (:tenant_id, :module_key, :field_key, :label, "
                ":field_type, :placeholder, :help_text, :is_required, :is_active, :sort_order, :created_at, :updated_at) RETURNING id"
            ),
            {**dict(row), "field_type": kind},
        ).scalar_one()
        values = bind.execute(sa.text(
            "SELECT tenant_id, module_key, record_id, value_text, value_number, value_date, value_boolean, created_at, updated_at "
            "FROM custom_field_values WHERE field_definition_id = :d"
        ), {"d": row["id"]}).mappings().all()
        for value in values:
            payload = {
                "tenant_id": value["tenant_id"], "module_key": value["module_key"], "record_id": value["record_id"], "d": new_id,
                "text": None, "number": None, "date": None, "boolean": None,
                "created_at": value["created_at"], "updated_at": value["updated_at"],
            }
            if kind in {"text", "long_text"}:
                payload["text"] = value["value_text"]
            elif kind == "decimal":
                payload["number"] = _decimal(value["value_number"])
            elif kind == "date":
                payload["date"] = (value["value_date"] or None) and str(value["value_date"])[:10]
            elif kind == "boolean":
                payload["boolean"] = value["value_boolean"]
            if all(payload[k] is None for k in ("text", "number", "date", "boolean")):
                continue
            bind.execute(
                sa.text(
                    "INSERT INTO field_values (tenant_id, module_key, record_id, field_definition_id, value_text, value_number, "
                    "value_date, value_boolean, created_at, updated_at) VALUES (:tenant_id, :module_key, :record_id, :d, :text, "
                    ":number, CAST(:date AS DATE), :boolean, :created_at, :updated_at)"
                ),
                payload,
            )


def _move_custom_module_fields(bind) -> None:
    definitions = bind.execute(sa.text(
        "SELECT f.id, f.tenant_id, f.custom_module_id, f.key, f.label, f.field_type, f.help_text, f.placeholder, f.is_required, "
        "f.is_unique, f.display_in_list, f.default_value, f.validation_json, f.sort_order, f.is_active, f.deleted_at, "
        "f.created_at, f.updated_at, m.name AS module_name "
        "FROM custom_module_field_definitions f JOIN custom_module_definitions d ON d.id = f.custom_module_id "
        "LEFT JOIN modules m ON m.id = d.module_id ORDER BY f.id"
    )).mappings().all()
    for row in definitions:
        kind = TYPE_MAP.get(row["field_type"], row["field_type"])
        validation = row["validation_json"] or {}
        if isinstance(validation, str):
            validation = json.loads(validation) or {}
        options = validation.pop("options", None) or []
        picklist_id, option_keys = (None, {})
        if kind in {"picklist", "multi_picklist"}:
            picklist_id, option_keys = _local_list(bind, row["tenant_id"], row["label"], options)
        default_value = row["default_value"]
        if isinstance(default_value, str):
            try:
                default_value = json.loads(default_value)
            except ValueError:
                pass
        if kind == "picklist" and isinstance(default_value, str):
            default_value = option_keys.get(default_value, default_value)
        new_id = bind.execute(
            sa.text(
                "INSERT INTO field_definitions (tenant_id, module_key, field_key, label, field_type, custom_module_id, picklist_id, "
                "is_required, is_unique, display_in_list, default_value, config, placeholder, help_text, sort_order, is_active, "
                "deleted_at, created_at, updated_at) VALUES (:tenant_id, :module_key, :field_key, :label, :field_type, "
                ":custom_module_id, :picklist_id, :is_required, :is_unique, :display_in_list, CAST(:default_value AS JSON), "
                "CAST(:config AS JSON), :placeholder, :help_text, :sort_order, :is_active, :deleted_at, :created_at, :updated_at) "
                "RETURNING id"
            ),
            {
                "tenant_id": row["tenant_id"], "module_key": row["module_name"] or f"custom_module_{row['custom_module_id']}",
                "field_key": row["key"], "label": row["label"], "field_type": kind, "custom_module_id": row["custom_module_id"],
                "picklist_id": picklist_id, "is_required": row["is_required"], "is_unique": row["is_unique"] and kind not in {"picklist", "multi_picklist"},
                "display_in_list": row["display_in_list"], "default_value": json.dumps(default_value) if default_value is not None else None,
                "config": json.dumps(validation) if validation else None, "placeholder": row["placeholder"], "help_text": row["help_text"],
                "sort_order": row["sort_order"], "is_active": row["is_active"], "deleted_at": row["deleted_at"],
                "created_at": row["created_at"], "updated_at": row["updated_at"],
            },
        ).scalar_one()
        values = bind.execute(sa.text(
            "SELECT tenant_id, record_id, text_value, number_value, datetime_value, boolean_value, json_value, created_at, updated_at "
            "FROM custom_module_record_values WHERE field_id = :f"
        ), {"f": row["id"]}).mappings().all()
        for value in values:
            payload = {
                "tenant_id": value["tenant_id"], "module_key": row["module_name"] or f"custom_module_{row['custom_module_id']}",
                "record_id": value["record_id"], "d": new_id, "text": None, "number": None, "date": None, "datetime": None,
                "boolean": None, "json": None, "created_at": value["created_at"], "updated_at": value["updated_at"],
            }
            if kind == "picklist" and value["text_value"]:
                payload["text"] = _option_key(bind, row["tenant_id"], picklist_id, option_keys, value["text_value"])
            elif kind == "multi_picklist" and value["json_value"] is not None:
                items = value["json_value"]
                if isinstance(items, str):
                    items = json.loads(items)
                keys = [_option_key(bind, row["tenant_id"], picklist_id, option_keys, str(item)) for item in (items or [])]
                payload["json"] = json.dumps(keys) if keys else None
            elif kind in {"text", "long_text", "email", "phone", "url"}:
                payload["text"] = value["text_value"]
            elif kind in {"decimal", "currency"}:
                payload["number"] = value["number_value"]
            elif kind == "date":
                payload["date"] = value["datetime_value"].date().isoformat() if value["datetime_value"] else None
            elif kind == "datetime":
                payload["datetime"] = value["datetime_value"]
            elif kind == "boolean":
                payload["boolean"] = value["boolean_value"]
            if all(payload[k] is None for k in ("text", "number", "date", "datetime", "boolean", "json")):
                continue
            bind.execute(
                sa.text(
                    "INSERT INTO field_values (tenant_id, module_key, record_id, field_definition_id, value_text, value_number, "
                    "value_date, value_datetime, value_boolean, value_json, created_at, updated_at) VALUES (:tenant_id, :module_key, "
                    ":record_id, :d, :text, :number, CAST(:date AS DATE), :datetime, :boolean, CAST(:json AS JSON), :created_at, :updated_at)"
                ),
                payload,
            )


def upgrade() -> None:
    _create_tables()
    bind = op.get_bind()
    _move_custom_fields(bind)
    _move_custom_module_fields(bind)
    op.drop_table("custom_field_values")
    op.drop_table("custom_field_definitions")
    op.drop_table("custom_module_record_values")
    op.drop_table("custom_module_field_definitions")


def downgrade() -> None:
    raise NotImplementedError("The earlier field systems are dropped for good; restore from a backup instead.")
