"""Money and quantity arithmetic shared by invoices, credit notes and bills (12c §3.1).

One place computes a line's amounts, so tax codes later are a nullable column plus a
branch here (12c §5a), not a change to three documents.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

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
