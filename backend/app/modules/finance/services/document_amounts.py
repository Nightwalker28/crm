"""Money and quantity arithmetic shared by every commercial document (12c §3.1, 13d §3.1).

One place computes a line's amounts: quotes, orders, invoices, credit notes, POs, bills and
vendor credits all call `compute_line`, and `document_totals` gives every document the same
subtotal, discount, tax and total.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Iterable

from fastapi import HTTPException

CENT = Decimal("0.01")
ZERO = Decimal("0")


def money(value) -> Decimal:
    return Decimal(value or 0).quantize(CENT, rounding=ROUND_HALF_UP)


def decimal_input(value, *, field: str, positive: bool = False, places: int = 4) -> Decimal:
    try:
        result = Decimal(str(value).strip() if value is not None else "0")
        step = Decimal(1).scaleb(-places)
        valid = result.is_finite() and result == result.quantize(step) and (result > 0 if positive else result >= 0)
    except (InvalidOperation, ValueError, TypeError):
        valid = False
    if not valid:
        raise HTTPException(status_code=400, detail=f"{field} must be {'greater than zero' if positive else 'zero or more'}, with at most {places} decimal places")
    return result


@dataclass(frozen=True)
class LineAmounts:
    """A line's amounts. `gross` and `discount` are before tax, so on every document
    gross − discount + tax = total, whether its prices include tax or not."""

    gross: Decimal
    discount: Decimal
    net: Decimal
    tax: Decimal
    total: Decimal


def compute_line(*, quantity, unit_price, discount=ZERO, rate=None, tax=ZERO, inclusive: bool = False,
                 label: str = "Line") -> LineAmounts:
    """quantity × price − discount, with tax from `rate` (a percentage) or, when `rate` is None,
    the typed `tax` kept as is. Each amount is rounded half up to the cent (13d decision 4).

    Exclusive prices add the tax. Inclusive prices contain it: the line total is quantity ×
    price − discount, and the tax is taken out of it.
    """
    gross = money(Decimal(quantity) * Decimal(unit_price))
    discount = money(discount)
    if discount > gross:
        raise HTTPException(status_code=400, detail=f"{label}: the discount cannot exceed the line amount")
    after_discount = gross - discount
    if not inclusive:
        tax = money(after_discount * Decimal(rate) / 100) if rate is not None else money(tax)
        return LineAmounts(gross=gross, discount=discount, net=after_discount, tax=tax, total=after_discount + tax)
    if rate is not None:
        net = money(after_discount / (1 + Decimal(rate) / 100))
        tax = after_discount - net
    else:
        tax = money(tax)
        if tax > after_discount:
            raise HTTPException(status_code=400, detail=f"{label}: the tax cannot exceed the line amount, which includes it")
        net = after_discount - tax
    # The amounts before tax, in the same proportion as the line's net to its total.
    gross_before_tax = money(gross * net / after_discount) if after_discount > 0 else gross
    return LineAmounts(gross=gross_before_tax, discount=gross_before_tax - net, net=net, tax=tax, total=after_discount)


def document_totals(lines: Iterable[LineAmounts]) -> dict[str, Decimal]:
    """subtotal − discount + tax = total, the one definition on every document (13d §3.1, H16)."""
    lines = list(lines)
    return {
        "subtotal": sum((line.gross for line in lines), ZERO),
        "discount": sum((line.discount for line in lines), ZERO),
        "tax": sum((line.tax for line in lines), ZERO),
        "total": sum((line.total for line in lines), ZERO),
    }


LINE_TYPES = ("item", "section", "note")


def line_type_of(payload: dict) -> str:
    """A sales line's kind (13d §3.2): an item, or a section heading or note with no amounts."""
    line_type = str(payload.get("line_type") or "item").strip().lower()
    if line_type not in LINE_TYPES:
        raise HTTPException(status_code=400, detail="A line is an item, a section or a note")
    return line_type


def percent_input(value) -> Decimal | None:
    """A discount percentage, 0–100 with at most 4 places; blank is none."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    try:
        percent = Decimal(str(value).strip())
        valid = percent.is_finite() and 0 <= percent <= 100 and percent == percent.quantize(Decimal("0.0001"))
    except (InvalidOperation, ValueError, TypeError):
        valid = False
    if not valid:
        raise HTTPException(status_code=400, detail="A discount percentage is between 0 and 100")
    return percent


def resolve_discount(*, quantity, unit_price, discount=ZERO, percent: Decimal | None = None) -> Decimal:
    """The line's discount amount: its percentage of quantity × price when one is set, else the
    typed amount. A typed "10%" is a percentage, never ten units of money (H14, D10)."""
    if percent is None:
        return money(discount)
    return money(money(Decimal(quantity) * Decimal(unit_price)) * percent / 100)


def clean_unit(value) -> str | None:
    """The line's unit as typed (F6.2 manages the list); "unit" and blank are none."""
    text = " ".join(str(value or "").split())[:40]
    return text if text and text.lower() != "unit" else None


def line_amounts(*, quantity: Decimal, unit_price: Decimal, discount: Decimal = ZERO, tax: Decimal = ZERO, label: str = "Line") -> tuple[Decimal, Decimal]:
    """(net before tax, line total) for quantity × price − discount + tax, as on quotes and orders."""
    gross = money(Decimal(quantity) * Decimal(unit_price))
    discount, tax = money(discount), money(tax)
    if discount > gross:
        raise HTTPException(status_code=400, detail=f"{label}: the discount cannot exceed the line amount")
    net = gross - discount
    return net, net + tax


def pro_rata(amount, part, whole) -> Decimal:
    """`amount` × part ÷ whole, to the cent; the whole amount when part is all of it."""
    whole = Decimal(whole)
    if whole <= 0 or Decimal(part) >= whole:
        return money(amount)
    return money(Decimal(amount) * Decimal(part) / whole)


def units(value) -> str:
    text_value = format(Decimal(value).normalize(), "f")
    return f"{text_value} unit" if Decimal(value) == 1 else f"{text_value} units"
