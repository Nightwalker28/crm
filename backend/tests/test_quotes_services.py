import unittest
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.pagination import create_pagination
from app.modules.catalog import models as catalog_models  # noqa: F401
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.sales.models import SalesContact, SalesOpportunity, SalesOrganization, SalesQuote
from app.modules.sales.services import quotes_services
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus


class QuoteOpportunityLinkTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default"),
                Tenant(id=99, slug="other", name="Other"),
                User(id=1, tenant_id=10, email="owner@example.com", first_name="Owner", last_name="User", is_active=UserStatus.active),
                User(id=2, tenant_id=99, email="other@example.com", first_name="Other", last_name="User", is_active=UserStatus.active),
                SalesOrganization(org_id=20, tenant_id=10, org_name="Acme", primary_email="hello@acme.test"),
                SalesContact(contact_id=30, tenant_id=10, first_name="Ada", primary_email="ada@acme.test", assigned_to=1, organization_id=20),
                SalesOpportunity(
                    opportunity_id=40,
                    tenant_id=10,
                    opportunity_name="Acme Pilot",
                    client="Ada",
                    contact_id=30,
                    organization_id=20,
                    sales_stage="proposal",
                ),
                SalesOpportunity(
                    opportunity_id=41,
                    tenant_id=99,
                    opportunity_name="Other Pilot",
                    client="Other",
                    contact_id=None,
                    organization_id=None,
                    sales_stage="proposal",
                ),
            ]
        )
        self.db.commit()
        self.current_user = SimpleNamespace(id=1, tenant_id=10)

    def tearDown(self):
        self.db.close()

    def test_create_quote_inherits_contact_and_account_from_opportunity(self):
        with patch.object(quotes_services, "validate_custom_field_payload", return_value={}), \
             patch.object(quotes_services, "save_custom_field_values"), \
             patch.object(quotes_services, "hydrate_custom_field_record", side_effect=lambda *args, **kwargs: kwargs["record"]):
            quote = quotes_services.create_sales_quote(
                self.db,
                {
                    "quote_id": 60,
                    "quote_number": "Q-100",
                    "customer_name": "Acme",
                    "opportunity_id": 40,
                    "currency": "USD",
                    "total_amount": Decimal("2500.00"),
                },
                self.current_user,
            )

        self.assertEqual(quote.opportunity_id, 40)
        self.assertEqual(quote.contact_id, 30)
        self.assertEqual(quote.organization_id, 20)

    def test_create_quote_rejects_cross_tenant_opportunity(self):
        with patch.object(quotes_services, "validate_custom_field_payload", return_value={}):
            with self.assertRaises(HTTPException) as exc:
                quotes_services.create_sales_quote(
                    self.db,
                    {
                        "quote_number": "Q-101",
                        "customer_name": "Acme",
                        "opportunity_id": 41,
                    },
                    self.current_user,
                )

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Opportunity not found")

    def test_update_quote_rejects_mismatched_opportunity_contact(self):
        quote = SalesQuote(
            quote_id=50,
            tenant_id=10,
            quote_number="Q-102",
            customer_name="Acme",
            contact_id=30,
            organization_id=20,
            status="draft",
            currency="USD",
            total_amount=Decimal("100.00"),
        )
        other_contact = SalesContact(contact_id=31, tenant_id=10, first_name="Grace", primary_email="grace@acme.test", assigned_to=1, organization_id=20)
        self.db.add_all([quote, other_contact])
        self.db.commit()

        with patch.object(quotes_services, "hydrate_custom_field_record", side_effect=lambda *args, **kwargs: kwargs["record"]):
            with self.assertRaises(HTTPException) as exc:
                quotes_services.update_sales_quote(self.db, quote, {"opportunity_id": 40, "contact_id": 31})

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Quote contact must match the linked opportunity")

    def test_quote_list_sorts_before_pagination(self):
        self.db.add_all(
            [
                SalesQuote(
                    quote_id=61,
                    tenant_id=10,
                    quote_number="Q-103",
                    customer_name="Zeta",
                    status="draft",
                    currency="USD",
                    total_amount=Decimal("300.00"),
                    assigned_to=1,
                ),
                SalesQuote(
                    quote_id=62,
                    tenant_id=10,
                    quote_number="Q-101",
                    customer_name="Ada",
                    status="draft",
                    currency="USD",
                    total_amount=Decimal("100.00"),
                    assigned_to=1,
                ),
                SalesQuote(
                    quote_id=63,
                    tenant_id=10,
                    quote_number="Q-102",
                    customer_name="Mia",
                    status="draft",
                    currency="USD",
                    total_amount=Decimal("200.00"),
                    assigned_to=1,
                ),
            ]
        )
        self.db.commit()

        quotes, total_count = quotes_services.list_sales_quotes(
            self.db,
            tenant_id=10,
            pagination=create_pagination(1, 2),
            sort_by="quote_number",
            sort_direction="asc",
        )

        self.assertEqual(total_count, 3)
        self.assertEqual([quote.quote_number for quote in quotes], ["Q-101", "Q-102"])


if __name__ == "__main__":
    unittest.main()
