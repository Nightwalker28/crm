"""Standard records the way the major players model them (13b Phase 3, F2.6)

- Leads and contacts: email is optional; a record needs an email or a phone (13a A9). Leads
  and contacts gain a mobile phone, contacts a salutation and a mailing address.
- Accounts: billing and shipping addresses (13a C2), an account type, an employee count, and
  `annual_revenue` as a number (13a A4, A11): `LKR 75M` becomes 75000000. Accounts that have
  an order or an invoice become customers.
- Deals: a numeric `amount` parsed from `total_cost_of_project` (13a A4), a type, a source, a
  next step and a lost reason. The agency fields (13a C1) become custom fields, with their
  data, in tenants where any deal used them; `campaign_type` becomes a picklist field with its
  own list. `client` goes: a deal with neither account nor contact gets the account its client
  text names, made if missing. A deal then needs an account or a contact.
- Quotes and orders: billing and shipping addresses, a customer PO reference, terms, a
  shipping method and charge, and a lost (declined, cancelled) reason (13a C3). An order's
  free-text delivery address becomes its shipping street.
- Products and services: a list price apart from the website price, a tax category; products
  get weight and dimensions, and both get a gallery (`catalog_item_images`, 13a C4).

Values that do not parse are printed, not guessed. The downgrade refuses.

Revision ID: 20261010_standard_records
Revises: 20261009_field_system
Create Date: 2026-10-06
"""

from __future__ import annotations

import json
import re
from decimal import Decimal, InvalidOperation
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20261010_standard_records"
down_revision: Union[str, None] = "20261009_field_system"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

KEY_RE = re.compile(r"[^a-z0-9]+")
NUMBER_RE = re.compile(r"(-?\d+(?:\.\d+)?)\s*([kmb])?\b", re.IGNORECASE)
SCALE = {"k": Decimal(1_000), "m": Decimal(1_000_000), "b": Decimal(1_000_000_000)}

# Deal agency columns → (custom field type, label).
AGENCY_FIELDS = [
    ("campaign_type", "picklist", "Campaign type"),
    ("total_leads", "number", "Total leads"),
    ("cpl", "currency", "Cost per lead"),
    ("domain_cap", "text", "Domain cap"),
    ("tactics", "long_text", "Tactics"),
    ("target_audience", "long_text", "Target audience"),
    ("target_geography", "text", "Target geography"),
    ("delivery_format", "text", "Delivery format"),
    ("attachments", "long_text", "Attachments"),
]
RETIRED_DEAL_FIELD_KEYS = ("client", "total_cost_of_project", *[column for column, _type, _label in AGENCY_FIELDS])


def _slug(label: str) -> str:
    return KEY_RE.sub("_", str(label).strip().casefold()).strip("_")[:90] or "value"


def parse_amount(text: str | None) -> Decimal | None:
    """`150000`, `1,250.50`, `LKR 75M`, `2.5k` → a number; anything else → None."""
    if text is None:
        return None
    cleaned = str(text).replace(",", "").strip()
    if not cleaned:
        return None
    match = NUMBER_RE.search(cleaned)
    if not match:
        return None
    try:
        value = Decimal(match.group(1))
    except InvalidOperation:
        return None
    if match.group(2):
        value *= SCALE[match.group(2).lower()]
    return value if value >= 0 else None


def _people() -> None:
    op.add_column("sales_leads", sa.Column("mobile_phone", sa.Text(), nullable=True))
    op.alter_column("sales_leads", "primary_email", nullable=True)
    op.create_check_constraint("ck_sales_leads_reachable", "sales_leads",
                               "primary_email IS NOT NULL OR phone IS NOT NULL OR mobile_phone IS NOT NULL")
    op.drop_column("sales_leads", "search_doc")
    op.add_column("sales_leads", sa.Column("search_doc", sa.Text(), sa.Computed(
        "lower(coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || "
        "coalesce(company, '') || ' ' || coalesce(primary_email, '') || ' ' || "
        "coalesce(phone, '') || ' ' || coalesce(mobile_phone, '') || ' ' || coalesce(title, '') || ' ' || "
        "coalesce(source, '') || ' ' || coalesce(status, ''))", persisted=True), nullable=True))

    op.add_column("sales_contacts", sa.Column("salutation", sa.Text(), nullable=True))
    op.add_column("sales_contacts", sa.Column("mobile_phone", sa.Text(), nullable=True))
    for column in ("mailing_address", "mailing_street2", "mailing_city", "mailing_state", "mailing_postal_code"):
        op.add_column("sales_contacts", sa.Column(column, sa.Text(), nullable=True))
    op.alter_column("sales_contacts", "primary_email", nullable=True)
    op.create_check_constraint("ck_sales_contacts_reachable", "sales_contacts",
                               "primary_email IS NOT NULL OR contact_telephone IS NOT NULL OR mobile_phone IS NOT NULL")
    op.drop_column("sales_contacts", "search_doc")
    op.add_column("sales_contacts", sa.Column("search_doc", sa.Text(), sa.Computed(
        "lower(coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || "
        "coalesce(contact_telephone, '') || ' ' || coalesce(mobile_phone, '') || ' ' || coalesce(primary_email, '') || ' ' || "
        "coalesce(current_title, '') || ' ' || coalesce(region, '') || ' ' || "
        "coalesce(country, '') || ' ' || coalesce(linkedin_url, ''))", persisted=True), nullable=True))


def _accounts(bind) -> None:
    op.add_column("sales_organizations", sa.Column("account_type", sa.Text(), nullable=True))
    op.add_column("sales_organizations", sa.Column("employee_count", sa.Integer(), nullable=True))
    op.add_column("sales_organizations", sa.Column("billing_street2", sa.Text(), nullable=True))
    for column in ("shipping_address", "shipping_street2", "shipping_city", "shipping_state", "shipping_postal_code", "shipping_country"):
        op.add_column("sales_organizations", sa.Column(column, sa.Text(), nullable=True))
    op.add_column("sales_organizations", sa.Column("annual_revenue_amount", sa.Numeric(18, 2), nullable=True))
    for org_id, tenant_id, raw in bind.execute(sa.text(
        "SELECT org_id, tenant_id, annual_revenue FROM sales_organizations WHERE annual_revenue IS NOT NULL AND btrim(annual_revenue) <> ''"
    )).fetchall():
        value = parse_amount(raw)
        if value is None:
            print(f"20261010_standard_records: tenant {tenant_id}: account {org_id} annual revenue {raw!r} is not a number; left empty")
            continue
        bind.execute(sa.text("UPDATE sales_organizations SET annual_revenue_amount = :v WHERE org_id = :id"), {"v": value, "id": org_id})
    op.drop_column("sales_organizations", "annual_revenue")
    op.alter_column("sales_organizations", "annual_revenue_amount", new_column_name="annual_revenue")
    # Accounts that bought something are customers; the rest wait for someone to say.
    bind.execute(sa.text(
        "UPDATE sales_organizations o SET account_type = 'customer' WHERE account_type IS NULL AND ("
        "EXISTS (SELECT 1 FROM sales_orders s WHERE s.organization_id = o.org_id AND s.tenant_id = o.tenant_id) OR "
        "EXISTS (SELECT 1 FROM finance_pos_invoices i WHERE i.customer_organization_id = o.org_id AND i.tenant_id = o.tenant_id))"
    ))


def _deal_field(bind, tenant_id: int, column: str, kind: str, label: str, values: list[tuple[int, str]]) -> None:
    taken = {row[0] for row in bind.execute(sa.text(
        "SELECT field_key FROM field_definitions WHERE tenant_id = :t AND module_key = 'sales_opportunities' AND deleted_at IS NULL"
    ), {"t": tenant_id})}
    key, suffix = column, 2
    while key in taken:
        key, suffix = f"{column}_{suffix}", suffix + 1
    picklist_id = None
    option_keys: dict[str, str] = {}
    if kind == "picklist":
        lists = {row[0] for row in bind.execute(sa.text("SELECT key FROM picklists WHERE tenant_id = :t"), {"t": tenant_id})}
        list_key, n = "campaign_type", 2
        while list_key in lists:
            list_key, n = f"campaign_type_{n}", n + 1
        picklist_id = bind.execute(sa.text(
            "INSERT INTO picklists (tenant_id, key, label, scope, is_system, is_locked) VALUES (:t, :k, :l, 'local', false, false) RETURNING id"
        ), {"t": tenant_id, "k": list_key, "l": label}).scalar_one()
        for position, text in enumerate(sorted({value.strip() for _id, value in values})):
            option_key, n = _slug(text), 2
            while option_key in option_keys.values():
                option_key, n = f"{_slug(text)}_{n}", n + 1
            option_keys[text] = option_key
            bind.execute(sa.text(
                "INSERT INTO picklist_values (tenant_id, picklist_id, key, label, position, is_active, is_default) "
                "VALUES (:t, :p, :k, :l, :pos, true, false)"
            ), {"t": tenant_id, "p": picklist_id, "k": option_key, "l": text[:150], "pos": position})
    definition_id = bind.execute(sa.text(
        "INSERT INTO field_definitions (tenant_id, module_key, field_key, label, field_type, picklist_id, sort_order) "
        "VALUES (:t, 'sales_opportunities', :k, :l, :type, :p, 100) RETURNING id"
    ), {"t": tenant_id, "k": key, "l": label, "type": kind, "p": picklist_id}).scalar_one()
    for record_id, raw in values:
        text = raw.strip()
        payload = {"text": None, "number": None}
        if kind == "picklist":
            payload["text"] = option_keys[text]
        elif kind in {"number", "currency"}:
            number = parse_amount(text)
            if number is None:
                print(f"20261010_standard_records: tenant {tenant_id}: deal {record_id} {column} {raw!r} is not a number; left empty")
                continue
            payload["number"] = number if kind == "currency" else number.to_integral_value()
        elif column == "attachments":
            try:
                parsed = json.loads(text)
                text = "\n".join(str(item) for item in parsed) if isinstance(parsed, list) else text
            except ValueError:
                pass
            payload["text"] = text
        else:
            payload["text"] = text
        bind.execute(sa.text(
            "INSERT INTO field_values (tenant_id, module_key, record_id, field_definition_id, value_text, value_number) "
            "VALUES (:t, 'sales_opportunities', :r, :d, :text, :number)"
        ), {"t": tenant_id, "r": record_id, "d": definition_id, **payload})


def _deals(bind) -> None:
    for column in ("deal_type", "source", "next_step", "lost_reason"):
        op.add_column("sales_opportunities", sa.Column(column, sa.Text(), nullable=True))
    op.add_column("sales_opportunities", sa.Column("amount", sa.Numeric(18, 2), nullable=True))
    for deal_id, tenant_id, raw in bind.execute(sa.text(
        "SELECT opportunity_id, tenant_id, total_cost_of_project FROM sales_opportunities "
        "WHERE total_cost_of_project IS NOT NULL AND btrim(total_cost_of_project) <> ''"
    )).fetchall():
        value = parse_amount(raw)
        if value is None:
            print(f"20261010_standard_records: tenant {tenant_id}: deal {deal_id} amount {raw!r} is not a number; left empty")
            continue
        bind.execute(sa.text("UPDATE sales_opportunities SET amount = :v WHERE opportunity_id = :id"), {"v": value, "id": deal_id})

    for column, kind, label in AGENCY_FIELDS:
        rows = bind.execute(sa.text(
            f"SELECT tenant_id, opportunity_id, {column} FROM sales_opportunities WHERE {column} IS NOT NULL AND btrim({column}) <> '' "
            f"AND {column} <> '[]' ORDER BY tenant_id, opportunity_id"
        )).fetchall()
        by_tenant: dict[int, list[tuple[int, str]]] = {}
        for tenant_id, record_id, value in rows:
            by_tenant.setdefault(tenant_id, []).append((record_id, value))
        for tenant_id, values in by_tenant.items():
            _deal_field(bind, tenant_id, column, kind, label, values)

    # A deal with neither account nor contact meant its client text: that account, made if missing.
    for deal_id, tenant_id, client in bind.execute(sa.text(
        "SELECT opportunity_id, tenant_id, client FROM sales_opportunities WHERE organization_id IS NULL AND contact_id IS NULL"
    )).fetchall():
        name = (client or "").strip() or f"Deal {deal_id} account"
        org_id = bind.execute(sa.text(
            "SELECT org_id FROM sales_organizations WHERE tenant_id = :t AND deleted_at IS NULL AND lower(org_name) = lower(:n) ORDER BY org_id LIMIT 1"
        ), {"t": tenant_id, "n": name}).scalar()
        if org_id is None:
            org_id = bind.execute(sa.text(
                "INSERT INTO sales_organizations (tenant_id, org_name) VALUES (:t, :n) RETURNING org_id"
            ), {"t": tenant_id, "n": name}).scalar_one()
        bind.execute(sa.text("UPDATE sales_opportunities SET organization_id = :o WHERE opportunity_id = :id"), {"o": org_id, "id": deal_id})

    bind.execute(sa.text(
        "DELETE FROM module_field_configs WHERE module_key = 'sales_opportunities' AND field_key IN :keys"
    ).bindparams(sa.bindparam("keys", expanding=True)), {"keys": list(RETIRED_DEAL_FIELD_KEYS)})
    for column in RETIRED_DEAL_FIELD_KEYS:
        op.drop_column("sales_opportunities", column)
    op.create_check_constraint("ck_sales_opportunities_amount", "sales_opportunities", "amount IS NULL OR amount >= 0")
    op.create_check_constraint("ck_sales_opportunities_party", "sales_opportunities", "organization_id IS NOT NULL OR contact_id IS NOT NULL")


def _documents(bind) -> None:
    for table in ("sales_quotes", "sales_orders"):
        for prefix in ("billing", "shipping"):
            for part in ("address", "street2", "city", "state", "postal_code", "country"):
                op.add_column(table, sa.Column(f"{prefix}_{part}", sa.Text(), nullable=True))
        op.add_column(table, sa.Column("customer_po_reference", sa.Text(), nullable=True))
        op.add_column(table, sa.Column("terms_and_conditions", sa.Text(), nullable=True))
        op.add_column(table, sa.Column("shipping_method", sa.Text(), nullable=True))
        op.add_column(table, sa.Column("shipping_charge", sa.Numeric(18, 2), nullable=False, server_default="0"))
        op.add_column(table, sa.Column("lost_reason", sa.Text(), nullable=True))
    bind.execute(sa.text("UPDATE sales_orders SET shipping_address = delivery_address WHERE delivery_address IS NOT NULL"))
    op.drop_column("sales_orders", "delivery_address")


def _catalog() -> None:
    for table in ("catalog_products", "catalog_services"):
        op.add_column(table, sa.Column("list_price", sa.Numeric(12, 4), nullable=True))
        op.add_column(table, sa.Column("tax_category", sa.String(100), nullable=True))
        op.execute(f"UPDATE {table} SET list_price = public_unit_price")
    for column in ("weight", "length", "width", "height"):
        op.add_column("catalog_products", sa.Column(column, sa.Numeric(12, 4), nullable=True))
    op.add_column("catalog_products", sa.Column("weight_unit", sa.String(10), nullable=True))
    op.add_column("catalog_products", sa.Column("dimension_unit", sa.String(10), nullable=True))
    op.create_table(
        "catalog_item_images",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("item_kind", sa.String(10), nullable=False),
        sa.Column("item_id", sa.BigInteger(), nullable=False),
        sa.Column("media_path", sa.String(500), nullable=False),
        sa.Column("media_content_type", sa.String(120), nullable=True),
        sa.Column("media_original_filename", sa.String(255), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("item_kind IN ('product', 'service')", name="ck_catalog_item_images_kind"),
    )
    op.create_index("ix_catalog_item_images_id", "catalog_item_images", ["id"])
    op.create_index("ix_catalog_item_images_tenant_id", "catalog_item_images", ["tenant_id"])
    op.create_index("ix_catalog_item_images_item", "catalog_item_images", ["tenant_id", "item_kind", "item_id", "position"])


def upgrade() -> None:
    bind = op.get_bind()
    _people()
    _accounts(bind)
    _deals(bind)
    _documents(bind)
    _catalog()


def downgrade() -> None:
    raise NotImplementedError("The deal's agency columns and client text moved into custom fields for good; restore from a backup instead.")
