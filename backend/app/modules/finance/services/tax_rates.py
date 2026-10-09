"""Tax rates and groups, and which rate a document line gets (13d §3.1).

A line's rate, in order: the line's own choice; none for an exempt customer (sales only); the
item's rate for that side; the company default for that side. A line marked `tax_manual`
keeps its typed tax amount and is never recomputed. Every document resolves its lines here
and computes them with `document_amounts.compute_line`.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Iterable, Literal

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.modules.catalog.models import CatalogProduct, CatalogService
from app.modules.finance.services.document_amounts import ZERO, money
from app.modules.finance.tax_models import FinanceTaxGroupMember, FinanceTaxRate
from app.modules.platform.services.activity_logs import log_activity

Side = Literal["sales", "purchases"]
TAX_MODES = ("exclusive", "inclusive")
RATE_PLACES = Decimal("0.0001")
TAX_RATE_FIELD = "tax_rate_id"


def _rate_value(value) -> Decimal:
    try:
        rate = Decimal(str(value).strip())
    except (InvalidOperation, ValueError, TypeError):
        rate = Decimal("-1")
    if not rate.is_finite() or rate < 0 or rate > 100 or rate != rate.quantize(RATE_PLACES):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Rate must be between 0 and 100, with at most 4 decimal places")
    return rate


def normalize_tax_mode(value, *, default: str = "exclusive") -> str:
    mode = (str(value).strip().lower() if value is not None else "") or default
    if mode not in TAX_MODES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tax mode must be exclusive or inclusive")
    return mode


def default_tax_mode(db: Session, *, tenant_id: int) -> str:
    from app.modules.user_management.models import CompanyProfile

    mode = db.query(CompanyProfile.default_tax_mode).filter(CompanyProfile.tenant_id == tenant_id).order_by(CompanyProfile.id).scalar()
    return mode if mode in TAX_MODES else "exclusive"


# ---------------------------------------------------------------------------------------------
# Settings → Taxes


def list_tax_rates(db: Session, *, tenant_id: int, include_inactive: bool = True) -> list[FinanceTaxRate]:
    query = db.query(FinanceTaxRate).filter(FinanceTaxRate.tenant_id == tenant_id)
    if not include_inactive:
        query = query.filter(FinanceTaxRate.is_active.is_(True))
    return query.order_by(FinanceTaxRate.kind.desc(), FinanceTaxRate.rate, FinanceTaxRate.name).all()


def get_tax_rate_or_404(db: Session, *, tenant_id: int, rate_id: int) -> FinanceTaxRate:
    rate = db.query(FinanceTaxRate).filter(FinanceTaxRate.id == rate_id, FinanceTaxRate.tenant_id == tenant_id).first()
    if rate is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tax rate not found")
    return rate


def serialize_tax_rate(rate: FinanceTaxRate) -> dict:
    return {
        "id": rate.id,
        "name": rate.name,
        "kind": rate.kind,
        "rate": rate.rate,
        "is_active": bool(rate.is_active),
        "is_default_sales": bool(rate.is_default_sales),
        "is_default_purchases": bool(rate.is_default_purchases),
        "members": [{"id": member.rate_id, "name": member.rate.name, "rate": member.rate.rate} for member in rate.members if member.rate],
        "created_at": rate.created_at,
        "updated_at": rate.updated_at,
    }


def _clean_name(db: Session, *, tenant_id: int, name, exclude_id: int | None = None) -> str:
    cleaned = " ".join(str(name or "").split())[:120]
    if not cleaned:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Name is required")
    clash = db.query(FinanceTaxRate.id).filter(FinanceTaxRate.tenant_id == tenant_id, FinanceTaxRate.name == cleaned)
    if exclude_id is not None:
        clash = clash.filter(FinanceTaxRate.id != exclude_id)
    if clash.first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"A tax rate named {cleaned} already exists")
    return cleaned


def _set_members(db: Session, group: FinanceTaxRate, member_ids: list) -> None:
    ids: list[int] = []
    for value in member_ids or []:
        rate_id = int(value)
        if rate_id not in ids:
            ids.append(rate_id)
    if len(ids) < 2:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A tax group combines at least two rates")
    rates = {rate.id: rate for rate in db.query(FinanceTaxRate).filter(FinanceTaxRate.tenant_id == group.tenant_id, FinanceTaxRate.id.in_(ids)).all()}
    if len(rates) != len(ids):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A tax group can only combine this workspace's rates")
    if any(rate.kind != "rate" for rate in rates.values()):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A tax group combines rates, not other groups")
    group.members = [FinanceTaxGroupMember(tenant_id=group.tenant_id, rate_id=rate_id, sort_order=index) for index, rate_id in enumerate(ids)]
    group.rate = sum((Decimal(rates[rate_id].rate) for rate_id in ids), ZERO)


def _refresh_groups_using(db: Session, rate: FinanceTaxRate) -> None:
    groups = (
        db.query(FinanceTaxRate)
        .join(FinanceTaxGroupMember, FinanceTaxGroupMember.group_id == FinanceTaxRate.id)
        .filter(FinanceTaxGroupMember.rate_id == rate.id, FinanceTaxRate.tenant_id == rate.tenant_id)
        .all()
    )
    for group in groups:
        group.rate = sum((Decimal(member.rate.rate) for member in group.members), ZERO)
        db.add(group)


def _set_defaults(db: Session, rate: FinanceTaxRate, payload: dict) -> None:
    for side in ("sales", "purchases"):
        key = f"is_default_{side}"
        if key not in payload:
            continue
        wanted = bool(payload[key])
        if wanted and not rate.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="An inactive rate cannot be a default")
        if wanted:
            column = getattr(FinanceTaxRate, key)
            others = db.query(FinanceTaxRate).filter(FinanceTaxRate.tenant_id == rate.tenant_id, column.is_(True), FinanceTaxRate.id != (rate.id or 0)).all()
            for other in others:
                setattr(other, key, False)
                db.add(other)
            db.flush()
        setattr(rate, key, wanted)


def _log(db: Session, rate: FinanceTaxRate, *, actor_user_id: int | None, action: str, description: str) -> None:
    log_activity(db, tenant_id=rate.tenant_id, actor_user_id=actor_user_id, module_key="finance_tax_rates", entity_type="finance_tax_rate",
                 entity_id=rate.id, action=action, description=description, after_state=serialize_tax_rate(rate), commit=False)


def create_tax_rate(db: Session, *, tenant_id: int, actor_user_id: int | None, payload: dict) -> FinanceTaxRate:
    kind = payload.get("kind") or "rate"
    if kind not in {"rate", "group"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Kind must be rate or group")
    rate = FinanceTaxRate(tenant_id=tenant_id, kind=kind, name=_clean_name(db, tenant_id=tenant_id, name=payload.get("name")),
                          is_active=True, is_default_sales=False, is_default_purchases=False, created_by=actor_user_id)
    if kind == "group":
        _set_members(db, rate, payload.get("member_ids") or [])
    else:
        rate.rate = _rate_value(payload.get("rate"))
    db.add(rate)
    db.flush()
    _set_defaults(db, rate, payload)
    db.flush()
    _log(db, rate, actor_user_id=actor_user_id, action="create", description=f"Added tax rate {rate.name}")
    return rate


def rate_in_use(db: Session, rate: FinanceTaxRate) -> bool:
    for model, column in _rate_references():
        if db.query(model).filter(column == rate.id).first() is not None:
            return True
    return db.query(FinanceTaxGroupMember.id).filter(FinanceTaxGroupMember.rate_id == rate.id).first() is not None


def update_tax_rate(db: Session, rate: FinanceTaxRate, *, actor_user_id: int | None, payload: dict) -> FinanceTaxRate:
    if "name" in payload:
        rate.name = _clean_name(db, tenant_id=rate.tenant_id, name=payload["name"], exclude_id=rate.id)
    if "rate" in payload or "member_ids" in payload:
        # A rate on issued documents keeps its figure: their lines were computed from it.
        if rate_in_use(db, rate):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="This rate is used on documents or in a group; add a new rate and deactivate this one")
        if rate.kind == "group":
            _set_members(db, rate, payload.get("member_ids") or [])
        else:
            rate.rate = _rate_value(payload["rate"])
            _refresh_groups_using(db, rate)
    if "is_active" in payload:
        rate.is_active = bool(payload["is_active"])
        if not rate.is_active:
            rate.is_default_sales = rate.is_default_purchases = False
    _set_defaults(db, rate, payload)
    db.add(rate)
    db.flush()
    _log(db, rate, actor_user_id=actor_user_id, action="update", description=f"Updated tax rate {rate.name}")
    return rate


def delete_tax_rate(db: Session, rate: FinanceTaxRate, *, actor_user_id: int | None) -> None:
    if rate_in_use(db, rate):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This rate is in use; deactivate it instead")
    _log(db, rate, actor_user_id=actor_user_id, action="delete", description=f"Deleted tax rate {rate.name}")
    db.delete(rate)
    db.flush()


def _rate_references():
    from app.modules.finance.models import FinanceCreditNoteLine, FinancePosInvoiceLine
    from app.modules.purchasing.models import PurchaseBillLine, PurchaseOrderLine, PurchaseVendorCreditLine
    from app.modules.sales.models import SalesOrderItem, SalesQuoteItem

    lines = (SalesQuoteItem, SalesOrderItem, FinancePosInvoiceLine, FinanceCreditNoteLine, PurchaseOrderLine, PurchaseBillLine,
             PurchaseVendorCreditLine)
    references = [(model, model.tax_rate_id) for model in lines]
    for model in (CatalogProduct, CatalogService):
        references.append((model, model.tax_rate_id))
        references.append((model, model.purchase_tax_rate_id))
    return references


# ---------------------------------------------------------------------------------------------
# Lines


@dataclass(frozen=True)
class LineTax:
    """What a line's tax comes from: `percent` to compute it, or None to keep the typed amount
    (`manual`), or no rate at all (percent 0, nothing to compute)."""

    rate_id: int | None
    percent: Decimal | None
    manual: bool


class TaxResolver:
    """Resolves the tax of a document's lines with one query for the rates and one per item kind."""

    def __init__(self, db: Session, *, tenant_id: int, side: Side, exempt: bool = False, allowed_inactive: Iterable[int] = ()):
        self.db = db
        self.tenant_id = tenant_id
        self.side = side
        self.exempt = exempt and side == "sales"
        self.allowed_inactive = {int(value) for value in allowed_inactive if value}
        self.rates = {rate.id: rate for rate in db.query(FinanceTaxRate).filter(FinanceTaxRate.tenant_id == tenant_id).all()}
        flag = "is_default_sales" if side == "sales" else "is_default_purchases"
        self.default_rate_id = next((rate.id for rate in self.rates.values() if rate.is_active and getattr(rate, flag)), None)
        self._item_rates: dict[tuple[str, int], int | None] = {}

    def _item_rate(self, link: dict) -> int | None:
        column = "tax_rate_id" if self.side == "sales" else "purchase_tax_rate_id"
        for kind, model, key in (("product", CatalogProduct, "catalog_product_id"), ("service", CatalogService, "catalog_service_id")):
            item_id = (link or {}).get(key)
            if not item_id:
                continue
            cache_key = (kind, int(item_id))
            if cache_key not in self._item_rates:
                self._item_rates[cache_key] = self.db.query(getattr(model, column)).filter(model.id == int(item_id), model.tenant_id == self.tenant_id).scalar()
            return self._item_rates[cache_key]
        return None

    def checked_rate_id(self, value) -> int | None:
        if value in (None, "", 0, "0"):
            return None
        try:
            rate_id = int(value)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tax rate not found") from exc
        rate = self.rates.get(rate_id)
        if rate is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tax rate not found")
        if not rate.is_active and rate_id not in self.allowed_inactive:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{rate.name} is no longer active")
        return rate_id

    def default_for(self, link: dict | None = None) -> int | None:
        if self.exempt:
            return None
        rate_id = self._item_rate(link or {})
        if rate_id is not None and rate_id in self.rates and self.rates[rate_id].is_active:
            return rate_id
        return self.default_rate_id

    def line(self, payload: dict, link: dict | None = None) -> LineTax:
        """A named `tax_rate_id` is the line's choice. `tax_manual` keeps the typed tax (a zero
        typed tax is how a line says "no tax"). A typed tax with neither is manual too (website
        orders, imports, older clients). Anything else takes the default."""
        manual = bool(payload.get("tax_manual"))
        rate_id = self.checked_rate_id(payload.get(TAX_RATE_FIELD))
        if manual:
            return LineTax(rate_id=rate_id, percent=None, manual=True)
        if rate_id is None:
            if _nonzero(payload.get("tax_amount")):
                return LineTax(rate_id=None, percent=None, manual=True)
            rate_id = self.default_for(link)
        percent = Decimal(self.rates[rate_id].rate) if rate_id is not None else ZERO
        return LineTax(rate_id=rate_id, percent=percent, manual=False)


def compute_payload_line(resolver: "TaxResolver", payload: dict, link: dict | None, *, quantity, unit_price, discount=ZERO,
                         inclusive: bool = False, label: str = "Line"):
    """(LineTax, LineAmounts) for one submitted line."""
    from app.modules.finance.services.document_amounts import compute_line

    choice = resolver.line(payload, link)
    amounts = compute_line(quantity=quantity, unit_price=unit_price, discount=discount, rate=choice.percent,
                           tax=payload.get("tax_amount") or ZERO, inclusive=inclusive, label=label)
    return choice, amounts


@dataclass(frozen=True)
class SalesLine:
    """One submitted quote, order or invoice line, resolved (13d §3.1–3.2)."""

    line_type: str
    quantity: Decimal
    unit_price: Decimal
    discount: Decimal
    discount_percent: Decimal | None
    unit: str | None
    tax: LineTax
    amounts: object  # document_amounts.LineAmounts


def compute_sales_line(resolver: "TaxResolver", payload: dict, link: dict | None, *, quantity, unit_price, discount=ZERO,
                       inclusive: bool = False, label: str = "Line") -> SalesLine:
    """An item through the shared line function, or a section or note: a heading or text with
    no quantity, price or tax, so it never moves a total."""
    from app.modules.finance.services.document_amounts import (
        clean_unit, compute_line, line_type_of, percent_input, resolve_discount,
    )

    line_type = line_type_of(payload)
    if line_type != "item":
        zero = compute_line(quantity=Decimal(1), unit_price=ZERO)
        return SalesLine(line_type, Decimal(1), ZERO, ZERO, None, None, LineTax(rate_id=None, percent=None, manual=True), zero)
    percent = percent_input(payload.get("discount_percent"))
    discount = resolve_discount(quantity=quantity, unit_price=unit_price, discount=discount, percent=percent)
    choice, amounts = compute_payload_line(resolver, payload, link, quantity=quantity, unit_price=unit_price, discount=discount,
                                           inclusive=inclusive, label=label)
    return SalesLine("item", Decimal(quantity), Decimal(unit_price), discount, percent, clean_unit(payload.get("unit")), choice, amounts)


def sales_line_fields(line: SalesLine) -> dict:
    """The resolved line's stored columns, shared by quote, order and invoice lines."""
    return {
        "line_type": line.line_type, "quantity": line.quantity, "unit_price": line.unit_price, "discount_amount": line.discount,
        "discount_percent": line.discount_percent, "unit": line.unit, "tax_amount": line.amounts.tax, "tax_rate_id": line.tax.rate_id,
        "tax_manual": line.tax.manual, "line_total": line.amounts.total,
    }


def line_payload(line, *, price_field: str = "unit_price") -> dict:
    """An existing line as a submitted one, to recompute it (a document's tax mode changed)."""
    payload = {"tax_rate_id": line.tax_rate_id, "tax_manual": bool(line.tax_manual), "tax_amount": line.tax_amount,
               price_field: getattr(line, price_field)}
    for field in ("line_type", "discount_percent", "unit", "is_optional"):
        if hasattr(line, field):
            payload[field] = getattr(line, field)
    return payload


def _nonzero(value) -> bool:
    try:
        return value is not None and str(value).strip() != "" and Decimal(str(value)) != 0
    except (InvalidOperation, ValueError):
        return True


def account_is_exempt(db: Session, *, tenant_id: int, organization_id: int | None) -> bool:
    if not organization_id:
        return False
    from app.modules.sales.models import SalesOrganization

    return bool(db.query(SalesOrganization.tax_exempt).filter(SalesOrganization.org_id == organization_id, SalesOrganization.tenant_id == tenant_id).scalar())


def used_rate_ids(lines) -> set[int]:
    return {line.tax_rate_id for line in lines or [] if getattr(line, "tax_rate_id", None)}


def line_tax_fields(line) -> dict:
    return {"tax_rate_id": line.tax_rate_id, "tax_manual": bool(line.tax_manual)}


# ---------------------------------------------------------------------------------------------
# Summary


def document_tax_summary(document, lines) -> list[dict]:
    """`tax_summary` for a loaded document, through its own session (model properties use it)."""
    from sqlalchemy.orm import object_session

    db = object_session(document)
    return tax_summary(db, tenant_id=document.tenant_id, lines=lines) if db is not None else []


def tax_summary(db: Session, *, tenant_id: int, lines) -> list[dict]:
    """Tax by rate over a document's lines: name, rate, taxable amount and tax. A group is
    shown as its components, its tax split by their rates (the last takes the remainder)."""
    buckets: dict[int | None, dict] = {}
    for line in lines or []:
        tax = money(getattr(line, "tax_amount", 0) or 0)
        rate_id = getattr(line, "tax_rate_id", None)
        if rate_id is None and tax == 0:
            continue
        net = money(Decimal(getattr(line, "line_total", 0) or 0) - tax)
        bucket = buckets.setdefault(rate_id, {"taxable": ZERO, "tax": ZERO})
        bucket["taxable"] += net
        bucket["tax"] += tax
    if not buckets:
        return []
    ids = [rate_id for rate_id in buckets if rate_id is not None]
    rates = {rate.id: rate for rate in db.query(FinanceTaxRate).filter(FinanceTaxRate.tenant_id == tenant_id, FinanceTaxRate.id.in_(ids)).all()} if ids else {}
    rows: list[dict] = []
    for rate_id, bucket in buckets.items():
        rate = rates.get(rate_id)
        if rate is None:
            rows.append({"tax_rate_id": None, "name": "Tax", "rate": None, "taxable": bucket["taxable"], "tax": bucket["tax"]})
            continue
        if rate.kind != "group" or not rate.members or Decimal(rate.rate) == 0:
            rows.append({"tax_rate_id": rate.id, "name": rate.name, "rate": rate.rate, "taxable": bucket["taxable"], "tax": bucket["tax"]})
            continue
        left = bucket["tax"]
        for index, member in enumerate(rate.members):
            share = left if index == len(rate.members) - 1 else money(bucket["tax"] * Decimal(member.rate.rate) / Decimal(rate.rate))
            left -= share
            rows.append({"tax_rate_id": member.rate_id, "name": member.rate.name, "rate": member.rate.rate,
                         "taxable": bucket["taxable"], "tax": share, "group": rate.name})
    merged: dict[tuple, dict] = {}
    for row in rows:
        key = (row["tax_rate_id"], row["name"])
        if key in merged:
            merged[key]["taxable"] += row["taxable"]
            merged[key]["tax"] += row["tax"]
        else:
            merged[key] = dict(row)
    return sorted(merged.values(), key=lambda row: (row["rate"] is None, Decimal(row["rate"] or 0), row["name"]))


def rates_lookup(db: Session, *, tenant_id: int, rate_ids: Iterable[int]) -> dict[int, FinanceTaxRate]:
    ids = [rate_id for rate_id in set(rate_ids) if rate_id]
    if not ids:
        return {}
    return {rate.id: rate for rate in db.query(FinanceTaxRate).filter(FinanceTaxRate.tenant_id == tenant_id, FinanceTaxRate.id.in_(ids)).all()}
