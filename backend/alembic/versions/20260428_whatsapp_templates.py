"""add whatsapp click to chat and message templates

Revision ID: 20260428_whatsapp_templates
Revises: 20260428_io_number_seq
Create Date: 2026-04-28 16:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
import json


revision = "20260428_whatsapp_templates"
down_revision = "20260428_io_number_seq"
branch_labels = None
depends_on = None


WHATSAPP_TEMPLATE_ROWS = [
    (
        "whatsapp_quote_follow_up",
        "Quote follow-up",
        "Follow up after sending a quote.",
        "Hi {{customer_name}}, this is a quick follow-up regarding the quote we shared. Please let us know if you have any questions.",
        ["customer_name", "first_name", "organization_name"],
    ),
    (
        "whatsapp_payment_reminder",
        "Payment reminder",
        "Remind a customer about a pending payment.",
        "Hi {{customer_name}}, this is regarding invoice {{invoice_no}}. The pending amount is Rs. {{amount}}. Please let us know once payment is made.",
        ["customer_name", "first_name", "invoice_no", "amount", "organization_name"],
    ),
    (
        "whatsapp_delivery_confirmation",
        "Delivery confirmation",
        "Confirm delivery or handoff details.",
        "Hi {{customer_name}}, we are checking in to confirm delivery for {{delivery_reference}}. Please reply once received.",
        ["customer_name", "first_name", "delivery_reference", "organization_name"],
    ),
    (
        "whatsapp_meeting_reminder",
        "Meeting reminder",
        "Remind a customer about an upcoming meeting.",
        "Hi {{customer_name}}, this is a reminder for our meeting on {{meeting_date}} at {{meeting_time}}. Please let us know if the time still works.",
        ["customer_name", "first_name", "meeting_date", "meeting_time", "organization_name"],
    ),
    (
        "whatsapp_service_reminder",
        "Service reminder",
        "Remind a customer about service follow-up.",
        "Hi {{customer_name}}, this is a reminder regarding {{service_name}}. Please let us know a convenient time to continue.",
        ["customer_name", "first_name", "service_name", "organization_name"],
    ),
]


def _seed_module(module_name: str, base_route: str, description: str) -> None:
    op.execute(
        f"""
        INSERT INTO modules (name, base_route, description, is_enabled, import_duplicate_mode)
        VALUES ('{module_name}', '{base_route}', '{description}', 1, 'skip')
        ON CONFLICT (name) DO UPDATE
        SET base_route = EXCLUDED.base_route,
            description = EXCLUDED.description,
            is_enabled = 1
        """
    )
    op.execute(
        f"""
        INSERT INTO tenant_module_configs (tenant_id, module_id, is_enabled, import_duplicate_mode)
        SELECT tenants.id, modules.id, 1, 'skip'
        FROM tenants
        CROSS JOIN modules
        WHERE modules.name = '{module_name}'
        ON CONFLICT (tenant_id, module_id) DO NOTHING
        """
    )
    op.execute(
        f"""
        INSERT INTO department_module_permissions (department_id, module_id)
        SELECT departments.id, modules.id
        FROM departments
        CROSS JOIN modules
        WHERE modules.name = '{module_name}'
        ON CONFLICT DO NOTHING
        """
    )
    op.execute(
        f"""
        INSERT INTO team_module_permissions (team_id, module_id)
        SELECT teams.id, modules.id
        FROM teams
        CROSS JOIN modules
        WHERE modules.name = '{module_name}'
        ON CONFLICT DO NOTHING
        """
    )
    op.execute(
        f"""
        INSERT INTO role_module_permissions (
            role_id,
            module_id,
            can_view,
            can_create,
            can_edit,
            can_delete,
            can_restore,
            can_export,
            can_configure
        )
        SELECT
            roles.id,
            modules.id,
            1,
            CASE WHEN roles.level >= 90 THEN 1 ELSE 0 END,
            CASE WHEN roles.level >= 90 THEN 1 ELSE 0 END,
            CASE WHEN roles.level >= 90 THEN 1 ELSE 0 END,
            CASE WHEN roles.level >= 90 THEN 1 ELSE 0 END,
            0,
            CASE WHEN roles.level >= 100 THEN 1 ELSE 0 END
        FROM roles
        CROSS JOIN modules
        WHERE modules.name = '{module_name}'
        ON CONFLICT DO NOTHING
        """
    )


def upgrade() -> None:
    op.add_column("sales_contacts", sa.Column("whatsapp_last_contacted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_sales_contacts_whatsapp_last_contacted_at", "sales_contacts", ["whatsapp_last_contacted_at"])

    op.create_table(
        "message_templates",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("template_key", sa.String(length=120), nullable=False),
        sa.Column("name", sa.String(length=180), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("channel", sa.String(length=40), nullable=False),
        sa.Column("module_key", sa.String(length=100), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("variables", sa.JSON(), nullable=True),
        sa.Column("is_system", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_by_user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_by_user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("tenant_id", "template_key", name="uq_message_templates_tenant_key"),
    )
    op.create_index("ix_message_templates_id", "message_templates", ["id"])
    op.create_index("ix_message_templates_tenant_id", "message_templates", ["tenant_id"])
    op.create_index("ix_message_templates_template_key", "message_templates", ["template_key"])
    op.create_index("ix_message_templates_channel", "message_templates", ["channel"])
    op.create_index("ix_message_templates_module_key", "message_templates", ["module_key"])
    op.create_index("ix_message_templates_is_active", "message_templates", ["is_active"])
    op.create_index("ix_message_templates_created_by_user_id", "message_templates", ["created_by_user_id"])
    op.create_index("ix_message_templates_updated_by_user_id", "message_templates", ["updated_by_user_id"])
    op.create_index("ix_message_templates_created_at", "message_templates", ["created_at"])
    op.create_index("ix_message_templates_deleted_at", "message_templates", ["deleted_at"])

    op.create_table(
        "whatsapp_interactions",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor_user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("contact_id", sa.BigInteger(), sa.ForeignKey("sales_contacts.contact_id", ondelete="CASCADE"), nullable=False),
        sa.Column("template_id", sa.BigInteger(), sa.ForeignKey("message_templates.id", ondelete="SET NULL"), nullable=True),
        sa.Column("follow_up_task_id", sa.BigInteger(), sa.ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True),
        sa.Column("phone_number", sa.String(length=64), nullable=False),
        sa.Column("message_body", sa.Text(), nullable=False),
        sa.Column("whatsapp_url", sa.Text(), nullable=False),
        sa.Column("source_module_key", sa.String(length=100), server_default="sales_contacts", nullable=False),
        sa.Column("source_entity_id", sa.String(length=100), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_whatsapp_interactions_id", "whatsapp_interactions", ["id"])
    op.create_index("ix_whatsapp_interactions_tenant_id", "whatsapp_interactions", ["tenant_id"])
    op.create_index("ix_whatsapp_interactions_actor_user_id", "whatsapp_interactions", ["actor_user_id"])
    op.create_index("ix_whatsapp_interactions_contact_id", "whatsapp_interactions", ["contact_id"])
    op.create_index("ix_whatsapp_interactions_template_id", "whatsapp_interactions", ["template_id"])
    op.create_index("ix_whatsapp_interactions_follow_up_task_id", "whatsapp_interactions", ["follow_up_task_id"])
    op.create_index("ix_whatsapp_interactions_source_module_key", "whatsapp_interactions", ["source_module_key"])
    op.create_index("ix_whatsapp_interactions_source_entity_id", "whatsapp_interactions", ["source_entity_id"])
    op.create_index("ix_whatsapp_interactions_sent_at", "whatsapp_interactions", ["sent_at"])
    op.create_index("ix_whatsapp_interactions_created_at", "whatsapp_interactions", ["created_at"])

    _seed_module("whatsapp", "/dashboard/whatsapp", "WhatsApp click-to-chat and CRM communication follow-up")
    _seed_module("message_templates", "/dashboard/settings/message-templates", "Reusable CRM message templates for communication channels")

    connection = op.get_bind()
    for key, name, description, body, variables in WHATSAPP_TEMPLATE_ROWS:
        connection.execute(
            sa.text(
                """
                INSERT INTO message_templates (
                    tenant_id,
                    template_key,
                    name,
                    description,
                    channel,
                    module_key,
                    body,
                    variables,
                    is_system,
                    is_active
                )
                SELECT
                    tenants.id,
                    :template_key,
                    :name,
                    :description,
                    'whatsapp',
                    'sales_contacts',
                    :body,
                    CAST(:variables AS JSON),
                    true,
                    true
                FROM tenants
                ON CONFLICT (tenant_id, template_key) DO NOTHING
                """
            ),
            {
                "template_key": key,
                "name": name,
                "description": description,
                "body": body,
                "variables": json.dumps(variables),
            },
        )


def downgrade() -> None:
    op.execute("DELETE FROM message_templates WHERE channel = 'whatsapp'")
    for module_name in ("whatsapp", "message_templates"):
        op.execute(f"DELETE FROM role_module_permissions WHERE module_id IN (SELECT id FROM modules WHERE name = '{module_name}')")
        op.execute(f"DELETE FROM team_module_permissions WHERE module_id IN (SELECT id FROM modules WHERE name = '{module_name}')")
        op.execute(f"DELETE FROM department_module_permissions WHERE module_id IN (SELECT id FROM modules WHERE name = '{module_name}')")
        op.execute(f"DELETE FROM tenant_module_configs WHERE module_id IN (SELECT id FROM modules WHERE name = '{module_name}')")
        op.execute(f"DELETE FROM modules WHERE name = '{module_name}'")

    op.drop_index("ix_whatsapp_interactions_created_at", table_name="whatsapp_interactions")
    op.drop_index("ix_whatsapp_interactions_sent_at", table_name="whatsapp_interactions")
    op.drop_index("ix_whatsapp_interactions_source_entity_id", table_name="whatsapp_interactions")
    op.drop_index("ix_whatsapp_interactions_source_module_key", table_name="whatsapp_interactions")
    op.drop_index("ix_whatsapp_interactions_follow_up_task_id", table_name="whatsapp_interactions")
    op.drop_index("ix_whatsapp_interactions_template_id", table_name="whatsapp_interactions")
    op.drop_index("ix_whatsapp_interactions_contact_id", table_name="whatsapp_interactions")
    op.drop_index("ix_whatsapp_interactions_actor_user_id", table_name="whatsapp_interactions")
    op.drop_index("ix_whatsapp_interactions_tenant_id", table_name="whatsapp_interactions")
    op.drop_index("ix_whatsapp_interactions_id", table_name="whatsapp_interactions")
    op.drop_table("whatsapp_interactions")

    op.drop_index("ix_message_templates_deleted_at", table_name="message_templates")
    op.drop_index("ix_message_templates_created_at", table_name="message_templates")
    op.drop_index("ix_message_templates_updated_by_user_id", table_name="message_templates")
    op.drop_index("ix_message_templates_created_by_user_id", table_name="message_templates")
    op.drop_index("ix_message_templates_is_active", table_name="message_templates")
    op.drop_index("ix_message_templates_module_key", table_name="message_templates")
    op.drop_index("ix_message_templates_channel", table_name="message_templates")
    op.drop_index("ix_message_templates_template_key", table_name="message_templates")
    op.drop_index("ix_message_templates_tenant_id", table_name="message_templates")
    op.drop_index("ix_message_templates_id", table_name="message_templates")
    op.drop_table("message_templates")

    op.drop_index("ix_sales_contacts_whatsapp_last_contacted_at", table_name="sales_contacts")
    op.drop_column("sales_contacts", "whatsapp_last_contacted_at")
