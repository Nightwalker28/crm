from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session


def _utc_now(value: datetime | None = None) -> datetime:
    current = value or datetime.now(timezone.utc)
    if current.tzinfo is None:
        return current.replace(tzinfo=timezone.utc)
    return current.astimezone(timezone.utc)


def allocate_business_number(
    db: Session,
    *,
    tenant_id: int,
    scope: str,
    prefix: str,
    timestamp: datetime | None = None,
) -> str:
    current = _utc_now(timestamp)
    period = f"{current:%Y%m%d}"
    allocated = db.execute(
        text(
            """
            INSERT INTO crm_number_counters (tenant_id, scope, period, next_value, updated_at)
            VALUES (:tenant_id, :scope, :period, 2, CURRENT_TIMESTAMP)
            ON CONFLICT (tenant_id, scope, period)
            DO UPDATE SET
                next_value = crm_number_counters.next_value + 1,
                updated_at = CURRENT_TIMESTAMP
            RETURNING next_value - 1
            """
        ),
        {"tenant_id": tenant_id, "scope": scope, "period": period},
    ).scalar_one()
    return f"{prefix}-{period}-{int(allocated):04d}"
