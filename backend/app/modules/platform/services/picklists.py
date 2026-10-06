"""Tenant-managed picklists (13b §3.1–3.3).

A picklist is a list of values with a fixed key and an editable label. Records store the
key, so renaming a value never touches them, and a deactivated value stays readable on the
records that hold it. Lists the platform refers to by key are *system* lists, seeded per
tenant on first use (the pipeline pattern: the migration seeds every tenant that existed,
`ensure_picklist` covers the rest).

Logic-bearing lists (lead status) give each value a fixed *meaning*; code reads the meaning,
never the label or the key.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.modules.platform.models import AutomationRule, Picklist, PicklistValue
from app.modules.platform.services.activity_logs import safe_log_activity

PICKLIST_MODULE_KEY = "platform_picklists"
PICKLIST_ENTITY_TYPE = "picklist"
TONES = {"neutral", "success", "attention", "critical"}
KEY_RE = re.compile(r"[^a-z0-9]+")
MAX_LABEL_LENGTH = 150

LEAD_STATUS_LIST = "lead_status"
COUNTRY_LIST = "country"

# What each value of a logic-bearing list can mean, and the meanings that must keep at least
# one active value (conversion needs somewhere to put a converted lead, and so on).
MEANING_SETS: dict[str, tuple[str, ...]] = {
    "lead_status": ("open", "working", "qualified", "unqualified", "converted"),
}
REQUIRED_MEANINGS: dict[str, frozenset[str]] = {
    "lead_status": frozenset({"open", "qualified", "unqualified", "converted"}),
}
# The default value of a meaning set (what a new record starts as) must mean one of these.
DEFAULT_MEANINGS: dict[str, frozenset[str]] = {
    "lead_status": frozenset({"open", "working"}),
}


@dataclass(frozen=True)
class SeedValue:
    key: str
    label: str
    meaning: str | None = None
    tone: str | None = None
    is_default: bool = False


@dataclass(frozen=True)
class SystemPicklist:
    key: str
    label: str
    scope: str = "global"
    meaning_set: str | None = None
    is_locked: bool = False
    values: tuple[SeedValue, ...] = ()


def _seed(*pairs: tuple[str, str]) -> tuple[SeedValue, ...]:
    return tuple(SeedValue(key, label) for key, label in pairs)


@lru_cache(maxsize=1)
def iso_countries() -> tuple[tuple[str, str], ...]:
    """ISO 3166-1 alpha-2 codes and names, bundled from Debian iso-codes (13b §5 decision 6)."""
    path = Path(__file__).resolve().parents[3] / "core" / "data" / "iso_3166_1.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    return tuple((item["code"], item["name"]) for item in data["countries"])


SYSTEM_PICKLISTS: dict[str, SystemPicklist] = {
    item.key: item
    for item in (
        SystemPicklist(
            "lead_status",
            "Lead status",
            scope="local",
            meaning_set="lead_status",
            values=(
                SeedValue("new", "New", meaning="open", is_default=True),
                SeedValue("contacted", "Contacted", meaning="working"),
                SeedValue("qualified", "Qualified", meaning="qualified"),
                SeedValue("unqualified", "Unqualified", meaning="unqualified", tone="neutral"),
                SeedValue("converted", "Converted", meaning="converted", tone="success"),
            ),
        ),
        SystemPicklist(
            "lead_source",
            "Lead source",
            values=_seed(
                ("website", "Website"),
                ("referral", "Referral"),
                ("email_campaign", "Email campaign"),
                ("event", "Event"),
                ("social_media", "Social media"),
                ("advertisement", "Advertisement"),
                ("cold_call", "Cold call"),
                ("partner", "Partner"),
                ("booking_link", "Booking page"),
                ("other", "Other"),
            ),
        ),
        SystemPicklist(
            "industry",
            "Industry",
            values=_seed(
                ("agriculture", "Agriculture"),
                ("construction", "Construction"),
                ("education", "Education"),
                ("financial_services", "Financial services"),
                ("healthcare", "Healthcare"),
                ("hospitality", "Hospitality"),
                ("logistics", "Logistics"),
                ("manufacturing", "Manufacturing"),
                ("media", "Media"),
                ("professional_services", "Professional services"),
                ("real_estate", "Real estate"),
                ("retail", "Retail"),
                ("technology", "Technology"),
                ("other", "Other"),
            ),
        ),
        SystemPicklist(
            "account_type",
            "Account type",
            scope="local",
            values=_seed(
                ("prospect", "Prospect"),
                ("customer", "Customer"),
                ("partner", "Partner"),
                ("competitor", "Competitor"),
                ("other", "Other"),
            ),
        ),
        SystemPicklist("region", "Region", scope="local"),
        SystemPicklist(
            "salutation",
            "Salutation",
            scope="local",
            values=_seed(("mr", "Mr."), ("ms", "Ms."), ("mrs", "Mrs."), ("mx", "Mx."), ("dr", "Dr."), ("prof", "Prof.")),
        ),
        SystemPicklist(
            "deal_type",
            "Deal type",
            scope="local",
            values=_seed(("new_business", "New business"), ("existing_business", "Existing business")),
        ),
        SystemPicklist(
            "lost_reason",
            "Lost reason",
            values=_seed(
                ("price", "Price"),
                ("competitor", "Went with a competitor"),
                ("no_budget", "No budget"),
                ("no_decision", "No decision"),
                ("timing", "Timing"),
                ("other", "Other"),
            ),
        ),
        SystemPicklist(
            "payment_method",
            "Payment method",
            values=_seed(
                ("cash", "Cash"),
                ("bank_transfer", "Bank transfer"),
                ("card", "Card"),
                ("cheque", "Cheque"),
                ("online", "Online"),
            ),
        ),
        SystemPicklist("unit", "Unit", values=(SeedValue("unit", "Unit", is_default=True),)),
        SystemPicklist("shipping_method", "Shipping method", scope="local"),
        SystemPicklist(
            "tax_category",
            "Tax category",
            scope="local",
            values=(
                SeedValue("standard", "Standard", is_default=True),
                SeedValue("reduced", "Reduced"),
                SeedValue("zero", "Zero-rated"),
                SeedValue("exempt", "Exempt"),
            ),
        ),
        SystemPicklist("country", "Country", is_locked=True),
    )
}


@dataclass(frozen=True)
class PicklistBinding:
    """A standard field whose values come from a list."""

    module_key: str
    field_key: str
    label: str
    list_key: str
    model_path: str
    column: str


# Standard fields that store picklist keys. Custom fields join through the field system
# (13b Phase 2). Models are named, not imported, to keep this module import-cycle free.
PICKLIST_BINDINGS: tuple[PicklistBinding, ...] = (
    PicklistBinding("sales_leads", "status", "Status", "lead_status", "sales:SalesLead", "status"),
    PicklistBinding("sales_leads", "source", "Source", "lead_source", "sales:SalesLead", "source"),
    PicklistBinding("sales_organizations", "industry", "Industry", "industry", "sales:SalesOrganization", "industry"),
    PicklistBinding("sales_organizations", "billing_country", "Billing country", "country", "sales:SalesOrganization", "billing_country"),
    PicklistBinding("sales_contacts", "region", "Region", "region", "sales:SalesContact", "region"),
    PicklistBinding("sales_contacts", "country", "Country", "country", "sales:SalesContact", "country"),
    PicklistBinding("finance_pos", "payment_method", "Payment method", "payment_method", "finance:FinancePosInvoice", "payment_method"),
    PicklistBinding("finance_payments", "method", "Method", "payment_method", "finance:FinancePayment", "method"),
    PicklistBinding("catalog_products", "unit", "Unit", "unit", "catalog:CatalogProduct", "unit"),
    PicklistBinding("catalog_services", "unit", "Unit", "unit", "catalog:CatalogService", "unit"),
    # 13b Phase 3: the standard fields F2.6 adds.
    PicklistBinding("sales_organizations", "account_type", "Account type", "account_type", "sales:SalesOrganization", "account_type"),
    PicklistBinding("sales_organizations", "shipping_country", "Shipping country", "country", "sales:SalesOrganization", "shipping_country"),
    PicklistBinding("sales_contacts", "salutation", "Salutation", "salutation", "sales:SalesContact", "salutation"),
    PicklistBinding("sales_opportunities", "deal_type", "Deal type", "deal_type", "sales:SalesOpportunity", "deal_type"),
    PicklistBinding("sales_opportunities", "source", "Source", "lead_source", "sales:SalesOpportunity", "source"),
    PicklistBinding("sales_opportunities", "lost_reason", "Lost reason", "lost_reason", "sales:SalesOpportunity", "lost_reason"),
    PicklistBinding("sales_quotes", "shipping_method", "Shipping method", "shipping_method", "sales:SalesQuote", "shipping_method"),
    PicklistBinding("sales_quotes", "lost_reason", "Lost reason", "lost_reason", "sales:SalesQuote", "lost_reason"),
    PicklistBinding("sales_quotes", "billing_country", "Billing country", "country", "sales:SalesQuote", "billing_country"),
    PicklistBinding("sales_quotes", "shipping_country", "Shipping country", "country", "sales:SalesQuote", "shipping_country"),
    PicklistBinding("sales_orders", "shipping_method", "Shipping method", "shipping_method", "sales:SalesOrder", "shipping_method"),
    PicklistBinding("sales_orders", "lost_reason", "Lost reason", "lost_reason", "sales:SalesOrder", "lost_reason"),
    PicklistBinding("sales_orders", "billing_country", "Billing country", "country", "sales:SalesOrder", "billing_country"),
    PicklistBinding("sales_orders", "shipping_country", "Shipping country", "country", "sales:SalesOrder", "shipping_country"),
    PicklistBinding("catalog_products", "tax_category", "Tax category", "tax_category", "catalog:CatalogProduct", "tax_category"),
    PicklistBinding("catalog_services", "tax_category", "Tax category", "tax_category", "catalog:CatalogService", "tax_category"),
)


def bindings_for_module(module_key: str) -> dict[str, PicklistBinding]:
    return {binding.field_key: binding for binding in PICKLIST_BINDINGS if binding.module_key == module_key}


def bindings_for_list(list_key: str) -> list[PicklistBinding]:
    return [binding for binding in PICKLIST_BINDINGS if binding.list_key == list_key]


def binding_list_key(module_key: str, field_key: str) -> str | None:
    binding = bindings_for_module(module_key).get(field_key)
    return binding.list_key if binding else None


def _binding_model(binding: PicklistBinding):
    area, name = binding.model_path.split(":")
    if area == "sales":
        from app.modules.sales import models as module
    elif area == "finance":
        from app.modules.finance import models as module
    elif area == "catalog":
        from app.modules.catalog import models as module
    else:  # pragma: no cover - a binding names an area this function does not know
        raise ValueError(f"Unknown binding area {area!r}")
    return getattr(module, name)


# --- seeding -------------------------------------------------------------------------


def _seed_values(definition: SystemPicklist) -> list[SeedValue]:
    if definition.key == COUNTRY_LIST:
        return [SeedValue(code, name) for code, name in iso_countries()]
    return list(definition.values)


def _query_list(db: Session, tenant_id: int, key: str) -> Picklist | None:
    return (
        db.query(Picklist)
        .options(selectinload(Picklist.values))
        .filter(Picklist.tenant_id == tenant_id, Picklist.key == key)
        .first()
    )


def ensure_picklist(db: Session, tenant_id: int, key: str) -> Picklist:
    """The tenant's list, seeding a system list on first use.

    Flushes but does not commit: the caller's transaction owns the seed. A concurrent first
    use loses on the unique key and reads the winner's list.
    """
    picklist = _query_list(db, tenant_id, key)
    if picklist is not None:
        return picklist
    definition = SYSTEM_PICKLISTS.get(key)
    if definition is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Picklist not found")
    try:
        with db.begin_nested():
            picklist = Picklist(
                tenant_id=tenant_id,
                key=definition.key,
                label=definition.label,
                scope=definition.scope,
                meaning_set=definition.meaning_set,
                is_system=True,
                is_locked=definition.is_locked,
            )
            picklist.values = [
                PicklistValue(
                    tenant_id=tenant_id,
                    key=value.key,
                    label=value.label,
                    position=index,
                    is_active=True,
                    is_default=value.is_default,
                    tone=value.tone,
                    meaning=value.meaning,
                )
                for index, value in enumerate(_seed_values(definition))
            ]
            db.add(picklist)
            db.flush()
    except IntegrityError:
        picklist = _query_list(db, tenant_id, key)
        if picklist is None:
            raise
    return picklist


def ensure_system_picklists(db: Session, tenant_id: int) -> list[Picklist]:
    return [ensure_picklist(db, tenant_id, key) for key in SYSTEM_PICKLISTS]


def get_picklist(db: Session, tenant_id: int, key: str) -> Picklist:
    if key in SYSTEM_PICKLISTS:
        return ensure_picklist(db, tenant_id, key)
    picklist = _query_list(db, tenant_id, key)
    if picklist is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Picklist not found")
    return picklist


def list_picklists(db: Session, tenant_id: int) -> list[Picklist]:
    ensure_system_picklists(db, tenant_id)
    return (
        db.query(Picklist)
        .options(selectinload(Picklist.values))
        .filter(Picklist.tenant_id == tenant_id)
        .order_by(Picklist.label.asc(), Picklist.id.asc())
        .all()
    )


# --- reading values --------------------------------------------------------------------


def _field_error(field_key: str | None, message: str) -> HTTPException:
    if field_key:
        return HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=[{"loc": ["body", field_key], "msg": message, "type": "domain"}],
        )
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=message)


class PicklistResolver:
    """Resolves raw values to keys for one tenant, loading each list once.

    One resolver per request or import: an import of 10,000 rows reads each list once.
    """

    def __init__(self, db: Session, tenant_id: int, *, allow_create: bool = False):
        self.db = db
        self.tenant_id = tenant_id
        self.allow_create = allow_create
        self._lists: dict[str, Picklist] = {}
        self.created: list[tuple[str, str]] = []

    def picklist(self, list_key: str) -> Picklist:
        if list_key not in self._lists:
            self._lists[list_key] = get_picklist(self.db, self.tenant_id, list_key)
        return self._lists[list_key]

    def value(self, list_key: str, key: str | None) -> PicklistValue | None:
        if not key:
            return None
        for value in self.picklist(list_key).values:
            if value.key == key:
                return value
        return None

    def label(self, list_key: str, key: str | None) -> str | None:
        if key is None or key == "":
            return None
        value = self.value(list_key, key)
        return value.label if value else key

    def meaning(self, list_key: str, key: str | None) -> str | None:
        value = self.value(list_key, key)
        return value.meaning if value else None

    def default_key(self, list_key: str) -> str | None:
        for value in self.picklist(list_key).values:
            if value.is_default and value.is_active:
                return value.key
        return None

    def key_for_meaning(self, list_key: str, meaning: str) -> str | None:
        """The value a record gets when logic moves it to `meaning`: the default if it
        means that, else the first active value in list order."""
        values = [value for value in self.picklist(list_key).values if value.is_active and value.meaning == meaning]
        for value in values:
            if value.is_default:
                return value.key
        return values[0].key if values else None

    def keys_for_meanings(self, list_key: str, meanings: Iterable[str]) -> set[str]:
        wanted = set(meanings)
        return {value.key for value in self.picklist(list_key).values if value.meaning in wanted}

    def resolve(
        self,
        list_key: str,
        raw: Any,
        *,
        current: str | None = None,
        field_key: str | None = None,
        field_label: str | None = None,
    ) -> str | None:
        """The key for `raw`, matched on key, then label, then (countries) any spelling.

        Empty stays empty. An inactive value is accepted only when the record already holds
        it. An unknown value is refused, or added when the resolver allows it (imports where
        the admin chose to).
        """
        if raw is None:
            return None
        text = " ".join(str(raw).split())
        if not text:
            return None
        picklist = self.picklist(list_key)
        folded = text.casefold()
        match = next((value for value in picklist.values if value.key == text), None)
        if match is None:
            match = next((value for value in picklist.values if value.key.casefold() == folded), None)
        if match is None:
            match = next((value for value in picklist.values if value.label.casefold() == folded), None)
        if match is None and list_key == COUNTRY_LIST:
            code = country_code_for(text)
            match = next((value for value in picklist.values if value.key == code), None) if code else None
        name = field_label or picklist.label
        if match is None:
            if self.allow_create and not picklist.is_locked:
                match = add_value(self.db, self.tenant_id, picklist, label=text, actor_user_id=None, log=False)
                self.created.append((list_key, match.key))
            else:
                raise _field_error(field_key, f"“{text}” is not a {name.lower()} in this workspace. Choose one from the list.")
        if not match.is_active and match.key != current:
            raise _field_error(field_key, f"“{match.label}” is no longer used for {name.lower()}. Choose another value.")
        return match.key

    def normalize(self, module_key: str, data: dict, *, existing: Any = None) -> dict:
        """Rewrites every bound field present in `data` to its key, in place."""
        for field_key, binding in bindings_for_module(module_key).items():
            if field_key not in data:
                continue
            current = getattr(existing, binding.column, None) if existing is not None else None
            data[field_key] = self.resolve(
                binding.list_key, data[field_key], current=current, field_key=field_key, field_label=binding.label
            )
        return data

    def labels_for_row(self, module_key: str, row: dict) -> dict:
        """Replaces bound keys in an export row with their labels, in place."""
        for field_key, binding in bindings_for_module(module_key).items():
            if field_key in row:
                row[field_key] = self.label(binding.list_key, row[field_key])
        return row


def picklist_error_reason(exc: HTTPException) -> str:
    """The sentence of a picklist refusal, for an import's failure list."""
    detail = exc.detail
    if isinstance(detail, list) and detail and isinstance(detail[0], dict):
        return str(detail[0].get("msg") or "Invalid value.")
    return str(detail)


def normalize_picklist_fields(db: Session, tenant_id: int, module_key: str, data: dict, *, existing: Any = None) -> dict:
    return PicklistResolver(db, tenant_id).normalize(module_key, data, existing=existing)


@lru_cache(maxsize=1)
def _country_lookup() -> dict[str, str]:
    lookup: dict[str, str] = {}
    for code, name in iso_countries():
        lookup[code.casefold()] = code
        lookup[name.casefold()] = code
    # Spellings people type that are not the ISO name.
    for alias, code in {
        "usa": "US", "united states of america": "US", "america": "US", "uk": "GB", "britain": "GB",
        "great britain": "GB", "england": "GB", "uae": "AE", "russia": "RU", "south korea": "KR",
        "korea": "KR", "vietnam": "VN", "iran": "IR", "syria": "SY", "laos": "LA", "bolivia": "BO",
        "venezuela": "VE", "tanzania": "TZ", "moldova": "MD", "czech republic": "CZ", "taiwan": "TW",
    }.items():
        lookup.setdefault(alias, code)
    return lookup


def country_code_for(text: str | None) -> str | None:
    if not text:
        return None
    return _country_lookup().get(" ".join(text.split()).casefold())


# --- admin ----------------------------------------------------------------------------


def slug_key(label: str) -> str:
    key = KEY_RE.sub("_", label.strip().casefold()).strip("_")
    return key[:90] or "value"


def _unique_key(existing: set[str], label: str) -> str:
    base = slug_key(label)
    key, suffix = base, 2
    while key in existing:
        key = f"{base}_{suffix}"
        suffix += 1
    return key


def _clean_label(label: Any) -> str:
    text = " ".join(str(label or "").split())
    if not text:
        raise _field_error("label", "Enter a label.")
    if len(text) > MAX_LABEL_LENGTH:
        raise _field_error("label", f"Keep the label to {MAX_LABEL_LENGTH} characters.")
    return text


def _snapshot(picklist: Picklist) -> dict[str, Any]:
    return {
        "label": picklist.label,
        "values": [
            {"key": value.key, "label": value.label, "active": value.is_active, "default": value.is_default,
             "tone": value.tone, "meaning": value.meaning}
            for value in picklist.values
        ],
    }


def _restore_values(picklist: Picklist, snapshot: dict[str, Any]) -> None:
    saved = {item["key"]: item for item in snapshot["values"]}
    for value in picklist.values:
        item = saved.get(value.key)
        if item is None:
            continue
        value.label, value.is_active, value.is_default = item["label"], item["active"], item["default"]
        value.tone, value.meaning = item["tone"], item["meaning"]


def _log(db: Session, picklist: Picklist, *, actor_user_id: int | None, action: str, description: str, before=None) -> None:
    safe_log_activity(
        db,
        tenant_id=picklist.tenant_id,
        actor_user_id=actor_user_id,
        module_key=PICKLIST_MODULE_KEY,
        entity_type=PICKLIST_ENTITY_TYPE,
        entity_id=picklist.id,
        action=action,
        description=description,
        before_state=before,
        after_state=_snapshot(picklist),
        commit=False,
    )


def _check_invariants(picklist: Picklist) -> None:
    meanings = MEANING_SETS.get(picklist.meaning_set or "")
    if not meanings:
        return
    active = [value for value in picklist.values if value.is_active]
    for meaning in sorted(REQUIRED_MEANINGS.get(picklist.meaning_set or "", ())):
        if not any(value.meaning == meaning for value in active):
            raise _field_error(None, f"{picklist.label} needs at least one active value meaning “{meaning}”.")
    default = next((value for value in active if value.is_default), None)
    allowed = DEFAULT_MEANINGS.get(picklist.meaning_set or "")
    if allowed and (default is None or default.meaning not in allowed):
        raise _field_error(None, f"The default {picklist.label.lower()} must mean {' or '.join(sorted(allowed))}.")


def _clean_meaning(picklist: Picklist, meaning: Any, *, required: bool) -> str | None:
    meanings = MEANING_SETS.get(picklist.meaning_set or "")
    if not meanings:
        if meaning:
            raise _field_error("meaning", "This list does not take meanings.")
        return None
    if not meaning:
        if required:
            raise _field_error("meaning", "Choose what this value means.")
        return None
    if meaning not in meanings:
        raise _field_error("meaning", "Choose one of the listed meanings.")
    return str(meaning)


def _clean_tone(tone: Any) -> str | None:
    if tone in (None, ""):
        return None
    if tone not in TONES:
        raise _field_error("tone", "Choose one of the listed tones.")
    return str(tone)


def create_picklist(db: Session, tenant_id: int, *, label: Any, scope: str = "global", actor_user_id: int | None) -> Picklist:
    clean = _clean_label(label)
    if scope not in {"global", "local"}:
        raise _field_error("scope", "Choose global or local.")
    existing = {key for (key,) in db.query(Picklist.key).filter(Picklist.tenant_id == tenant_id).all()}
    existing |= set(SYSTEM_PICKLISTS)
    picklist = Picklist(tenant_id=tenant_id, key=_unique_key(existing, clean), label=clean, scope=scope)
    db.add(picklist)
    db.flush()
    _log(db, picklist, actor_user_id=actor_user_id, action="create", description=f"Created picklist {clean}")
    return picklist


def update_picklist(db: Session, picklist: Picklist, *, label: Any, actor_user_id: int | None) -> Picklist:
    before = _snapshot(picklist)
    picklist.label = _clean_label(label)
    db.flush()
    _log(db, picklist, actor_user_id=actor_user_id, action="update", description=f"Renamed picklist to {picklist.label}", before=before)
    return picklist


def add_value(
    db: Session,
    tenant_id: int,
    picklist: Picklist,
    *,
    label: Any,
    tone: Any = None,
    meaning: Any = None,
    actor_user_id: int | None,
    log: bool = True,
) -> PicklistValue:
    if picklist.is_locked:
        raise _field_error(None, f"{picklist.label} values are set by the platform; you can only switch them on or off.")
    clean = _clean_label(label)
    if any(value.label.casefold() == clean.casefold() for value in picklist.values):
        raise _field_error("label", f"{picklist.label} already has “{clean}”.")
    before = _snapshot(picklist)
    value = PicklistValue(
        tenant_id=tenant_id,
        key=_unique_key({value.key for value in picklist.values}, clean),
        label=clean,
        position=max((value.position for value in picklist.values), default=-1) + 1,
        is_active=True,
        is_default=False,
        tone=_clean_tone(tone),
        meaning=_clean_meaning(picklist, meaning, required=True),
    )
    picklist.values.append(value)
    db.flush()
    if log:
        _log(db, picklist, actor_user_id=actor_user_id, action="update", description=f"Added “{clean}” to {picklist.label}", before=before)
    return value


def _find_value(picklist: Picklist, value_key: str) -> PicklistValue:
    value = next((item for item in picklist.values if item.key == value_key), None)
    if value is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Picklist value not found")
    return value


def update_value(db: Session, picklist: Picklist, value_key: str, changes: dict, *, actor_user_id: int | None) -> PicklistValue:
    value = _find_value(picklist, value_key)
    before = _snapshot(picklist)
    described: list[str] = []
    if "label" in changes:
        if picklist.is_locked:
            raise _field_error("label", f"{picklist.label} names are set by the platform.")
        clean = _clean_label(changes["label"])
        if any(item is not value and item.label.casefold() == clean.casefold() for item in picklist.values):
            raise _field_error("label", f"{picklist.label} already has “{clean}”.")
        if clean != value.label:
            described.append(f"renamed “{value.label}” to “{clean}”")
            value.label = clean
    if "tone" in changes:
        value.tone = _clean_tone(changes["tone"])
        described.append(f"set the tone of “{value.label}”")
    if "meaning" in changes:
        value.meaning = _clean_meaning(picklist, changes["meaning"], required=bool(picklist.meaning_set))
        described.append(f"set the meaning of “{value.label}”")
    if "is_active" in changes:
        active = bool(changes["is_active"])
        if not active and value.is_default:
            raise _field_error("is_active", "Choose another default before switching the default value off.")
        if active != value.is_active:
            described.append(f"{'activated' if active else 'deactivated'} “{value.label}”")
            value.is_active = active
    if "is_default" in changes:
        make_default = bool(changes["is_default"])
        if make_default and not value.is_active:
            raise _field_error("is_default", "Switch the value on before making it the default.")
        if make_default and not value.is_default:
            for item in picklist.values:
                if item.is_default:
                    item.is_default = False
            db.flush()
            value.is_default = True
            described.append(f"made “{value.label}” the default")
        elif not make_default and value.is_default:
            if picklist.meaning_set in DEFAULT_MEANINGS:
                raise _field_error("is_default", "Choose another default instead; this list always has one.")
            value.is_default = False
            described.append("removed the default")
    try:
        _check_invariants(picklist)
    except HTTPException:
        # A refused change leaves the list as it was, not half-applied in the session.
        _restore_values(picklist, before)
        raise
    db.flush()
    if described:
        _log(db, picklist, actor_user_id=actor_user_id, action="update",
             description=f"{picklist.label}: " + "; ".join(described), before=before)
    return value


def reorder_values(db: Session, picklist: Picklist, keys: list[str], *, actor_user_id: int | None) -> Picklist:
    current = {value.key: value for value in picklist.values}
    if sorted(keys) != sorted(current):
        raise _field_error(None, "Send every value of the list exactly once.")
    before = _snapshot(picklist)
    for index, key in enumerate(keys):
        current[key].position = index
    db.flush()
    db.expire(picklist, ["values"])
    _log(db, picklist, actor_user_id=actor_user_id, action="update", description=f"Reordered {picklist.label}", before=before)
    return picklist


# --- usage, merge and stray values ------------------------------------------------------


def _rewrite_condition(condition: dict, field_keys: set[str], old: str, new: str) -> bool:
    if not isinstance(condition, dict) or condition.get("field") not in field_keys:
        return False
    changed = False
    if condition.get("value") == old:
        condition["value"] = new
        changed = True
    values = condition.get("values")
    if isinstance(values, list) and old in values:
        rewritten: list[Any] = []
        for item in values:
            replacement = new if item == old else item
            if replacement not in rewritten:
                rewritten.append(replacement)
        condition["values"] = rewritten
        changed = True
    return changed


def _rewrite_saved_views(db: Session, tenant_id: int, bindings: list[PicklistBinding], old: str, new: str) -> int:
    from app.modules.user_management.models import User, UserSavedView

    by_module: dict[str, set[str]] = {}
    for binding in bindings:
        by_module.setdefault(binding.module_key, set()).add(binding.field_key)
    changed_views = 0
    views = (
        db.query(UserSavedView)
        .join(User, User.id == UserSavedView.user_id)
        .filter(User.tenant_id == tenant_id, UserSavedView.module_key.in_(list(by_module)))
        .all()
    )
    for view in views:
        config = json.loads(json.dumps(view.config or {}))
        filters = config.get("filters") if isinstance(config, dict) else None
        if not isinstance(filters, dict):
            continue
        changed = False
        for bucket in ("conditions", "all_conditions", "any_conditions"):
            for condition in filters.get(bucket) or []:
                changed = _rewrite_condition(condition, by_module[view.module_key], old, new) or changed
        if changed:
            view.config = config
            changed_views += 1
    return changed_views


def _rewrite_automation(db: Session, tenant_id: int, bindings: list[PicklistBinding], old: str, new: str) -> int:
    from app.modules.platform.services.automation_registry import module_key_for_trigger

    fields_by_module: dict[str, set[str]] = {}
    for binding in bindings:
        fields_by_module.setdefault(binding.module_key, set()).add(f"payload.{binding.field_key}")
    changed_rules = 0
    for rule in db.query(AutomationRule).filter(AutomationRule.tenant_id == tenant_id).all():
        field_keys = fields_by_module.get(module_key_for_trigger(rule.trigger_event) or "")
        if not field_keys:
            continue
        conditions = json.loads(json.dumps(rule.conditions_json or []))
        changed = False
        for condition in conditions if isinstance(conditions, list) else []:
            changed = _rewrite_condition(condition, field_keys, old, new) or changed
        if changed:
            rule.conditions_json = conditions
            changed_rules += 1
    return changed_rules


def _rewrite_records(db: Session, tenant_id: int, bindings: list[PicklistBinding], old: str, new: str | None) -> int:
    total = 0
    for binding in bindings:
        model = _binding_model(binding)
        column = getattr(model, binding.column)
        total += (
            db.query(model)
            .filter(model.tenant_id == tenant_id, column == old)
            .update({column: new}, synchronize_session=False)
        )
    return total


def usage(db: Session, tenant_id: int, list_key: str) -> list[dict[str, Any]]:
    """Which fields use the list, and how many records hold each value."""
    result = []
    for binding in bindings_for_list(list_key):
        model = _binding_model(binding)
        column = getattr(model, binding.column)
        counts = dict(
            db.query(column, func.count())
            .filter(model.tenant_id == tenant_id, column.isnot(None), column != "")
            .group_by(column)
            .all()
        )
        result.append({"module_key": binding.module_key, "field_key": binding.field_key, "label": binding.label, "counts": counts})
    return result


def merge_values(db: Session, picklist: Picklist, *, from_key: str, into_key: str, actor_user_id: int | None) -> dict[str, int]:
    """Moves every record, saved view and automation condition from one value to another,
    then deactivates the first (Zoho's *Replace*, 13b §3.1).

    Each field is one set-based UPDATE, so a large list costs one statement per field rather
    than a row-by-row job.
    """
    if picklist.is_locked:
        raise _field_error(None, f"{picklist.label} values are set by the platform and cannot be merged.")
    if from_key == into_key:
        raise _field_error("into_key", "Choose a different value to merge into.")
    source = _find_value(picklist, from_key)
    target = _find_value(picklist, into_key)
    if not target.is_active:
        raise _field_error("into_key", "Merge into an active value.")
    if picklist.meaning_set and source.meaning != target.meaning:
        raise _field_error("into_key", "Merge into a value with the same meaning, so no record changes what it means.")
    before = _snapshot(picklist)
    bindings = bindings_for_list(picklist.key)
    records = _rewrite_records(db, picklist.tenant_id, bindings, from_key, into_key)
    views = _rewrite_saved_views(db, picklist.tenant_id, bindings, from_key, into_key)
    rules = _rewrite_automation(db, picklist.tenant_id, bindings, from_key, into_key)
    if source.is_default:
        source.is_default = False
        db.flush()
        target.is_default = True
    source.is_active = False
    _check_invariants(picklist)
    db.flush()
    _log(
        db, picklist, actor_user_id=actor_user_id, action="update",
        description=f"{picklist.label}: merged “{source.label}” into “{target.label}” ({records} records, {views} views, {rules} rules)",
        before=before,
    )
    return {"records": records, "views": views, "rules": rules}


def unmatched_values(db: Session, picklist: Picklist) -> list[dict[str, Any]]:
    """Stored values that match no key of the list: free text from before picklists, or a
    restore from another workspace. The admin adds them or merges them into a value."""
    keys = {value.key for value in picklist.values}
    totals: dict[str, int] = {}
    fields: dict[str, set[str]] = {}
    for entry in usage(db, picklist.tenant_id, picklist.key):
        for raw, count in entry["counts"].items():
            if raw in keys:
                continue
            totals[raw] = totals.get(raw, 0) + count
            fields.setdefault(raw, set()).add(entry["label"])
    return [
        {"value": raw, "count": totals[raw], "fields": sorted(fields[raw])}
        for raw in sorted(totals, key=lambda item: (-totals[item], item.casefold()))
    ]


def resolve_unmatched(
    db: Session,
    picklist: Picklist,
    *,
    raw: str,
    into_key: str | None,
    actor_user_id: int | None,
) -> dict[str, Any]:
    """Moves records holding stray `raw` onto `into_key`, or onto a new value named after it."""
    if raw in {value.key for value in picklist.values}:
        raise _field_error("value", "That value is already in the list.")
    before = _snapshot(picklist)
    if into_key:
        target = _find_value(picklist, into_key)
    elif picklist.is_locked:
        raise _field_error("into_key", f"Choose which {picklist.label.lower()} these records mean.")
    else:
        meaning = None
        if picklist.meaning_set:
            raise _field_error("into_key", "Choose which value these records mean.")
        target = add_value(db, picklist.tenant_id, picklist, label=raw, meaning=meaning, actor_user_id=actor_user_id, log=False)
    records = _rewrite_records(db, picklist.tenant_id, bindings_for_list(picklist.key), raw, target.key)
    db.flush()
    _log(db, picklist, actor_user_id=actor_user_id, action="update",
         description=f"{picklist.label}: moved {records} records from “{raw}” to “{target.label}”", before=before)
    return {"records": records, "key": target.key}


# --- serialization --------------------------------------------------------------------


def serialize_value(value: PicklistValue) -> dict[str, Any]:
    return {
        "key": value.key,
        "label": value.label,
        "position": value.position,
        "is_active": bool(value.is_active),
        "is_default": bool(value.is_default),
        "tone": value.tone,
        "meaning": value.meaning,
    }


def serialize_picklist(picklist: Picklist, *, include_usage: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    payload = {
        "id": picklist.id,
        "key": picklist.key,
        "label": picklist.label,
        "scope": picklist.scope,
        "meaning_set": picklist.meaning_set,
        "meanings": list(MEANING_SETS.get(picklist.meaning_set or "", ())),
        "is_system": bool(picklist.is_system),
        "is_locked": bool(picklist.is_locked),
        "used_by": [
            {"module_key": binding.module_key, "field_key": binding.field_key, "label": binding.label}
            for binding in bindings_for_list(picklist.key)
        ],
        "values": [serialize_value(value) for value in sorted(picklist.values, key=lambda item: (item.position, item.id or 0))],
    }
    if include_usage is not None:
        payload["usage"] = include_usage
    return payload
