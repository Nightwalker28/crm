"""Tenant-managed picklists (13b Phase 1, F2.1–F2.4)

- `picklists` and `picklist_values`; the system lists are seeded for every tenant (later
  tenants are seeded on first use by `ensure_picklist`).
- Lead status becomes the `lead_status` list. Its keys are the old status values, so no lead
  changes; each value gets a meaning, and `ck_sales_leads_status` goes.
- The free-text fields that become picklists keep their data: every distinct value becomes a
  list value (matched to a seeded value by key or label first, case-insensitively) and records
  are rewritten to its key. Blank strings become empty.
- Countries are matched to ISO 3166-1 codes. A value that matches no country is left as it
  is; Settings → Picklists shows it under *Values not in the list*, and this migration
  prints it.

The seed lists are a snapshot taken here, so later changes to the service's defaults never
rewrite history.

Revision ID: 20261008_picklists
Revises: 20261007_retire_modules
Create Date: 2026-10-05
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20261008_picklists"
down_revision: Union[str, None] = "20261007_retire_modules"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# key, label, scope, meaning_set, is_locked, values (key, label, meaning, tone, is_default)
SEED = [
    ("lead_status", "Lead status", "local", "lead_status", False, [
        ("new", "New", "open", None, True),
        ("contacted", "Contacted", "working", None, False),
        ("qualified", "Qualified", "qualified", None, False),
        ("unqualified", "Unqualified", "unqualified", "neutral", False),
        ("converted", "Converted", "converted", "success", False),
    ]),
    ("lead_source", "Lead source", "global", None, False, [
        ("website", "Website"), ("referral", "Referral"), ("email_campaign", "Email campaign"), ("event", "Event"),
        ("social_media", "Social media"), ("advertisement", "Advertisement"), ("cold_call", "Cold call"),
        ("partner", "Partner"), ("booking_link", "Booking page"), ("other", "Other"),
    ]),
    ("industry", "Industry", "global", None, False, [
        ("agriculture", "Agriculture"), ("construction", "Construction"), ("education", "Education"),
        ("financial_services", "Financial services"), ("healthcare", "Healthcare"), ("hospitality", "Hospitality"),
        ("logistics", "Logistics"), ("manufacturing", "Manufacturing"), ("media", "Media"),
        ("professional_services", "Professional services"), ("real_estate", "Real estate"), ("retail", "Retail"),
        ("technology", "Technology"), ("other", "Other"),
    ]),
    ("account_type", "Account type", "local", None, False, [
        ("prospect", "Prospect"), ("customer", "Customer"), ("partner", "Partner"), ("competitor", "Competitor"), ("other", "Other"),
    ]),
    ("region", "Region", "local", None, False, []),
    ("salutation", "Salutation", "local", None, False, [
        ("mr", "Mr."), ("ms", "Ms."), ("mrs", "Mrs."), ("mx", "Mx."), ("dr", "Dr."), ("prof", "Prof."),
    ]),
    ("deal_type", "Deal type", "local", None, False, [("new_business", "New business"), ("existing_business", "Existing business")]),
    ("lost_reason", "Lost reason", "global", None, False, [
        ("price", "Price"), ("competitor", "Went with a competitor"), ("no_budget", "No budget"),
        ("no_decision", "No decision"), ("timing", "Timing"), ("other", "Other"),
    ]),
    ("payment_method", "Payment method", "global", None, False, [
        ("cash", "Cash"), ("bank_transfer", "Bank transfer"), ("card", "Card"), ("cheque", "Cheque"), ("online", "Online"),
    ]),
    ("unit", "Unit", "global", None, False, [("unit", "Unit", None, None, True)]),
    ("shipping_method", "Shipping method", "local", None, False, []),
    ("tax_category", "Tax category", "local", None, False, [
        ("standard", "Standard", None, None, True), ("reduced", "Reduced"), ("zero", "Zero-rated"), ("exempt", "Exempt"),
    ]),
    ("country", "Country", "global", None, True, None),  # values: ISO 3166-1
]

# Free-text columns whose values become list values: (table, column, list key).
FREE_TEXT = [
    ("sales_leads", "source", "lead_source"),
    ("sales_organizations", "industry", "industry"),
    ("sales_contacts", "region", "region"),
    ("finance_pos_invoices", "payment_method", "payment_method"),
    ("finance_payments", "method", "payment_method"),
    ("catalog_products", "unit", "unit"),
    ("catalog_services", "unit", "unit"),
]
COUNTRY_COLUMNS = [("sales_contacts", "country"), ("sales_organizations", "billing_country")]
COUNTRY_ALIASES = {
    "usa": "US", "united states of america": "US", "america": "US", "uk": "GB", "britain": "GB",
    "great britain": "GB", "england": "GB", "uae": "AE", "russia": "RU", "south korea": "KR", "korea": "KR",
    "vietnam": "VN", "iran": "IR", "syria": "SY", "laos": "LA", "bolivia": "BO", "venezuela": "VE",
    "tanzania": "TZ", "moldova": "MD", "czech republic": "CZ", "taiwan": "TW",
}
KEY_RE = re.compile(r"[^a-z0-9]+")


def _countries() -> list[tuple[str, str]]:
    path = Path(__file__).resolve().parents[2] / "app" / "core" / "data" / "iso_3166_1.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    return [(item["code"], item["name"]) for item in data["countries"]]


def _slug(label: str) -> str:
    return KEY_RE.sub("_", label.strip().casefold()).strip("_")[:90] or "value"


def _label(raw: str) -> str:
    return raw if any(char.isupper() for char in raw) else raw[:1].upper() + raw[1:]


def _create_tables() -> None:
    op.create_table(
        "picklists",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("key", sa.String(100), nullable=False),
        sa.Column("label", sa.String(150), nullable=False),
        sa.Column("scope", sa.String(20), nullable=False, server_default="global"),
        sa.Column("meaning_set", sa.String(50), nullable=True),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_locked", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "key", name="uq_picklists_tenant_key"),
        sa.UniqueConstraint("tenant_id", "id", name="uq_picklists_tenant_id"),
        sa.CheckConstraint("scope IN ('global', 'local')", name="ck_picklists_scope"),
    )
    op.create_index("ix_picklists_id", "picklists", ["id"])
    op.create_index("ix_picklists_tenant_id", "picklists", ["tenant_id"])
    op.create_table(
        "picklist_values",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("picklist_id", sa.BigInteger(), nullable=False),
        sa.Column("key", sa.String(100), nullable=False),
        sa.Column("label", sa.String(150), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("tone", sa.String(20), nullable=True),
        sa.Column("meaning", sa.String(50), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "picklist_id", "key", name="uq_picklist_values_list_key"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "picklist_id"], ["picklists.tenant_id", "picklists.id"],
            ondelete="CASCADE", name="fk_picklist_values_tenant_list",
        ),
        sa.CheckConstraint("tone IS NULL OR tone IN ('neutral', 'success', 'attention', 'critical')", name="ck_picklist_values_tone"),
        sa.CheckConstraint("NOT is_default OR is_active", name="ck_picklist_values_default_active"),
    )
    op.create_index("ix_picklist_values_id", "picklist_values", ["id"])
    op.create_index("ix_picklist_values_tenant_id", "picklist_values", ["tenant_id"])
    op.create_index("ix_picklist_values_picklist_id", "picklist_values", ["picklist_id"])
    op.create_index("ix_picklist_values_list_position", "picklist_values", ["picklist_id", "position"])
    op.create_index(
        "uq_picklist_values_default", "picklist_values", ["picklist_id"], unique=True,
        postgresql_where=sa.text("is_default"),
    )


def _seed_tenant(bind, tenant_id: int, countries: list[tuple[str, str]]) -> dict[str, dict]:
    """Seeds one tenant's lists; returns {list key: {"id", "values": {key: label}}}."""
    lists: dict[str, dict] = {}
    for key, label, scope, meaning_set, locked, values in SEED:
        list_id = bind.execute(
            sa.text(
                "INSERT INTO picklists (tenant_id, key, label, scope, meaning_set, is_system, is_locked) "
                "VALUES (:t, :k, :l, :s, :m, true, :locked) RETURNING id"
            ),
            {"t": tenant_id, "k": key, "l": label, "s": scope, "m": meaning_set, "locked": locked},
        ).scalar_one()
        rows = [(code, name, None, None, False) for code, name in countries] if values is None else values
        known: dict[str, str] = {}
        for position, row in enumerate(rows):
            value_key, value_label, meaning, tone, is_default = (tuple(row) + (None, None, False))[:5]
            bind.execute(
                sa.text(
                    "INSERT INTO picklist_values (tenant_id, picklist_id, key, label, position, is_active, is_default, tone, meaning) "
                    "VALUES (:t, :p, :k, :l, :pos, true, :d, :tone, :m)"
                ),
                {"t": tenant_id, "p": list_id, "k": value_key, "l": value_label, "pos": position,
                 "d": bool(is_default), "tone": tone, "m": meaning},
            )
            known[value_key] = value_label
        lists[key] = {"id": list_id, "values": known}
    return lists


def _adopt_free_text(bind, tenant_id: int, lists: dict[str, dict]) -> None:
    for table, column, list_key in FREE_TEXT:
        bind.execute(sa.text(f"UPDATE {table} SET {column} = NULL WHERE tenant_id = :t AND btrim({column}) = ''"), {"t": tenant_id})
        raws = [
            row[0]
            for row in bind.execute(
                sa.text(f"SELECT DISTINCT {column} FROM {table} WHERE tenant_id = :t AND {column} IS NOT NULL ORDER BY 1"),
                {"t": tenant_id},
            )
        ]
        target = lists[list_key]
        for raw in raws:
            text = " ".join(raw.split())
            folded = text.casefold()
            key = next((k for k in target["values"] if k.casefold() == folded), None)
            if key is None:
                key = next((k for k, label in target["values"].items() if label.casefold() == folded), None)
            if key is None:
                key = next((k for k in target["values"] if k == _slug(text)), None)
            if key is None:
                base, key, suffix = _slug(text), _slug(text), 2
                while key in target["values"]:
                    key = f"{base}_{suffix}"
                    suffix += 1
                position = len(target["values"])
                bind.execute(
                    sa.text(
                        "INSERT INTO picklist_values (tenant_id, picklist_id, key, label, position, is_active, is_default) "
                        "VALUES (:t, :p, :k, :l, :pos, true, false)"
                    ),
                    {"t": tenant_id, "p": target["id"], "k": key, "l": _label(text)[:150], "pos": position},
                )
                target["values"][key] = _label(text)
            if key != raw:
                bind.execute(
                    sa.text(f"UPDATE {table} SET {column} = :k WHERE tenant_id = :t AND {column} = :raw"),
                    {"k": key, "t": tenant_id, "raw": raw},
                )


def _match_countries(bind, tenant_id: int, lookup: dict[str, str]) -> list[str]:
    unmatched: list[str] = []
    for table, column in COUNTRY_COLUMNS:
        bind.execute(sa.text(f"UPDATE {table} SET {column} = NULL WHERE tenant_id = :t AND btrim({column}) = ''"), {"t": tenant_id})
        for (raw,) in bind.execute(
            sa.text(f"SELECT DISTINCT {column} FROM {table} WHERE tenant_id = :t AND {column} IS NOT NULL"), {"t": tenant_id}
        ):
            code = lookup.get(" ".join(raw.split()).casefold())
            if code is None:
                unmatched.append(f"{table}.{column}: {raw!r}")
            elif code != raw:
                bind.execute(
                    sa.text(f"UPDATE {table} SET {column} = :c WHERE tenant_id = :t AND {column} = :raw"),
                    {"c": code, "t": tenant_id, "raw": raw},
                )
    return unmatched


def upgrade() -> None:
    _create_tables()
    bind = op.get_bind()
    countries = _countries()
    lookup = {code.casefold(): code for code, _name in countries}
    lookup.update({name.casefold(): code for code, name in countries})
    for alias, code in COUNTRY_ALIASES.items():
        lookup.setdefault(alias, code)

    op.drop_constraint("ck_sales_leads_status", "sales_leads", type_="check")
    for (tenant_id,) in bind.execute(sa.text("SELECT id FROM tenants ORDER BY id")).fetchall():
        lists = _seed_tenant(bind, tenant_id, countries)
        _adopt_free_text(bind, tenant_id, lists)
        unmatched = _match_countries(bind, tenant_id, lookup)
        # A status outside the old check could not exist, but a lead must never point at a
        # key its list lacks: anything else becomes the default.
        bind.execute(
            sa.text("UPDATE sales_leads SET status = 'new' WHERE tenant_id = :t AND status NOT IN ('new', 'contacted', 'qualified', 'unqualified', 'converted')"),
            {"t": tenant_id},
        )
        for item in unmatched:
            print(f"20261008_picklists: tenant {tenant_id}: no ISO country for {item}; left as it is")


def downgrade() -> None:
    raise NotImplementedError("Picklist keys replaced the free-text values; restore from a backup instead.")
