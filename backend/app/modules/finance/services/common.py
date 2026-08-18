from __future__ import annotations

from datetime import date, datetime


def finance_date_to_iso(value: date | datetime | None) -> str | None:
    """A calendar date — an issue date, a due date, the day a period starts.

    A `datetime` is truncated deliberately: these columns are `Date` on the model and the
    ones that are not (`created_at` falling back into `issue_date`) are still read as days.
    """

    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    return value.isoformat()


def finance_datetime_to_iso(value: datetime | None) -> str | None:
    """A timestamp — `created_at` and `updated_at`, which are moments rather than days.

    These went through `finance_date_to_iso` until rebuild 5.3 batch 4, and every consumer
    renders them with `formatDateTime`. Truncating to `YYYY-MM-DD` made `new Date(value)`
    parse as UTC midnight, so a record page west of Greenwich read `Updated Aug 17, 8:00 PM`
    for a row saved on the 18th — a wrong clock time and, often enough, the wrong day.
    """

    if value is None:
        return None
    return value.isoformat()
