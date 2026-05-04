"""Add record detail and soft-delete hot-path indexes

Revision ID: 20260512_hot_path_idx
Revises: 20260511_hot_path_indexes
Create Date: 2026-05-12 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260512_hot_path_idx"
down_revision: Union[str, None] = "20260511_hot_path_indexes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _index_exists(bind, table_name: str, index_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return index_name in {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def _create_index_if_missing(index_name: str, table_name: str, columns: list[str]) -> None:
    bind = op.get_bind()
    if _table_exists(bind, table_name) and not _index_exists(bind, table_name, index_name):
        op.create_index(index_name, table_name, columns)


def _execute_for_table(table_name: str, sql: str) -> None:
    bind = op.get_bind()
    if _table_exists(bind, table_name):
        op.execute(sa.text(sql))


def _execute_postgres_for_table(table_name: str, sql: str) -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql" and _table_exists(bind, table_name):
        op.execute(sa.text(sql))


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(sa.text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))

    _create_index_if_missing("ix_document_links_module_entity", "document_links", ["module_key", "entity_id"])

    _execute_for_table(
        "activity_logs",
        "CREATE INDEX IF NOT EXISTS ix_activity_logs_created_at ON activity_logs (created_at DESC)",
    )

    _execute_postgres_for_table(
        "finance_io",
        """
        CREATE INDEX IF NOT EXISTS ix_finance_io_tenant_status_active
        ON finance_io (tenant_id, status)
        WHERE deleted_at IS NULL
        """,
    )
    _create_index_if_missing("ix_finance_io_tenant_contact", "finance_io", ["tenant_id", "customer_contact_id"])

    _execute_postgres_for_table(
        "sales_opportunities",
        """
        CREATE INDEX IF NOT EXISTS ix_sales_opportunities_tenant_stage_active
        ON sales_opportunities (tenant_id, sales_stage)
        WHERE deleted_at IS NULL
        """,
    )
    _create_index_if_missing(
        "ix_sales_opportunities_tenant_contact",
        "sales_opportunities",
        ["tenant_id", "contact_id"],
    )

    _execute_postgres_for_table(
        "sales_contacts",
        """
        CREATE INDEX IF NOT EXISTS ix_sales_contacts_search_trgm
        ON sales_contacts
        USING gin (
          lower(
            coalesce(first_name, '') || ' ' ||
            coalesce(last_name, '') || ' ' ||
            coalesce(contact_telephone, '') || ' ' ||
            coalesce(primary_email, '') || ' ' ||
            coalesce(current_title, '') || ' ' ||
            coalesce(region, '') || ' ' ||
            coalesce(country, '') || ' ' ||
            coalesce(linkedin_url, '')
          ) gin_trgm_ops
        )
        """,
    )
    _execute_postgres_for_table(
        "sales_organizations",
        """
        CREATE INDEX IF NOT EXISTS ix_sales_organizations_search_trgm
        ON sales_organizations
        USING gin (
          lower(
            coalesce(org_name, '') || ' ' ||
            coalesce(website, '') || ' ' ||
            coalesce(primary_email, '') || ' ' ||
            coalesce(industry, '') || ' ' ||
            coalesce(billing_city, '') || ' ' ||
            coalesce(billing_country, '')
          ) gin_trgm_ops
        )
        """,
    )

    for table_name, index_name in (
        ("sales_contacts", "ix_sales_contacts_active_tenant"),
        ("sales_organizations", "ix_sales_organizations_active_tenant"),
        ("sales_opportunities", "ix_sales_opportunities_active_tenant"),
        ("finance_io", "ix_finance_io_active_tenant"),
        ("tasks", "ix_tasks_active_tenant"),
        ("calendar_events", "ix_calendar_events_active_tenant"),
        ("documents", "ix_documents_active_tenant"),
    ):
        _execute_postgres_for_table(
            table_name,
            f"""
            CREATE INDEX IF NOT EXISTS {index_name}
            ON {table_name} (tenant_id)
            WHERE deleted_at IS NULL
            """,
        )


def downgrade() -> None:
    for index_name in (
        "ix_documents_active_tenant",
        "ix_calendar_events_active_tenant",
        "ix_tasks_active_tenant",
        "ix_finance_io_active_tenant",
        "ix_sales_opportunities_active_tenant",
        "ix_sales_organizations_active_tenant",
        "ix_sales_contacts_active_tenant",
        "ix_sales_opportunities_tenant_stage_active",
        "ix_finance_io_tenant_status_active",
        "ix_activity_logs_created_at",
    ):
        op.execute(sa.text(f"DROP INDEX IF EXISTS {index_name}"))

    _drop_bind = op.get_bind()
    for table_name, index_name in (
        ("sales_opportunities", "ix_sales_opportunities_tenant_contact"),
        ("finance_io", "ix_finance_io_tenant_contact"),
        ("document_links", "ix_document_links_module_entity"),
    ):
        if _index_exists(_drop_bind, table_name, index_name):
            op.drop_index(index_name, table_name=table_name)
