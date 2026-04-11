"""Base schema with department module permissions"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20241208_base_schema"
down_revision = None
branch_labels = None
depends_on = None


user_status_enum = sa.Enum("pending", "active", "inactive", name="user_status")


def upgrade() -> None:
    op.create_table(
        "roles",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("level", sa.SmallInteger(), nullable=False, server_default="1"),
        sa.Column("description", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index(op.f("ix_roles_id"), "roles", ["id"], unique=False)

    op.create_table(
        "departments",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), server_onupdate=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_departments_id"), "departments", ["id"], unique=False)

    op.create_table(
        "teams",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("department_id", sa.BigInteger(), nullable=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), server_onupdate=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_teams_id"), "teams", ["id"], unique=False)

    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("team_id", sa.BigInteger(), nullable=True),
        sa.Column("role_id", sa.BigInteger(), nullable=True),
        sa.Column("first_name", sa.String(length=100), nullable=True),
        sa.Column("last_name", sa.String(length=100), nullable=True),
        sa.Column("email", sa.String(length=150), nullable=False),
        sa.Column("photo_url", sa.String(length=500), nullable=True),
        sa.Column("is_active", user_status_enum, server_default="pending", nullable=False),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=False)
    op.create_index(op.f("ix_users_id"), "users", ["id"], unique=False)

    op.create_table(
        "modules",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("base_route", sa.String(length=255), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index(op.f("ix_modules_id"), "modules", ["id"], unique=False)

    op.create_table(
        "department_module_permissions",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("department_id", sa.BigInteger(), nullable=False),
        sa.Column("module_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["module_id"], ["modules.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_department_module_permissions_id"),
        "department_module_permissions",
        ["id"],
        unique=False,
    )

    op.create_table(
        "finance_io",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("module_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=True),
        sa.Column("io_number", sa.Text(), nullable=False),
        sa.Column("file_name", sa.Text(), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=True),
        sa.Column("client_name", sa.Text(), nullable=False),
        sa.Column("campaign_name", sa.Text(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("campaign_type", sa.Text(), nullable=True),
        sa.Column("total_leads", sa.Text(), nullable=True),
        sa.Column("seniority_split", sa.Text(), nullable=True),
        sa.Column("cpl", sa.Text(), nullable=True),
        sa.Column("total_cost_of_project", sa.Text(), nullable=True),
        sa.Column("target_persona", sa.Text(), nullable=True),
        sa.Column("domain_cap", sa.Text(), nullable=True),
        sa.Column("target_geography", sa.Text(), nullable=True),
        sa.Column("delivery_format", sa.Text(), nullable=True),
        sa.Column("account_manager", sa.Text(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), server_onupdate=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_finance_io_id"), "finance_io", ["id"], unique=False)

    op.create_table(
        "sales_organizations",
        sa.Column("org_id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("org_name", sa.Text(), nullable=False),
        sa.Column("website", sa.Text(), nullable=True),
        sa.Column("primary_phone", sa.Text(), nullable=True),
        sa.Column("secondary_phone", sa.Text(), nullable=True),
        sa.Column("primary_email", sa.Text(), nullable=True),
        sa.Column("secondary_email", sa.Text(), nullable=True),
        sa.Column("industry", sa.Text(), nullable=True),
        sa.Column("annual_revenue", sa.Text(), nullable=True),
        sa.Column("assigned_to", sa.BigInteger(), nullable=True),
        sa.Column("created_time", sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("billing_address", sa.Text(), nullable=True),
        sa.Column("billing_city", sa.Text(), nullable=True),
        sa.Column("billing_state", sa.Text(), nullable=True),
        sa.Column("billing_postal_code", sa.Text(), nullable=True),
        sa.Column("billing_country", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["assigned_to"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("org_id"),
    )
    op.create_index(op.f("ix_sales_organizations_org_id"), "sales_organizations", ["org_id"], unique=False)

    op.create_table(
        "sales_contacts",
        sa.Column("contact_id", sa.BigInteger(), nullable=False),
        sa.Column("first_name", sa.Text(), nullable=True),
        sa.Column("last_name", sa.Text(), nullable=True),
        sa.Column("linkedin_url", sa.Text(), nullable=True),
        sa.Column("primary_email", sa.Text(), nullable=False),
        sa.Column("current_title", sa.Text(), nullable=True),
        sa.Column("region", sa.Text(), nullable=True),
        sa.Column("country", sa.Text(), nullable=True),
        sa.Column("email_opt_out", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("assigned_to", sa.BigInteger(), nullable=False),
        sa.Column("organization_id", sa.BigInteger(), nullable=True),
        sa.Column("created_time", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["assigned_to"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["organization_id"], ["sales_organizations.org_id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("contact_id"),
    )
    op.create_index(op.f("ix_sales_contacts_contact_id"), "sales_contacts", ["contact_id"], unique=False)
    op.create_index(op.f("ix_sales_contacts_primary_email"), "sales_contacts", ["primary_email"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_sales_contacts_primary_email"), table_name="sales_contacts")
    op.drop_index(op.f("ix_sales_contacts_contact_id"), table_name="sales_contacts")
    op.drop_table("sales_contacts")

    op.drop_index(op.f("ix_sales_organizations_org_id"), table_name="sales_organizations")
    op.drop_table("sales_organizations")

    op.drop_index(op.f("ix_finance_io_id"), table_name="finance_io")
    op.drop_table("finance_io")

    op.drop_index(op.f("ix_department_module_permissions_id"), table_name="department_module_permissions")
    op.drop_table("department_module_permissions")

    op.drop_index(op.f("ix_modules_id"), table_name="modules")
    op.drop_table("modules")

    op.drop_index(op.f("ix_users_id"), table_name="users")
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_table("users")

    op.drop_index(op.f("ix_teams_id"), table_name="teams")
    op.drop_table("teams")

    op.drop_index(op.f("ix_departments_id"), table_name="departments")
    op.drop_table("departments")

    op.drop_index(op.f("ix_roles_id"), table_name="roles")
    op.drop_table("roles")

    user_status_enum.drop(op.get_bind())
