"""add reusable record tags and lead team assignment

Revision ID: 20260723_lead_team_tags
Revises: 20260722_lead_followup
Create Date: 2026-07-14
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260723_lead_team_tags"
down_revision: Union[str, None] = "20260722_lead_followup"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "record_tags",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("normalized_name", sa.String(length=50), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "id", name="uq_record_tags_tenant_id"),
        sa.UniqueConstraint("tenant_id", "normalized_name", name="uq_record_tags_tenant_normalized_name"),
    )
    op.create_index("ix_record_tags_tenant_id", "record_tags", ["tenant_id"])
    op.create_index("ix_record_tags_tenant_name", "record_tags", ["tenant_id", "name"])

    op.create_table(
        "record_tag_links",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("module_key", sa.String(length=100), nullable=False),
        sa.Column("entity_id", sa.String(length=100), nullable=False),
        sa.Column("tag_id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["tenant_id", "tag_id"],
            ["record_tags.tenant_id", "record_tags.id"],
            name="fk_record_tag_links_tenant_tag",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "module_key", "entity_id", "tag_id", name="uq_record_tag_links_tenant_record_tag"),
    )
    op.create_index("ix_record_tag_links_tenant_id", "record_tag_links", ["tenant_id"])
    op.create_index("ix_record_tag_links_module_key", "record_tag_links", ["module_key"])
    op.create_index("ix_record_tag_links_entity_id", "record_tag_links", ["entity_id"])
    op.create_index("ix_record_tag_links_tag_id", "record_tag_links", ["tag_id"])
    op.create_index("ix_record_tag_links_tenant_record", "record_tag_links", ["tenant_id", "module_key", "entity_id"])

    op.add_column("sales_leads", sa.Column("team_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key("fk_sales_leads_team_id_teams", "sales_leads", "teams", ["team_id"], ["id"], ondelete="SET NULL")
    op.create_index(
        "ix_sales_leads_tenant_team_active",
        "sales_leads",
        ["tenant_id", "team_id"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_sales_leads_tenant_team_active", table_name="sales_leads")
    op.drop_constraint("fk_sales_leads_team_id_teams", "sales_leads", type_="foreignkey")
    op.drop_column("sales_leads", "team_id")
    op.drop_index("ix_record_tag_links_tenant_record", table_name="record_tag_links")
    op.drop_index("ix_record_tag_links_tag_id", table_name="record_tag_links")
    op.drop_index("ix_record_tag_links_entity_id", table_name="record_tag_links")
    op.drop_index("ix_record_tag_links_module_key", table_name="record_tag_links")
    op.drop_index("ix_record_tag_links_tenant_id", table_name="record_tag_links")
    op.drop_table("record_tag_links")
    op.drop_index("ix_record_tags_tenant_name", table_name="record_tags")
    op.drop_index("ix_record_tags_tenant_id", table_name="record_tags")
    op.drop_table("record_tags")
