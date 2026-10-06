"""Reading an amount people typed (13b §3.5): `150000`, `1,250.50`, `LKR 75M`, `2.5k`."""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation

NUMBER_RE = re.compile(r"(-?\d+(?:\.\d+)?)\s*([kmb])?\b", re.IGNORECASE)
SCALE = {"k": Decimal(1_000), "m": Decimal(1_000_000), "b": Decimal(1_000_000_000)}


def parse_amount(text) -> Decimal | None:
    """A non-negative number from free text, scaled by a K/M/B suffix; None when there is none."""
    if text is None:
        return None
    if isinstance(text, (int, float, Decimal)):
        value = Decimal(str(text))
        return value if value >= 0 else None
    cleaned = str(text).replace(",", "").strip()
    match = NUMBER_RE.search(cleaned) if cleaned else None
    if not match:
        return None
    try:
        value = Decimal(match.group(1))
    except InvalidOperation:
        return None
    if match.group(2):
        value *= SCALE[match.group(2).lower()]
    return value if value >= 0 else None
