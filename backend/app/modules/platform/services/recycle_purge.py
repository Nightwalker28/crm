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
RECORD_TAG_MODULE_KEYS = {"sales_leads": "sales_leads"}


def _quote_purge_identifier(identifier: str) -> str:
    if not IDENTIFIER_PATTERN.fullmatch(identifier):
        raise ValueError("Unsafe recycle purge identifier")
    return f'"{identifier}"'


def _build_purge_statement(table_name: str, pk_column: str):
    table_identifier = _quote_purge_identifier(table_name)
    pk_identifier = _quote_purge_identifier(pk_column)
    tag_module_key = RECORD_TAG_MODULE_KEYS.get(table_name)
    tag_cleanup = ""
    if tag_module_key:
        tag_cleanup = f""",
        deleted_tag_links AS (
            DELETE FROM record_tag_links
            WHERE tenant_id IN (
                SELECT {table_identifier}.tenant_id
                FROM {table_identifier}
                JOIN rows_to_delete ON {table_identifier}.{pk_identifier} = rows_to_delete.{pk_identifier}
            )
            AND module_key = '{tag_module_key}'
            AND entity_id IN (SELECT CAST({pk_identifier} AS text) FROM rows_to_delete)
            RETURNING id
        )"""
    return text(
        f"""
        WITH rows_to_delete AS (
            SELECT {pk_identifier}
            FROM {table_identifier}
            WHERE deleted_at < now() - (:retention_days * interval '1 day')
            ORDER BY deleted_at ASC, {pk_identifier} ASC
            LIMIT :batch_size
        ){tag_cleanup}
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
