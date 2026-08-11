"""Domain guarantees the Lead Quick Create surface depends on.

Quick Create posts a shorter payload to the same `POST /sales/leads` service as the full form,
so these tests pin the rules that a shorter payload must not be able to weaken: tenant-scoped
owner and team links, required email, duplicate reporting, and the defaults the full form
relies on.
"""

import unittest
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.sales.models import SalesLead
from app.modules.sales.services.leads_services import create_sales_lead
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Team, Tenant, User, UserStatus


# The fields the seeded quick_create layout exposes. Everything else is left to domain defaults.
def quick_create_payload(**overrides):
    payload = {
        "first_name": "Ada",
        "last_name": "Lovelace",
        "company": "Analytical Engines",
        "primary_email": "ada@example.com",
        "phone": "555-0100",
        "status": "new",
        "assigned_to": None,
        "team_id": None,
        "tags": [],
        "custom_fields": {},
    }
    payload.update(overrides)
    return payload


class LeadQuickCreateTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default"),
                Tenant(id=99, slug="other", name="Other"),
                Team(id=10, tenant_id=10, name="Revenue"),
                Team(id=99, tenant_id=99, name="Other Revenue"),
                User(
                    id=1,
                    tenant_id=10,
                    team_id=10,
                    email="owner@example.com",
                    first_name="Owner",
                    last_name="User",
                    is_active=UserStatus.active,
                ),
                User(
                    id=2,
                    tenant_id=99,
                    team_id=99,
                    email="intruder@example.com",
                    first_name="Other",
                    last_name="Tenant",
                    is_active=UserStatus.active,
                ),
            ]
        )
        self.db.commit()
        self.current_user = SimpleNamespace(id=1, tenant_id=10, team_id=10)

    def tearDown(self):
        self.db.close()

    def test_short_quick_create_payload_gets_the_same_domain_defaults_as_full_create(self):
        lead = create_sales_lead(self.db, quick_create_payload(), self.current_user)

        self.assertEqual(lead.tenant_id, 10)
        # Omitted owner and team fall back to the acting user, exactly as the full form does.
        self.assertEqual(lead.assigned_to, 1)
        self.assertEqual(lead.team_id, 10)
        self.assertEqual(lead.status, "new")
        self.assertIsNotNone(lead.score)

    def test_quick_create_rejects_a_cross_tenant_owner(self):
        with self.assertRaises(HTTPException) as exc:
            create_sales_lead(self.db, quick_create_payload(assigned_to=2), self.current_user)

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Assigned user not found")
        self.assertEqual(self.db.query(SalesLead).count(), 0)

    def test_quick_create_rejects_a_cross_tenant_team(self):
        with self.assertRaises(HTTPException) as exc:
            create_sales_lead(self.db, quick_create_payload(team_id=99), self.current_user)

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Team not found")
        self.assertEqual(self.db.query(SalesLead).count(), 0)

    def test_quick_create_cannot_claim_another_tenants_lead_by_reusing_its_email(self):
        create_sales_lead(self.db, quick_create_payload(), self.current_user)
        intruder = SimpleNamespace(id=2, tenant_id=99, team_id=99)

        created = create_sales_lead(self.db, quick_create_payload(), intruder)

        # The duplicate check is tenant-scoped, so the other tenant gets its own record rather
        # than a conflict with — or a write into — tenant 10's lead.
        self.assertEqual(created.tenant_id, 99)
        self.assertEqual(self.db.query(SalesLead).filter(SalesLead.tenant_id == 10).count(), 1)
        self.assertEqual(self.db.query(SalesLead).filter(SalesLead.tenant_id == 99).count(), 1)

    def test_quick_create_requires_primary_email(self):
        with self.assertRaises(HTTPException) as exc:
            create_sales_lead(self.db, quick_create_payload(primary_email=None), self.current_user)

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "primary_email is required")

    def test_quick_create_reports_a_duplicate_email_as_a_recoverable_conflict(self):
        create_sales_lead(self.db, quick_create_payload(), self.current_user)

        with self.assertRaises(HTTPException) as exc:
            create_sales_lead(self.db, quick_create_payload(first_name="Second"), self.current_user)

        # The surface shows this detail verbatim, so it has to name the address and the options.
        self.assertEqual(exc.exception.status_code, 409)
        self.assertIn("ada@example.com", exc.exception.detail)
        self.assertEqual(self.db.query(SalesLead).count(), 1)

    def test_quick_create_rejects_an_unknown_status(self):
        with self.assertRaises(HTTPException) as exc:
            create_sales_lead(self.db, quick_create_payload(status="won"), self.current_user)

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(self.db.query(SalesLead).count(), 0)


if __name__ == "__main__":
    unittest.main()
