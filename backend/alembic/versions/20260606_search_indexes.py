"""add postgres search indexes for high volume modules

Revision ID: 20260606_search_indexes
Revises: 20260605_generic_records
Create Date: 2026-05-20
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260606_search_indexes"
down_revision: Union[str, None] = "20260605_generic_records"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


SEARCH_INDEXES = (
    (
        "ix_sales_contacts_search_doc_trgm_active",
        "sales_contacts",
        "search_doc",
        "deleted_at IS NULL",
    ),
    (
        "ix_sales_organizations_search_doc_trgm_active",
        "sales_organizations",
        "search_doc",
        "deleted_at IS NULL",
    ),
)

EXPRESSION_SEARCH_INDEXES = (
    (
        "ix_sales_opportunities_search_trgm_active",
        "sales_opportunities",
        "lower(coalesce(opportunity_name, '') || ' ' || coalesce(client, '') || ' ' || coalesce(sales_stage, '') || ' ' || coalesce(total_cost_of_project, '') || ' ' || coalesce(currency_type, ''))",
        "deleted_at IS NULL",
    ),
    (
        "ix_finance_io_search_trgm_active",
        "finance_io",
        "lower(coalesce(io_number, '') || ' ' || coalesce(customer_name, '') || ' ' || coalesce(counterparty_reference, '') || ' ' || coalesce(external_reference, '') || ' ' || coalesce(status, '') || ' ' || coalesce(currency, '') || ' ' || coalesce(file_name, '') || ' ' || coalesce(notes, ''))",
        "deleted_at IS NULL",
    ),
    (
        "ix_finance_pos_invoices_search_trgm_active",
        "finance_pos_invoices",
        "lower(coalesce(invoice_number, '') || ' ' || coalesce(customer_name, '') || ' ' || coalesce(customer_email, '') || ' ' || coalesce(status, '') || ' ' || coalesce(payment_status, '') || ' ' || coalesce(payment_method, '') || ' ' || coalesce(notes, ''))",
        "deleted_at IS NULL",
    ),
    (
        "ix_tasks_search_trgm_active",
        "tasks",
        "lower(coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(status, '') || ' ' || coalesce(priority, '') || ' ' || coalesce(source_label, ''))",
        "deleted_at IS NULL",
    ),
    (
        "ix_calendar_events_search_trgm_active",
        "calendar_events",
        "lower(coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(location, '') || ' ' || coalesce(source_label, ''))",
        "deleted_at IS NULL",
    ),
    (
        "ix_documents_search_trgm_active",
        "documents",
        "lower(coalesce(title, '') || ' ' || coalesce(original_filename, '') || ' ' || coalesce(content_type, '') || ' ' || coalesce(extension, ''))",
        "deleted_at IS NULL",
    ),
    (
        "ix_client_pages_search_trgm_active",
        "client_pages",
        "lower(coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(source_module_key, '') || ' ' || coalesce(source_entity_id, ''))",
        "status != 'archived'",
    ),
    (
        "ix_custom_module_records_search_trgm_active",
        "custom_module_records",
        "lower(coalesce(title, ''))",
        "deleted_at IS NULL",
    ),
    (
        "ix_mail_messages_search_trgm_active",
        "mail_messages",
        "lower(coalesce(subject, '') || ' ' || coalesce(snippet, '') || ' ' || coalesce(from_email, '') || ' ' || coalesce(from_name, '') || ' ' || coalesce(source_label, ''))",
        "deleted_at IS NULL",
    ),
)


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _column_exists(bind, table_name: str, column_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return column_name in {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def _index_exists(bind, table_name: str, index_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return index_name in {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def _safe_create_trgm_expression_index(bind, *, name: str, table: str, expression: str, where_clause: str) -> None:
    if not _table_exists(bind, table) or _index_exists(bind, table, name):
        return
    op.execute(
        sa.text(
            f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} ON {table} USING GIN (({expression}) gin_trgm_ops) WHERE {where_clause}"
        )
    )


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    with op.get_context().autocommit_block():
        op.execute(sa.text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))

        for name, table, column, where_clause in SEARCH_INDEXES:
            if not _column_exists(bind, table, column) or _index_exists(bind, table, name):
                continue
            op.execute(
                sa.text(
                    f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} ON {table} USING GIN ({column} gin_trgm_ops) WHERE {where_clause}"
                )
            )

        for name, table, expression, where_clause in EXPRESSION_SEARCH_INDEXES:
            _safe_create_trgm_expression_index(
                bind,
                name=name,
                table=table,
                expression=expression,
                where_clause=where_clause,
            )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    with op.get_context().autocommit_block():
        for name, table, _expression, _where_clause in reversed(EXPRESSION_SEARCH_INDEXES):
            if _index_exists(bind, table, name):
                op.execute(sa.text(f"DROP INDEX CONCURRENTLY IF EXISTS {name}"))
        for name, table, _column, _where_clause in reversed(SEARCH_INDEXES):
            if _index_exists(bind, table, name):
                op.execute(sa.text(f"DROP INDEX CONCURRENTLY IF EXISTS {name}"))
