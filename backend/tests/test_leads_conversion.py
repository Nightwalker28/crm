import unittest
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.sales.models import SalesContact, SalesLead, SalesOpportunity, SalesOrganization
from app.modules.sales.services.leads_services import convert_sales_lead
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus


class LeadConversionTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default"),
                Tenant(id=99, slug="other", name="Other"),
                User(
                    id=1,
                    tenant_id=10,
                    email="owner@example.com",
                    first_name="Owner",
                    last_name="User",
                    is_active=UserStatus.active,
                ),
                User(
                    id=2,
                    tenant_id=99,
                    email="other@example.com",
                    first_name="Other",
                    last_name="User",
                    is_active=UserStatus.active,
                ),
            ]
        )
        self.db.commit()
        self.current_user = SimpleNamespace(id=1, tenant_id=10)

    def tearDown(self):
        self.db.close()

    def test_convert_lead_reuses_existing_account_and_contact_by_company_and_email(self):
        lead = SalesLead(
            lead_id=100,
            tenant_id=10,
            first_name="Ada",
            last_name="Lovelace",
            company="Analytical Engines",
            primary_email="ada@example.com",
            phone="555-0100",
            title="Founder",
            status="qualified",
            assigned_to=1,
        )
        organization = SalesOrganization(
            org_id=200,
            tenant_id=10,
            org_name="Analytical Engines",
            primary_email="hello@example.com",
            assigned_to=1,
        )
        contact = SalesContact(
            contact_id=300,
            tenant_id=10,
            first_name="Ada",
            last_name="Byron",
            primary_email="ada@example.com",
            assigned_to=1,
        )
        self.db.add_all([lead, organization, contact])
        self.db.commit()

        result = convert_sales_lead(
            self.db,
            lead,
            {"create_account": True, "create_contact": True, "create_deal": False},
            current_user=self.current_user,
        )

        self.assertEqual(result["account_id"], organization.org_id)
        self.assertEqual(result["contact_id"], contact.contact_id)
        self.assertFalse(result["created_account"])
        self.assertFalse(result["created_contact"])
        self.assertFalse(result["created_deal"])
        self.assertEqual(result["lead"].status, "converted")
        self.assertEqual(self.db.query(SalesOrganization).filter(SalesOrganization.tenant_id == 10).count(), 1)
        self.assertEqual(self.db.query(SalesContact).filter(SalesContact.tenant_id == 10).count(), 1)
        self.assertEqual(self.db.query(SalesOpportunity).count(), 0)

    def test_convert_lead_rejects_cross_tenant_linked_contact(self):
        lead = SalesLead(lead_id=101, tenant_id=10, first_name="Ada", primary_email="ada@example.com", status="new", assigned_to=1)
        other_contact = SalesContact(contact_id=301, tenant_id=99, first_name="Other", primary_email="other@example.com", assigned_to=2)
        self.db.add_all([lead, other_contact])
        self.db.commit()

        with self.assertRaises(HTTPException) as exc:
            convert_sales_lead(
                self.db,
                lead,
                {"create_account": False, "create_contact": False, "contact_id": other_contact.contact_id},
                current_user=self.current_user,
            )

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Contact not found")

    def test_convert_lead_rejects_already_converted_lead(self):
        lead = SalesLead(lead_id=102, tenant_id=10, first_name="Ada", primary_email="ada@example.com", status="converted", assigned_to=1)
        self.db.add(lead)
        self.db.commit()

        with self.assertRaises(HTTPException) as exc:
            convert_sales_lead(self.db, lead, {"create_account": True, "create_contact": True}, current_user=self.current_user)

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Lead is already converted")

    def test_convert_lead_rejects_invalid_deal_stage_before_creating_records(self):
        lead = SalesLead(
            lead_id=103,
            tenant_id=10,
            first_name="Ada",
            last_name="Lovelace",
            company="Analytical Engines",
            primary_email="ada-stage@example.com",
            status="qualified",
            assigned_to=1,
        )
        self.db.add(lead)
        self.db.commit()

        with self.assertRaises(HTTPException) as exc:
            convert_sales_lead(
                self.db,
                lead,
                {
                    "create_account": True,
                    "create_contact": True,
                    "create_deal": True,
                    "deal_stage": "not-a-stage",
                },
                current_user=self.current_user,
            )

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Invalid deal stage")
        self.assertEqual(self.db.query(SalesOrganization).filter(SalesOrganization.tenant_id == 10).count(), 0)
        self.assertEqual(self.db.query(SalesContact).filter(SalesContact.tenant_id == 10).count(), 0)
        self.assertEqual(self.db.query(SalesOpportunity).filter(SalesOpportunity.tenant_id == 10).count(), 0)
        self.assertEqual(self.db.get(SalesLead, lead.lead_id).status, "qualified")


if __name__ == "__main__":
    unittest.main()
