import unittest
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.sales.models import SalesContact, SalesOpportunity, SalesOrder, SalesOrganization, SalesQuote
from app.modules.support.models import SupportCase
from app.modules.support.services.cases_services import add_case_comment, create_support_case, get_case_or_404, update_support_case
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus


class SupportCaseTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.user = SimpleNamespace(id=1, tenant_id=10)
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default"),
                Tenant(id=99, slug="other", name="Other"),
                User(id=1, tenant_id=10, email="owner@example.com", first_name="Owner", last_name="User", is_active=UserStatus.active),
                User(id=2, tenant_id=10, email="agent@example.com", first_name="Agent", last_name="User", is_active=UserStatus.active),
                User(id=3, tenant_id=99, email="other@example.com", first_name="Other", last_name="User", is_active=UserStatus.active),
                SalesOrganization(org_id=20, tenant_id=10, org_name="Acme", primary_email="hello@acme.test"),
                SalesOrganization(org_id=99, tenant_id=99, org_name="Other", primary_email="hello@other.test"),
                SalesContact(contact_id=30, tenant_id=10, first_name="Ada", primary_email="ada@acme.test", assigned_to=1, organization_id=20),
                SalesOpportunity(opportunity_id=40, tenant_id=10, opportunity_name="Acme Pilot", client="Ada", contact_id=30, organization_id=20),
                SalesQuote(quote_id=50, tenant_id=10, quote_number="Q-500", customer_name="Acme", status="accepted", currency="USD"),
                SalesOrder(id=60, tenant_id=10, order_number="SO-60", status="confirmed", currency="USD"),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_create_case_links_customer_records_and_events(self):
        item = create_support_case(
            self.db,
            {
                "subject": "Customer needs help",
                "description": "Cannot access order",
                "priority": "high",
                "contact_id": 30,
                "organization_id": 20,
                "opportunity_id": 40,
                "quote_id": 50,
                "order_id": 60,
                "assigned_to_id": 2,
            },
            self.user,
        )

        self.assertEqual(item.tenant_id, 10)
        self.assertTrue(item.case_number.startswith("CASE-"))
        self.assertEqual(item.status, "new")
        self.assertEqual(item.priority, "high")
        self.assertEqual(item.contact_id, 30)
        self.assertEqual(len(item.events), 1)
        self.assertEqual(item.events[0].event_type, "created")

    def test_create_case_rejects_cross_tenant_link(self):
        with self.assertRaises(HTTPException) as exc:
            create_support_case(
                self.db,
                {"subject": "Bad link", "organization_id": 99},
                self.user,
            )

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Organization not found")

    def test_update_status_sets_resolution_timestamps(self):
        item = create_support_case(self.db, {"subject": "Resolve me"}, self.user)

        updated = update_support_case(self.db, item, {"status": "resolved"}, self.user)

        self.assertEqual(updated.status, "resolved")
        self.assertIsNotNone(updated.resolved_at)
        self.assertEqual(updated.events[-1].event_type, "status_changed")

    def test_comment_sets_first_response_once(self):
        item = create_support_case(self.db, {"subject": "Needs response"}, self.user)

        comment = add_case_comment(self.db, item, {"body": "We are checking this."}, self.user)
        reloaded = get_case_or_404(self.db, tenant_id=10, case_id=item.id)

        self.assertEqual(comment.body, "We are checking this.")
        self.assertIsNotNone(reloaded.first_response_at)
        self.assertEqual(len(reloaded.comments), 1)

    def test_get_case_scopes_by_tenant(self):
        item = create_support_case(self.db, {"subject": "Tenant scoped"}, self.user)

        with self.assertRaises(HTTPException) as exc:
            get_case_or_404(self.db, tenant_id=99, case_id=item.id)

        self.assertEqual(exc.exception.status_code, 404)
        self.assertEqual(self.db.query(SupportCase).filter(SupportCase.tenant_id == 10).count(), 1)


if __name__ == "__main__":
    unittest.main()
