"""add tenant-scoped performance indexes

Revision ID: 20260604_perf_indexes
Revises: 20260603_module_fields
Create Date: 2026-05-20
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260604_perf_indexes"
down_revision: Union[str, None] = "20260603_module_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


INDEXES = (
    ("ix_sales_contacts_active_tenant_contact_desc", "sales_contacts", "tenant_id, contact_id DESC", "deleted_at IS NULL"),
    ("ix_sales_contacts_deleted_tenant_deleted_desc", "sales_contacts", "tenant_id, deleted_at DESC, contact_id DESC", "deleted_at IS NOT NULL"),
    ("ix_sales_organizations_active_tenant_org_desc", "sales_organizations", "tenant_id, org_id DESC", "deleted_at IS NULL"),
    ("ix_sales_organizations_deleted_tenant_deleted_desc", "sales_organizations", "tenant_id, deleted_at DESC, org_id DESC", "deleted_at IS NOT NULL"),
    ("ix_sales_opportunities_active_tenant_opp_desc", "sales_opportunities", "tenant_id, opportunity_id DESC", "deleted_at IS NULL"),
    ("ix_sales_opportunities_deleted_tenant_deleted_desc", "sales_opportunities", "tenant_id, deleted_at DESC, opportunity_id DESC", "deleted_at IS NOT NULL"),
    ("ix_finance_io_active_tenant_id_desc", "finance_io", "tenant_id, id DESC", "deleted_at IS NULL"),
    ("ix_finance_io_deleted_tenant_deleted_desc", "finance_io", "tenant_id, deleted_at DESC, id DESC", "deleted_at IS NOT NULL"),
    ("ix_finance_pos_invoices_active_tenant_id_desc", "finance_pos_invoices", "tenant_id, id DESC", "deleted_at IS NULL"),
    ("ix_finance_pos_invoices_deleted_tenant_deleted_desc", "finance_pos_invoices", "tenant_id, deleted_at DESC, id DESC", "deleted_at IS NOT NULL"),
    ("ix_catalog_products_active_tenant_id_desc", "catalog_products", "tenant_id, id DESC", "deleted_at IS NULL"),
    ("ix_catalog_products_deleted_tenant_deleted_desc", "catalog_products", "tenant_id, deleted_at DESC, id DESC", "deleted_at IS NOT NULL"),
    ("ix_catalog_services_active_tenant_id_desc", "catalog_services", "tenant_id, id DESC", "deleted_at IS NULL"),
    ("ix_catalog_services_deleted_tenant_deleted_desc", "catalog_services", "tenant_id, deleted_at DESC, id DESC", "deleted_at IS NOT NULL"),
    ("ix_tasks_active_tenant_id_desc", "tasks", "tenant_id, id DESC", "deleted_at IS NULL"),
    ("ix_tasks_deleted_tenant_deleted_desc", "tasks", "tenant_id, deleted_at DESC, id DESC", "deleted_at IS NOT NULL"),
    ("ix_calendar_events_active_tenant_id_desc", "calendar_events", "tenant_id, id DESC", "deleted_at IS NULL"),
    ("ix_calendar_events_deleted_tenant_deleted_desc", "calendar_events", "tenant_id, deleted_at DESC, id DESC", "deleted_at IS NOT NULL"),
    ("ix_documents_active_tenant_id_desc", "documents", "tenant_id, id DESC", "deleted_at IS NULL"),
    ("ix_documents_deleted_tenant_deleted_desc", "documents", "tenant_id, deleted_at DESC, id DESC", "deleted_at IS NOT NULL"),
    ("ix_activity_logs_tenant_created_desc", "activity_logs", "tenant_id, created_at DESC, id DESC", None),
    ("ix_record_comments_tenant_module_entity", "record_comments", "tenant_id, module_key, entity_id, created_at DESC", None),
    ("ix_custom_module_records_active_tenant_id_desc", "custom_module_records", "tenant_id, custom_module_id, id DESC", "deleted_at IS NULL"),
    ("ix_custom_module_records_deleted_tenant_deleted_desc", "custom_module_records", "tenant_id, custom_module_id, deleted_at DESC, id DESC", "deleted_at IS NOT NULL"),
)


def upgrade() -> None:
    for name, table, columns, where_clause in INDEXES:
        where_sql = f" WHERE {where_clause}" if where_clause else ""
        op.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {table} ({columns}){where_sql}")


def downgrade() -> None:
    for name, _table, _columns, _where_clause in reversed(INDEXES):
        op.execute(f"DROP INDEX IF EXISTS {name}")

