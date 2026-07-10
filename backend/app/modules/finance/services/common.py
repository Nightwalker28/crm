from __future__ import annotations

from datetime import date, datetime


def finance_date_to_iso(value: date | datetime | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    return value.isoformat()
