"""Moving-average costing (ERP E6, `docs/crm-evolution/12d-erp-costing.md` §3.2).

A tracked product's stock value is the sum of its move values and revaluations; its average is
that value over the quantity on hand. Inbound moves bring their own cost (a receipt, an opening
import, a return at the cost it left at, a reversal at the cost of the move it undoes) and move
the average; outbound moves take their share of the value and leave the average alone. Lynk never
backdates stock, so the average is computed forward, move by move, with no recalculation jobs.

Only `stock_ledger.post_moves` and `valuation_services` call this; both hold the product's row lock.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

VALUE_PLACES = Decimal("0.0001")
COST_PLACES = Decimal("0.0001")
RATE_PLACES = Decimal("0.00000001")

# Where a move's unit cost came from (12d §3.1).
COST_SOURCES = ("receipt", "opening", "average", "return", "reversal", "manual", "fallback", "missing")

# Moves whose value is cost of goods sold, together with their reversals (same source type).
COGS_SOURCE_TYPES = ("inventory_delivery", "sales_order", "website_order", "inventory_return")


def money(value) -> Decimal:
    return Decimal(value).quantize(VALUE_PLACES, rounding=ROUND_HALF_UP)


def unit(value) -> Decimal:
    return Decimal(value).quantize(COST_PLACES, rounding=ROUND_HALF_UP)


@dataclass
class CostState:
    """One product's running quantity and value while a batch of moves posts."""

    quantity: Decimal
    value: Decimal
    last_cost: Decimal | None

    @property
    def average(self) -> Decimal | None:
        """The current average, or the last known one when nothing is on hand."""
        if self.quantity > 0:
            return unit(self.value / self.quantity)
        return self.last_cost

    @property
    def cost_missing(self) -> bool:
        return self.last_cost is None and self.value <= 0


def cost_key(product_id: int, warehouse_id: int | None = None) -> int:
    """What one average covers. Per product today (12d §5 decision 1); a per-warehouse average
    would return (product, warehouse) here and keep a state per key."""
    return product_id


def load_state(db: Session, product) -> CostState:
    from app.modules.inventory.models import InventoryStockLevel

    quantity = db.query(func.coalesce(func.sum(InventoryStockLevel.on_hand), 0)).filter(
        InventoryStockLevel.tenant_id == product.tenant_id, InventoryStockLevel.product_id == product.id).scalar()
    return CostState(quantity=Decimal(quantity or 0), value=Decimal(product.stock_value or 0),
                     last_cost=Decimal(product.cost_price) if product.cost_price is not None else None)


def next_average(state: CostState, *, quantity: Decimal, value: Decimal) -> Decimal | None:
    """The average once a move of `quantity` worth `value` posts. The one place a FIFO
    strategy would branch."""
    after_quantity = state.quantity + quantity
    if after_quantity > 0:
        return unit((state.value + value) / after_quantity)
    return state.last_cost


def cost_move(state: CostState, *, quantity: Decimal, move_type: str, unit_cost: Decimal | None,
              cost_source: str | None, reversed_move=None) -> tuple[Decimal, Decimal, str]:
    """(unit cost, signed value, cost source) for one move, before it posts."""
    after_quantity = state.quantity + quantity
    if reversed_move is not None:
        original = reversed_move.value
        if original is None:
            original = Decimal(reversed_move.quantity) * Decimal(reversed_move.unit_cost or 0)
        value = -money(original)
        if after_quantity == 0:
            value = -state.value
        elif state.value + value < 0:
            # Undoing a receipt after the average fell: never leave stock with a negative value.
            value = -state.value
        source = "reversal"
    elif quantity > 0:
        if unit_cost is not None:
            cost, source = Decimal(unit_cost), cost_source or "manual"
        else:
            average = state.average
            cost, source = (average, "average") if average is not None and not state.cost_missing else (Decimal(0), "missing")
        value = money(quantity * cost)
    else:
        if after_quantity == 0:
            # The last unit out takes what is left, so the value is zero whenever the quantity is.
            value = -state.value
        elif state.quantity > 0:
            value = money(state.value * quantity / state.quantity)
        else:
            value = Decimal(0)
        source = "missing" if state.cost_missing else "average"
    cost = unit(abs(value / quantity)) if quantity else Decimal(0)
    return cost, value, source


def apply(state: CostState, *, quantity: Decimal, value: Decimal, cost_source: str | None = None) -> Decimal | None:
    """Fold a posted move into the state; returns the average after it. A move with no cost
    never establishes an average, so the product stays *Cost missing* until it gets one."""
    average = next_average(state, quantity=quantity, value=value)
    state.quantity += quantity
    state.value += value
    if state.quantity == 0:
        state.value = Decimal(0)
    if state.quantity > 0 and not (cost_source == "missing" and state.last_cost is None):
        state.last_cost = average
    return state.last_cost if cost_source == "missing" and state.last_cost is None else average


# --- Currency ---------------------------------------------------------------------------


def base_currency(db: Session, *, tenant_id: int) -> str:
    """The company's base currency (12d §3.1): set, else its first operating currency, else USD."""
    from app.modules.user_management.models import CompanyProfile

    profile = db.query(CompanyProfile).filter(CompanyProfile.tenant_id == tenant_id).order_by(CompanyProfile.id).first()
    if profile is not None and profile.base_currency:
        return profile.base_currency.upper()
    currencies = list(getattr(profile, "operating_currencies", None) or []) if profile is not None else []
    return (str(currencies[0]).strip().upper()[:3] if currencies else "USD") or "USD"


def valuation_started(db: Session, *, tenant_id: int) -> bool:
    from app.modules.inventory.models import InventoryStockMove

    return db.query(InventoryStockMove.id).filter(InventoryStockMove.tenant_id == tenant_id,
        InventoryStockMove.value.is_not(None), InventoryStockMove.value != 0).first() is not None


def default_exchange_rate(db: Session, *, tenant_id: int, currency: str) -> Decimal | None:
    """The rate to suggest for a document in `currency`: the last one the tenant used. A rate
    table or feed would answer here instead (12d §5a)."""
    from app.modules.purchasing.models import PurchaseOrder
    from app.modules.sales.models import SalesOrder

    currency = (currency or "").strip().upper()
    if not currency or currency == base_currency(db, tenant_id=tenant_id):
        return None
    candidates = []
    for model, stamp in ((PurchaseOrder, PurchaseOrder.updated_at), (SalesOrder, SalesOrder.updated_at)):
        row = db.query(model.exchange_rate, stamp).filter(model.tenant_id == tenant_id, func.upper(model.currency) == currency,
            model.exchange_rate.is_not(None)).order_by(stamp.desc()).first()
        if row is not None and row[1] is not None:
            candidates.append(row)
    if not candidates:
        return None
    return Decimal(max(candidates, key=lambda row: row[1])[0])


def rate_for(db: Session, *, tenant_id: int, currency: str, exchange_rate) -> Decimal | None:
    """Base units per one unit of `currency` for a document: 1 in the base currency, its own
    rate otherwise, or None when it has none."""
    if (currency or "").strip().upper() == base_currency(db, tenant_id=tenant_id):
        return Decimal(1)
    return Decimal(exchange_rate) if exchange_rate is not None else None


def clean_rate(value) -> Decimal | None:
    from fastapi import HTTPException

    if value in (None, ""):
        return None
    try:
        rate = Decimal(str(value))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid exchange rate") from exc
    if not rate.is_finite() or rate <= 0:
        raise HTTPException(status_code=400, detail="The exchange rate must be greater than zero")
    return rate.quantize(RATE_PLACES, rounding=ROUND_HALF_UP)


def adjustment_cost(product, *, quantity: Decimal, unit_cost) -> tuple[Decimal | None, str | None]:
    """A positive adjustment takes the product's average; only a product with no cost yet needs
    one entered (12d §5 decision 6)."""
    from fastapi import HTTPException

    if quantity <= 0:
        return None, None
    has_cost = product.cost_price is not None or Decimal(product.stock_value or 0) > 0
    if has_cost:
        return None, None
    if unit_cost in (None, ""):
        raise HTTPException(status_code=409, detail=f"{product.name} has no cost yet; enter a unit cost for the stock you are adding")
    cost = Decimal(str(unit_cost))
    if not cost.is_finite() or cost < 0:
        raise HTTPException(status_code=400, detail="Unit cost must be zero or more")
    return unit(cost), "manual"
