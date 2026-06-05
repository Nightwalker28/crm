import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.platform.services.record_comments import (
    INVALID_MENTION_DETAIL,
    create_record_mention_notifications,
    get_record_reference,
    list_mentionable_record_users,
    validate_record_mentions,
)
from app.modules.sales.models import SalesContact, SalesOrder
from app.modules.support.models import SupportCase
from app.modules.user_management.models import Module, Role, User, UserStatus
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.documents import models as document_models  # noqa: F401


class RecordCommentMentionTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.db.add_all(
            [
                Module(id=1, name="sales_contacts", base_route="sales_contacts", is_enabled=1),
                Module(id=2, name="sales_orders", base_route="sales_orders", is_enabled=1),
                Module(id=3, name="support_cases", base_route="support_cases", is_enabled=1),
                Role(id=1, tenant_id=10, name="Admin", level=100),
                Role(id=2, tenant_id=10, name="User", level=10),
                User(
                    id=1,
                    tenant_id=10,
                    email="admin@example.com",
                    first_name="Ava",
                    last_name="Admin",
                    role_id=1,
                    is_active=UserStatus.active,
                ),
                User(
                    id=2,
                    tenant_id=10,
                    email="blocked@example.com",
                    first_name="Ben",
                    last_name="Blocked",
                    role_id=2,
                    is_active=UserStatus.active,
                ),
                User(
                    id=3,
                    tenant_id=10,
                    email="inactive@example.com",
                    first_name="Ina",
                    last_name="Inactive",
                    role_id=1,
                    is_active=UserStatus.inactive,
                ),
                SalesContact(
                    contact_id=7,
                    tenant_id=10,
                    primary_email="lead@example.com",
                    assigned_to=1,
                ),
                SalesOrder(
                    id=8,
                    tenant_id=10,
                    order_number="SO-0008",
                    status="confirmed",
                    currency="USD",
                ),
                SupportCase(
                    id=9,
                    tenant_id=10,
                    case_number="CASE-0009",
                    subject="Delivery issue",
                    status="open",
                    priority="medium",
                ),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_list_mentionable_record_users_only_returns_users_with_view_access(self):
        users = list_mentionable_record_users(
            self.db,
            tenant_id=10,
            module_key="sales_contacts",
            entity_id=7,
            query="a",
        )

        self.assertEqual(users, [{"id": 1, "label": "Ava Admin", "email": "admin@example.com"}])

    def test_validate_record_mentions_rejects_users_without_view_access(self):
        with self.assertRaises(Exception) as context:
            validate_record_mentions(
                self.db,
                tenant_id=10,
                module_key="sales_contacts",
                entity_id=7,
                mentioned_user_ids=[2],
            )
        self.assertEqual(context.exception.detail, INVALID_MENTION_DETAIL)

    def test_validate_record_mentions_uses_generic_error_for_missing_or_inactive_users(self):
        for mentioned_user_ids in ([3], [999]):
            with self.subTest(mentioned_user_ids=mentioned_user_ids):
                with self.assertRaises(Exception) as context:
                    validate_record_mentions(
                        self.db,
                        tenant_id=10,
                        module_key="sales_contacts",
                        entity_id=7,
                        mentioned_user_ids=mentioned_user_ids,
                    )
                self.assertEqual(context.exception.detail, INVALID_MENTION_DETAIL)

    def test_create_record_mention_notifications_skips_actor(self):
        mentioned_users = validate_record_mentions(
            self.db,
            tenant_id=10,
            module_key="sales_contacts",
            entity_id=7,
            mentioned_user_ids=[1],
        )

        with patch("app.modules.platform.services.record_comments.create_notification") as create_mock:
            create_record_mention_notifications(
                self.db,
                tenant_id=10,
                actor_user_id=2,
                actor_name="Ben Blocked",
                module_key="sales_contacts",
                entity_id=7,
                record_label="lead@example.com",
                mentioned_users=mentioned_users,
                comment_id=55,
            )

        create_mock.assert_called_once()
        call_kwargs = create_mock.call_args.kwargs
        self.assertEqual(call_kwargs["user_id"], 1)
        self.assertEqual(call_kwargs["category"], "record_mention")
        self.assertEqual(call_kwargs["link_url"], "/dashboard/sales/contacts/7")
        self.assertEqual(call_kwargs["metadata"]["comment_id"], 55)

    def test_get_record_reference_supports_models_without_deleted_at(self):
        cases = [
            ("sales_orders", 8),
            ("support_cases", 9),
        ]

        for module_key, entity_id in cases:
            with self.subTest(module_key=module_key):
                record = get_record_reference(
                    self.db,
                    tenant_id=10,
                    module_key=module_key,
                    entity_id=entity_id,
                )

                self.assertEqual(record.id, entity_id)


if __name__ == "__main__":
    unittest.main()
