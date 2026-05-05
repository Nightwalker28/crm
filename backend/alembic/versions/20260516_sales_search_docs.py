"""Add stored sales search documents

Revision ID: 20260516_sales_search_docs
Revises: 20260515_search_extensions
Create Date: 2026-05-16 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260516_sales_search_docs"
down_revision: Union[str, None] = "20260515_search_extensions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


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


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    if _table_exists(bind, "sales_contacts") and not _column_exists(bind, "sales_contacts", "search_doc"):
        op.execute(
            sa.text(
                """
                ALTER TABLE sales_contacts
                ADD COLUMN search_doc text GENERATED ALWAYS AS (
                    lower(
                        coalesce(first_name, '') || ' ' ||
                        coalesce(last_name, '') || ' ' ||
                        coalesce(contact_telephone, '') || ' ' ||
                        coalesce(primary_email, '') || ' ' ||
                        coalesce(current_title, '') || ' ' ||
                        coalesce(region, '') || ' ' ||
                        coalesce(country, '') || ' ' ||
                        coalesce(linkedin_url, '')
                    )
                ) STORED
                """
            )
        )
    if _table_exists(bind, "sales_organizations") and not _column_exists(bind, "sales_organizations", "search_doc"):
        op.execute(
            sa.text(
                """
                ALTER TABLE sales_organizations
                ADD COLUMN search_doc text GENERATED ALWAYS AS (
                    lower(
                        coalesce(org_name, '') || ' ' ||
                        coalesce(website, '') || ' ' ||
                        coalesce(primary_email, '') || ' ' ||
                        coalesce(industry, '') || ' ' ||
                        coalesce(billing_city, '') || ' ' ||
                        coalesce(billing_country, '')
                    )
                ) STORED
                """
            )
        )

    if _table_exists(bind, "sales_contacts") and not _index_exists(bind, "sales_contacts", "ix_sales_contacts_search_doc"):
        op.execute(sa.text("CREATE INDEX ix_sales_contacts_search_doc ON sales_contacts USING GIN (search_doc gin_trgm_ops)"))
    if _table_exists(bind, "sales_organizations") and not _index_exists(bind, "sales_organizations", "ix_sales_organizations_search_doc"):
        op.execute(sa.text("CREATE INDEX ix_sales_organizations_search_doc ON sales_organizations USING GIN (search_doc gin_trgm_ops)"))


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    if _index_exists(bind, "sales_contacts", "ix_sales_contacts_search_doc"):
        op.drop_index("ix_sales_contacts_search_doc", table_name="sales_contacts")
    if _index_exists(bind, "sales_organizations", "ix_sales_organizations_search_doc"):
        op.drop_index("ix_sales_organizations_search_doc", table_name="sales_organizations")
    if _column_exists(bind, "sales_contacts", "search_doc"):
        op.drop_column("sales_contacts", "search_doc")
    if _column_exists(bind, "sales_organizations", "search_doc"):
        op.drop_column("sales_organizations", "search_doc")
