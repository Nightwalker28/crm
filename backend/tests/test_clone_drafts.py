"""Clone drafts: what a new record copies from an existing one (13b Phase 5, F3.8)."""

import unittest
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.catalog import models as catalog_models  # noqa: F401
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.platform.models import FieldDefinition, FieldValue, ModuleFieldConfig
from app.modules.platform.services import clone_drafts
from app.modules.sales.models import SalesContact, SalesLead, SalesOrganization, SalesQuote, SalesQuoteItem
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus


class CloneDraftTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.db.add_all([
            Tenant(id=10, slug="t", name="T"),
            Tenant(id=99, slug="o", name="Other"),
            User(id=1, tenant_id=10, email="owner@example.com", first_name="Owner", is_active=UserStatus.active),
            SalesOrganization(org_id=20, tenant_id=10, org_name="Acme"),
            SalesContact(contact_id=30, tenant_id=10, first_name="Ada", last_name="Lovelace", primary_email="ada@acme.test", organization_id=20),
            SalesLead(
                lead_id=40, tenant_id=10, first_name="Grace", last_name="Hopper", company="Navy",
                primary_email="grace@navy.test", phone="555", source="web", status="qualified", notes="Met at a fair",
                next_follow_up_at=datetime(2026, 11, 1, tzinfo=timezone.utc),
            ),
            SalesLead(lead_id=41, tenant_id=99, first_name="Elsewhere", primary_email="x@other.test"),
            SalesQuote(
                quote_id=50, tenant_id=10, quote_number="Q-0001", title="Rollout", customer_name="Acme",
                organization_id=20, contact_id=30, status="accepted", issue_date=date(2026, 1, 1),
                expiry_date=date(2026, 2, 1), currency="USD", total_amount=Decimal("200"), billing_city="Colombo",
            ),
            SalesQuoteItem(
                id=60, tenant_id=10, quote_id=50, name="Licence", quantity=Decimal("2"), unit_price=Decimal("100"),
                line_total=Decimal("200"), sort_order=0,
            ),
        ])
        self.db.commit()
        self.user = SimpleNamespace(id=1, tenant_id=10, team_id=None, role_id=None)
        self.access = patch.object(clone_drafts, "require_access")
        self.require_access = self.access.start()

    def tearDown(self):
        self.access.stop()
        self.db.close()

    def _draft(self, module_key, record_id):
        return clone_drafts.build_clone_draft(self.db, module_key=module_key, record_id=record_id, current_user=self.user)

    def test_a_lead_clone_copies_the_record_but_not_its_identity_status_or_history(self):
        draft = self._draft("sales_leads", 40)
        fields = draft["fields"]
        self.assertEqual(fields["first_name"], "Grace")
        self.assertEqual(fields["company"], "Navy")
        self.assertEqual(fields["source"], "web")
        self.assertEqual(fields["notes"], "Met at a fair")
        for left_out in ("primary_email", "status", "next_follow_up_at", "lead_id", "score", "created_time"):
            self.assertNotIn(left_out, fields)
        self.assertEqual(draft["lines"], [])
        # View the source, create the copy: both are asked for.
        args = self.require_access.call_args
        self.assertEqual(args.args[2:], ("sales_leads", "view", "create"))

    def test_a_disabled_or_read_only_field_is_left_out(self):
        self.db.add_all([
            # `is_protected` has only a server default, which SQLite reads as true: set it.
            ModuleFieldConfig(id=1, tenant_id=10, module_key="sales_leads", field_key="company", label="Company", is_enabled=False, is_protected=False),
            ModuleFieldConfig(id=2, tenant_id=10, module_key="sales_leads", field_key="notes", label="Notes", is_enabled=True, is_readonly=True, is_protected=False),
        ])
        self.db.commit()
        fields = self._draft("sales_leads", 40)["fields"]
        self.assertNotIn("company", fields)
        self.assertNotIn("notes", fields)
        self.assertEqual(fields["first_name"], "Grace")

    def test_another_tenants_record_is_not_found(self):
        with self.assertRaises(HTTPException) as caught:
            self._draft("sales_leads", 41)
        self.assertEqual(caught.exception.status_code, 404)

    def test_a_quote_clone_keeps_the_customer_and_lines_but_not_number_status_dates_or_totals(self):
        draft = self._draft("sales_quotes", 50)
        fields = draft["fields"]
        self.assertEqual(fields["organization_id"], 20)
        self.assertEqual(fields["organization_name"], "Acme")
        self.assertEqual(fields["contact_name"], "Ada Lovelace")
        self.assertEqual(fields["billing_city"], "Colombo")
        for left_out in ("quote_number", "status", "issue_date", "expiry_date", "total_amount", "subtotal_amount"):
            self.assertNotIn(left_out, fields)
        self.assertEqual(len(draft["lines"]), 1)
        line = draft["lines"][0]
        self.assertEqual(line["name"], "Licence")
        self.assertNotIn("id", line)
        self.assertNotIn("line_total", line)

    def test_unique_file_and_auto_number_custom_fields_are_not_copied(self):
        definitions = [
            SimpleNamespace(field_key="budget", field_type="currency", is_unique=False),
            SimpleNamespace(field_key="tax_id", field_type="text", is_unique=True),
            SimpleNamespace(field_key="contract", field_type="file", is_unique=False),
            SimpleNamespace(field_key="ref", field_type="auto_number", is_unique=False),
            SimpleNamespace(field_key="empty", field_type="text", is_unique=False),
        ]
        values = {"budget": 100, "tax_id": "X1", "contract": 7, "ref": "REF-1", "empty": ""}
        self.assertEqual(clone_drafts._copyable_custom_values(definitions, values), {"budget": 100})

    def test_a_custom_field_value_travels_with_the_clone(self):
        self.db.add(FieldDefinition(id=1, tenant_id=10, module_key="sales_leads", field_key="budget", label="Budget", field_type="number"))
        self.db.add(FieldValue(id=1, tenant_id=10, module_key="sales_leads", record_id=40, field_definition_id=1, value_number=Decimal("12")))
        self.db.commit()
        draft = self._draft("sales_leads", 40)
        self.assertEqual(Decimal(str(draft["custom_fields"]["budget"])), Decimal("12"))

    def test_a_module_without_a_clone_is_not_found(self):
        with self.assertRaises(HTTPException) as caught:
            self._draft("inventory_deliveries", 1)
        self.assertEqual(caught.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
