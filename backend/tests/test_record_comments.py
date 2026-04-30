import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.platform.services.record_comments import (
    create_record_mention_notifications,
    list_mentionable_record_users,
    validate_record_mentions,
)
from app.modules.sales.models import SalesContact
from app.modules.user_management.models import Module, Role, User, UserStatus
from app.modules.user_management import models as user_management_models  # noqa: F401


class RecordCommentMentionTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.db.add_all(
            [
                Module(id=1, name="sales_contacts", base_route="sales_contacts", is_enabled=1),
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
        with self.assertRaisesRegex(Exception, "cannot view this record"):
            validate_record_mentions(
                self.db,
                tenant_id=10,
                module_key="sales_contacts",
                entity_id=7,
                mentioned_user_ids=[2],
            )

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


if __name__ == "__main__":
    unittest.main()
