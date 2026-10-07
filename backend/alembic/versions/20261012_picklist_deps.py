"""Dependent picklists and country → state (13b Phase 4 slice 4b, F3.6)

- `picklist_dependencies`: a controlling picklist field limits a dependent one, per tenant
  and module.
- Address states: where the address's country has states or provinces in the bundled ISO
  3166-2 list, a state written as a code or another spelling becomes the bundled name. Values
  that match nothing are left as they are and printed (13b §5 decision 7 lists rather than
  guesses); the next save of that address asks for a state from the list.

The downgrade drops the table; normalized state names stay (they are still valid text).

Revision ID: 20261012_picklist_deps
Revises: 20261011_field_rules
Create Date: 2026-10-06
"""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20261012_picklist_deps"
down_revision: Union[str, None] = "20261011_field_rules"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Frozen copy of app/core/subdivisions.py's matching, as migrations do not import app code.
def _fold(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    stripped = "".join(char for char in decomposed if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", " ", stripped.casefold()).strip()


def _lookups() -> dict[str, dict[str, str]]:
    path = Path(__file__).resolve().parents[2] / "app" / "core" / "data" / "iso_3166_2.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    result: dict[str, dict[str, str]] = {}
    for country, items in data["subdivisions"].items():
        table: dict[str, str] = {}
        for item in items:
            name = re.sub(r"\s*\[[^\]]*\]\s*$", "", item["name"]).strip()
            for key in (item["code"], item["code"].split("-", 1)[-1], name):
                table.setdefault(_fold(key), name)
        result[country] = table
    return result


# table, primary key, (state column, country column) pairs
_ADDRESSES = (
    ("sales_organizations", "org_id", (("billing_state", "billing_country"), ("shipping_state", "shipping_country"))),
    ("sales_contacts", "contact_id", (("mailing_state", "country"),)),
    ("sales_quotes", "quote_id", (("billing_state", "billing_country"), ("shipping_state", "shipping_country"))),
    ("sales_orders", "id", (("billing_state", "billing_country"), ("shipping_state", "shipping_country"))),
)


def _primary_key(bind, table: str, fallback: str) -> str:
    keys = sa.inspect(bind).get_pk_constraint(table).get("constrained_columns") or []
    return keys[0] if keys else fallback


def _normalize_states() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    lookups = _lookups()
    unmatched: list[str] = []
    for table, fallback_pk, pairs in _ADDRESSES:
        if not inspector.has_table(table):
            continue
        columns = {column["name"] for column in inspector.get_columns(table)}
        pk = _primary_key(bind, table, fallback_pk)
        for state_column, country_column in pairs:
            if state_column not in columns or country_column not in columns:
                continue
            rows = bind.execute(
                sa.text(
                    f"SELECT {pk}, {state_column}, {country_column} FROM {table} "
                    f"WHERE {state_column} IS NOT NULL AND {country_column} IS NOT NULL"
                )
            ).fetchall()
            for record_id, state, country in rows:
                lookup = lookups.get(str(country).strip().upper())
                if not str(state).strip() or not lookup:
                    continue
                resolved = lookup.get(_fold(str(state)))
                if resolved is None:
                    unmatched.append(f"{table}.{state_column} #{record_id}: {state!r} ({country})")
                elif resolved != state:
                    bind.execute(
                        sa.text(f"UPDATE {table} SET {state_column} = :state WHERE {pk} = :id"),
                        {"state": resolved, "id": record_id},
                    )
    if unmatched:
        print("States that match no state or province of their country (left as they are):")
        for line in unmatched:
            print(f"  {line}")


def upgrade() -> None:
    op.create_table(
        "picklist_dependencies",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("module_key", sa.String(length=100), nullable=False),
        sa.Column("controlling_field_key", sa.String(length=150), nullable=False),
        sa.Column("dependent_field_key", sa.String(length=150), nullable=False),
        sa.Column("value_map", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "module_key", "dependent_field_key", name="uq_picklist_deps_dependent"),
        sa.CheckConstraint("controlling_field_key <> dependent_field_key", name="ck_picklist_deps_distinct"),
    )
    op.create_index("ix_picklist_dependencies_id", "picklist_dependencies", ["id"])
    op.create_index("ix_picklist_dependencies_tenant_id", "picklist_dependencies", ["tenant_id"])
    op.create_index("ix_picklist_dependencies_module_key", "picklist_dependencies", ["module_key"])
    _normalize_states()


def downgrade() -> None:
    op.drop_index("ix_picklist_dependencies_module_key", table_name="picklist_dependencies")
    op.drop_index("ix_picklist_dependencies_tenant_id", table_name="picklist_dependencies")
    op.drop_index("ix_picklist_dependencies_id", table_name="picklist_dependencies")
    op.drop_table("picklist_dependencies")
