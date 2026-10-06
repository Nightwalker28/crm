"""Standard records the way the major players model them (13b Phase 3)."""

import importlib.util
import unittest
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.amounts import parse_amount
from app.core.database import Base
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.sales.models import SalesContact, SalesLead, SalesOrganization, SalesQuote
from app.modules.sales.services import contacts_services, leads_services, opportunities_services, pipelines_services
from app.modules.sales.services.document_fields import fill_addresses_from_account, format_address, normalize_document_fields
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus


class AmountParsingTests(unittest.TestCase):
    def test_free_text_amounts(self):
        self.assertEqual(parse_amount("150000"), Decimal("150000"))
        self.assertEqual(parse_amount("1,250.50"), Decimal("1250.50"))
        self.assertEqual(parse_amount("LKR 75M"), Decimal("75000000"))
        self.assertEqual(parse_amount("2.5k"), Decimal("2500"))
        self.assertIsNone(parse_amount("call me"))
        self.assertIsNone(parse_amount(""))

    def test_the_migration_parses_the_same_way(self):
        path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "20261010_standard_records.py"
        spec = importlib.util.spec_from_file_location("standard_records_migration", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for text in ("150000", "LKR 75M", "2.5k", "nope"):
            self.assertEqual(module.parse_amount(text), parse_amount(text))


class StandardRecordTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.db.add_all([
            Tenant(id=10, slug="t", name="T"),
            User(id=1, tenant_id=10, email="owner@example.com", first_name="Owner", is_active=UserStatus.active),
        ])
        self.db.commit()
        self.user = SimpleNamespace(id=1, tenant_id=10, team_id=None)

    def tearDown(self):
        self.db.close()

    def test_a_lead_needs_an_email_or_a_phone(self):
        with self.assertRaises(HTTPException) as caught:
            leads_services.create_sales_lead(self.db, {"first_name": "Nobody"}, self.user)
        self.assertEqual(caught.exception.detail[0]["loc"], ["body", "primary_email"])
        lead = leads_services.create_sales_lead(self.db, {"first_name": "Walk-in", "mobile_phone": "+94 77 000 0000"}, self.user)
        self.assertIsNone(lead.primary_email)

    def test_a_contact_needs_an_email_or_a_phone(self):
        with self.assertRaises(HTTPException):
            contacts_services.create_sales_contact(self.db, {"first_name": "Nobody"}, self.user)
        contact = contacts_services.create_sales_contact(self.db, {"first_name": "Caller", "contact_telephone": "123"}, self.user)
        self.assertIsNone(contact.primary_email)

    def test_a_deal_needs_an_account_or_a_contact_and_starts_in_base_currency(self):
        with self.assertRaises(HTTPException) as caught:
            opportunities_services.create_opportunity(self.db, {"opportunity_name": "Floating"}, current_user=self.user)
        self.assertEqual(caught.exception.detail[0]["msg"], "Choose an account or a contact.")
        self.db.add(SalesOrganization(org_id=5, tenant_id=10, org_name="Acme"))
        self.db.commit()
        deal = opportunities_services.create_opportunity(
            self.db, {"opportunity_name": "Acme rollout", "organization_id": 5, "amount": "12,500", "deal_type": "New business"},
            current_user=self.user,
        )
        self.assertEqual(deal.amount, Decimal("12500.00"))
        self.assertEqual(deal.deal_type, "new_business")
        self.assertTrue(deal.currency_type)
        self.assertIsNone(deal.probability_percent, "an empty probability follows the stage")
        self.assertIsNotNone(pipelines_services.opportunity_stage_facts(deal).probability)

    def test_moving_into_a_lost_stage_needs_a_reason_and_reopening_drops_it(self):
        self.db.add(SalesOrganization(org_id=5, tenant_id=10, org_name="Acme"))
        self.db.commit()
        deal = opportunities_services.create_opportunity(self.db, {"opportunity_name": "Acme", "organization_id": 5}, current_user=self.user)
        stages = pipelines_services.ensure_default_opportunity_pipeline(self.db, 10).stages
        lost_stage = next(stage for stage in stages if stage.semantic_type == "lost")
        open_stage = next(stage for stage in stages if stage.semantic_type not in {"won", "lost"})
        with self.assertRaises(HTTPException) as caught:
            opportunities_services.update_opportunity_stage(self.db, deal, pipeline_stage_id=lost_stage.id)
        self.assertEqual(caught.exception.detail[0]["loc"], ["body", "lost_reason"])
        self.db.rollback()
        lost = opportunities_services.update_opportunity_stage(self.db, deal, pipeline_stage_id=lost_stage.id, lost_reason="Price")
        self.assertEqual(lost.lost_reason, "price")
        self.assertTrue(pipelines_services.opportunity_stage_facts(lost).is_lost)
        reopened = opportunities_services.update_opportunity_stage(self.db, lost, pipeline_stage_id=open_stage.id)
        self.assertIsNone(reopened.lost_reason)

    def test_documents_copy_the_accounts_addresses_and_never_overwrite_typed_ones(self):
        self.db.add(SalesOrganization(org_id=5, tenant_id=10, org_name="Acme", billing_address="1 Main St", billing_city="Colombo",
                                      billing_country="LK"))
        self.db.commit()
        copied = fill_addresses_from_account(self.db, {"organization_id": 5}, tenant_id=10)
        self.assertEqual(copied["billing_address"], "1 Main St")
        self.assertEqual(copied["shipping_city"], "Colombo", "no shipping address on the account: ship where it bills")
        typed = fill_addresses_from_account(self.db, {"organization_id": 5, "shipping_address": "Dock 4"}, tenant_id=10)
        self.assertEqual(typed["shipping_address"], "Dock 4")
        self.assertIsNone(typed.get("shipping_city"))
        quote = SalesQuote(**{key: value for key, value in copied.items() if key.startswith("billing_")})
        self.assertEqual(format_address(quote, "billing"), "1 Main St\nColombo\nLK")

    def test_document_fields_check_charge_and_picklists(self):
        data = normalize_document_fields(self.db, {"shipping_charge": "12.5", "lost_reason": "Price", "customer_po_reference": "  PO-1 "},
                                         tenant_id=10, module_key="sales_quotes")
        self.assertEqual(data["shipping_charge"], Decimal("12.50"))
        self.assertEqual(data["lost_reason"], "price")
        self.assertEqual(data["customer_po_reference"], "PO-1")
        with self.assertRaises(HTTPException):
            normalize_document_fields(self.db, {"shipping_charge": "-1"}, tenant_id=10, module_key="sales_orders")

    def test_conversion_carries_mobile_source_and_amount(self):
        lead = SalesLead(tenant_id=10, first_name="Ada", mobile_phone="+94", source="referral", status="new")
        self.db.add(lead)
        self.db.commit()
        result = leads_services.convert_sales_lead(
            self.db, lead, {"create_account": True, "create_contact": True, "create_deal": True, "deal_amount": 900}, current_user=self.user,
        )
        self.db.commit()
        contact = self.db.get(SalesContact, result["contact_id"])
        self.assertEqual(contact.mobile_phone, "+94")
        from app.modules.sales.models import SalesOpportunity

        deal = self.db.get(SalesOpportunity, result["deal_id"])
        self.assertEqual(deal.amount, Decimal("900.00"))
        self.assertEqual(deal.source, "referral")


if __name__ == "__main__":
    unittest.main()
