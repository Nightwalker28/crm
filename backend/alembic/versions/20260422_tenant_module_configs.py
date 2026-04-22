"""add tenant module configs

Revision ID: 20260422_tenant_module_configs
Revises: 20260421_record_comments
Create Date: 2026-04-22 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260422_tenant_module_configs"
down_revision = "20260421_record_comments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tenant_module_configs",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("module_id", sa.BigInteger(), sa.ForeignKey("modules.id", ondelete="CASCADE"), nullable=False),
        sa.Column("is_enabled", sa.SmallInteger(), nullable=False, server_default=sa.text("1")),
        sa.Column("import_duplicate_mode", sa.String(length=20), nullable=False, server_default="skip"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.UniqueConstraint("tenant_id", "module_id", name="uq_tenant_module_configs_tenant_module"),
    )
    op.create_index("ix_tenant_module_configs_id", "tenant_module_configs", ["id"])
    op.create_index("ix_tenant_module_configs_tenant_id", "tenant_module_configs", ["tenant_id"])
    op.create_index("ix_tenant_module_configs_module_id", "tenant_module_configs", ["module_id"])

    op.execute(
        """
        INSERT INTO tenant_module_configs (tenant_id, module_id, is_enabled, import_duplicate_mode)
        SELECT tenants.id, modules.id, modules.is_enabled, modules.import_duplicate_mode
        FROM tenants
        CROSS JOIN modules
        """
    )


def downgrade() -> None:
    op.drop_index("ix_tenant_module_configs_module_id", table_name="tenant_module_configs")
    op.drop_index("ix_tenant_module_configs_tenant_id", table_name="tenant_module_configs")
    op.drop_index("ix_tenant_module_configs_id", table_name="tenant_module_configs")
    op.drop_table("tenant_module_configs")
