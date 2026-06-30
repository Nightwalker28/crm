from __future__ import annotations

import re

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings


IDENTIFIER_PATTERN = re.compile(r"^[a-z_][a-z0-9_]*$")
PURGE_TARGETS: tuple[tuple[str, str], ...] = (
    ("sales_leads", "lead_id"),
    ("sales_contacts", "contact_id"),
    ("sales_organizations", "org_id"),
    ("sales_opportunities", "opportunity_id"),
    ("sales_quotes", "quote_id"),
    ("finance_io", "id"),
    ("finance_pos_invoices", "id"),
    ("catalog_products", "id"),
    ("catalog_services", "id"),
    ("tasks", "id"),
    ("calendar_events", "id"),
    ("documents", "id"),
    ("custom_module_records", "id"),
)


def _quote_purge_identifier(identifier: str) -> str:
    if not IDENTIFIER_PATTERN.fullmatch(identifier):
        raise ValueError("Unsafe recycle purge identifier")
    return f'"{identifier}"'


def _build_purge_statement(table_name: str, pk_column: str):
    table_identifier = _quote_purge_identifier(table_name)
    pk_identifier = _quote_purge_identifier(pk_column)
    return text(
        f"""
        WITH rows_to_delete AS (
            SELECT {pk_identifier}
            FROM {table_identifier}
            WHERE deleted_at < now() - (:retention_days * interval '1 day')
            ORDER BY deleted_at ASC, {pk_identifier} ASC
            LIMIT :batch_size
        )
        DELETE FROM {table_identifier}
        USING rows_to_delete
        WHERE {table_identifier}.{pk_identifier} = rows_to_delete.{pk_identifier}
        """
    )


def purge_expired_recycle_bin_records(db: Session, *, retention_days: int | None = None, batch_size: int | None = None) -> dict[str, int]:
    days = retention_days if retention_days is not None else settings.RECYCLE_BIN_RETENTION_DAYS
    limit = batch_size if batch_size is not None else settings.RECYCLE_BIN_PURGE_BATCH_SIZE
    purged: dict[str, int] = {}
    for table_name, pk_column in PURGE_TARGETS:
        result = db.execute(
            _build_purge_statement(table_name, pk_column),
            {"retention_days": days, "batch_size": limit},
        )
        purged[table_name] = int(result.rowcount or 0)
    db.commit()
    return purged
