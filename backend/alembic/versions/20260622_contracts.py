"""add contracts

Revision ID: 20260622_contracts
Revises: 20260621_support_cases
Create Date: 2026-05-29
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260622_contracts"
down_revision: Union[str, None] = "20260621_support_cases"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _index_exists(bind, table_name: str, index_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return index_name in {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "contracts"):
        op.create_table(
            "contracts",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("contract_number", sa.String(length=80), nullable=False),
            sa.Column("title", sa.Text(), nullable=False),
            sa.Column("status", sa.String(length=40), server_default="draft", nullable=False),
            sa.Column("organization_id", sa.BigInteger(), nullable=True),
            sa.Column("contact_id", sa.BigInteger(), nullable=True),
            sa.Column("opportunity_id", sa.BigInteger(), nullable=True),
            sa.Column("quote_id", sa.BigInteger(), nullable=True),
            sa.Column("order_id", sa.Integer(), nullable=True),
            sa.Column("document_id", sa.BigInteger(), nullable=True),
            sa.Column("effective_date", sa.Date(), nullable=True),
            sa.Column("expiration_date", sa.Date(), nullable=True),
            sa.Column("renewal_date", sa.Date(), nullable=True),
            sa.Column("value_amount", sa.Numeric(18, 2), nullable=True),
            sa.Column("currency", sa.String(length=10), nullable=True),
            sa.Column("owner_id", sa.BigInteger(), nullable=True),
            sa.Column("created_by_id", sa.BigInteger(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.CheckConstraint("status IN ('draft', 'review', 'sent', 'partially_signed', 'signed', 'active', 'expired', 'cancelled')", name="ck_contracts_status"),
            sa.ForeignKeyConstraint(["contact_id"], ["sales_contacts.contact_id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["opportunity_id"], ["sales_opportunities.opportunity_id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["order_id"], ["sales_orders.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["organization_id"], ["sales_organizations.org_id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["quote_id"], ["sales_quotes.quote_id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("tenant_id", "contract_number", name="uq_contracts_tenant_number"),
        )
    if not _table_exists(bind, "contract_parties"):
        op.create_table(
            "contract_parties",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("contract_id", sa.Integer(), nullable=False),
            sa.Column("name", sa.Text(), nullable=False),
            sa.Column("email", sa.String(length=255), nullable=True),
            sa.Column("role", sa.String(length=80), server_default="counterparty", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["contract_id"], ["contracts.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    if not _table_exists(bind, "contract_signers"):
        op.create_table(
            "contract_signers",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("contract_id", sa.Integer(), nullable=False),
            sa.Column("party_id", sa.Integer(), nullable=True),
            sa.Column("name", sa.Text(), nullable=False),
            sa.Column("email", sa.String(length=255), nullable=False),
            sa.Column("signing_order", sa.Integer(), server_default="1", nullable=False),
            sa.Column("status", sa.String(length=40), server_default="pending", nullable=False),
            sa.Column("signed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.CheckConstraint("status IN ('pending', 'sent', 'viewed', 'signed', 'declined', 'voided')", name="ck_contract_signers_status"),
            sa.ForeignKeyConstraint(["contract_id"], ["contracts.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["party_id"], ["contract_parties.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    if not _table_exists(bind, "contract_events"):
        op.create_table(
            "contract_events",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("contract_id", sa.Integer(), nullable=False),
            sa.Column("event_type", sa.String(length=100), nullable=False),
            sa.Column("payload_json", sa.JSON(), server_default="{}", nullable=False),
            sa.Column("created_by_id", sa.BigInteger(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["contract_id"], ["contracts.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )

    indexes = [
        ("contracts", "ix_contracts_id", ["id"]),
        ("contracts", "ix_contracts_tenant_id", ["tenant_id"]),
        ("contracts", "ix_contracts_contract_number", ["contract_number"]),
        ("contracts", "ix_contracts_organization_id", ["organization_id"]),
        ("contracts", "ix_contracts_contact_id", ["contact_id"]),
        ("contracts", "ix_contracts_opportunity_id", ["opportunity_id"]),
        ("contracts", "ix_contracts_quote_id", ["quote_id"]),
        ("contracts", "ix_contracts_order_id", ["order_id"]),
        ("contracts", "ix_contracts_document_id", ["document_id"]),
        ("contracts", "ix_contracts_owner_id", ["owner_id"]),
        ("contracts", "ix_contracts_created_by_id", ["created_by_id"]),
        ("contracts", "ix_contracts_tenant_status", ["tenant_id", "status"]),
        ("contracts", "ix_contracts_tenant_owner", ["tenant_id", "owner_id"]),
        ("contracts", "ix_contracts_tenant_updated", ["tenant_id", "updated_at"]),
        ("contract_parties", "ix_contract_parties_tenant_contract", ["tenant_id", "contract_id"]),
        ("contract_signers", "ix_contract_signers_tenant_contract", ["tenant_id", "contract_id"]),
        ("contract_signers", "ix_contract_signers_tenant_status", ["tenant_id", "status"]),
        ("contract_events", "ix_contract_events_tenant_contract", ["tenant_id", "contract_id"]),
        ("contract_events", "ix_contract_events_tenant_type", ["tenant_id", "event_type"]),
    ]
    for table_name, index_name, columns in indexes:
        if not _index_exists(bind, table_name, index_name):
            op.create_index(index_name, table_name, columns, unique=False)

    op.execute(sa.text("""
        INSERT INTO modules (name, base_route, description, is_enabled)
        VALUES ('contracts', '/dashboard/contracts', 'Contract lifecycle and e-sign tracking', 1)
        ON CONFLICT (name) DO UPDATE
        SET base_route = EXCLUDED.base_route,
            description = EXCLUDED.description,
            is_enabled = 1
    """))
    for table_name, id_column in (
        ("department_module_permissions", "department_id"),
        ("team_module_permissions", "team_id"),
    ):
        source_table = "departments" if table_name.startswith("department") else "teams"
        op.execute(sa.text(f"""
            INSERT INTO {table_name} ({id_column}, module_id)
            SELECT {source_table}.id, modules.id
            FROM {source_table}
            CROSS JOIN modules
            WHERE modules.name = 'contracts'
            ON CONFLICT ({id_column}, module_id) DO NOTHING
        """))
    op.execute(sa.text("""
        INSERT INTO role_module_permissions (
            role_id, module_id, can_view, can_create, can_edit, can_delete, can_restore, can_export, can_configure
        )
        SELECT roles.id, modules.id, 1,
            CASE WHEN roles.level >= 10 THEN 1 ELSE 0 END,
            CASE WHEN roles.level >= 10 THEN 1 ELSE 0 END,
            CASE WHEN roles.level >= 90 THEN 1 ELSE 0 END,
            0,
            CASE WHEN roles.level >= 90 THEN 1 ELSE 0 END,
            CASE WHEN roles.level >= 100 THEN 1 ELSE 0 END
        FROM roles
        CROSS JOIN modules
        WHERE modules.name = 'contracts'
        ON CONFLICT (role_id, module_id) DO NOTHING
    """))


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM role_module_permissions WHERE module_id IN (SELECT id FROM modules WHERE name = 'contracts')"))
    op.execute(sa.text("DELETE FROM team_module_permissions WHERE module_id IN (SELECT id FROM modules WHERE name = 'contracts')"))
    op.execute(sa.text("DELETE FROM department_module_permissions WHERE module_id IN (SELECT id FROM modules WHERE name = 'contracts')"))
    op.execute(sa.text("DELETE FROM tenant_module_configs WHERE module_id IN (SELECT id FROM modules WHERE name = 'contracts')"))
    op.execute(sa.text("DELETE FROM modules WHERE name = 'contracts'"))
    bind = op.get_bind()
    for table_name in ("contract_events", "contract_signers", "contract_parties", "contracts"):
        if _table_exists(bind, table_name):
            op.drop_table(table_name)
