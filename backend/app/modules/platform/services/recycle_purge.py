from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings


PURGE_TARGETS: tuple[tuple[str, str], ...] = (
    ("sales_leads", "lead_id"),
    ("sales_contacts", "contact_id"),
    ("sales_organizations", "org_id"),
    ("sales_opportunities", "opportunity_id"),
    ("finance_io", "id"),
    ("finance_pos_invoices", "id"),
    ("catalog_products", "id"),
    ("catalog_services", "id"),
    ("tasks", "id"),
    ("calendar_events", "id"),
    ("documents", "id"),
    ("custom_module_records", "id"),
)


def purge_expired_recycle_bin_records(db: Session, *, retention_days: int | None = None, batch_size: int | None = None) -> dict[str, int]:
    days = retention_days if retention_days is not None else settings.RECYCLE_BIN_RETENTION_DAYS
    limit = batch_size if batch_size is not None else settings.RECYCLE_BIN_PURGE_BATCH_SIZE
    purged: dict[str, int] = {}
    for table_name, pk_column in PURGE_TARGETS:
        result = db.execute(
            text(
                f"""
                WITH rows_to_delete AS (
                    SELECT {pk_column}
                    FROM {table_name}
                    WHERE deleted_at < now() - (:retention_days * interval '1 day')
                    ORDER BY deleted_at ASC, {pk_column} ASC
                    LIMIT :batch_size
                )
                DELETE FROM {table_name}
                USING rows_to_delete
                WHERE {table_name}.{pk_column} = rows_to_delete.{pk_column}
                """
            ),
            {"retention_days": days, "batch_size": limit},
        )
        purged[table_name] = int(result.rowcount or 0)
    db.commit()
    return purged
