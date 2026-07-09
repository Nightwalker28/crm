import unittest
from decimal import Decimal
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.catalog import models as catalog_models  # noqa: F401
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.finance.models import FinanceIO
from app.modules.sales.models import SalesContact, SalesOpportunity, SalesOrganization, SalesQuote
from app.modules.sales.services import summary_services
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant


class EmptyQuery:
    def filter(self, *conditions):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def limit(self, _value):
        return self

    def first(self):
        return None

    def all(self):
        return []


class EmptyDB:
    def query(self, *_entities):
        return EmptyQuery()


class SummaryHydrationTests(unittest.TestCase):
    def test_contact_summary_does_not_rehydrate_primary_contact(self):
        contact = SimpleNamespace(
            tenant_id=3,
            contact_id=11,
            organization_id=None,
        )

        with patch.object(summary_services, "hydrate_custom_field_record") as hydrate_one, \
             patch.object(summary_services, "hydrate_custom_field_records", side_effect=lambda *args, **kwargs: kwargs["records"]):
            summary = summary_services.build_contact_summary(EmptyDB(), contact)

        self.assertIs(summary["contact"], contact)
        hydrate_one.assert_not_called()

    def test_organization_summary_does_not_rehydrate_primary_organization(self):
        organization = SimpleNamespace(
            tenant_id=3,
            org_id=22,
            org_name="Acme",
        )

        with patch.object(summary_services, "hydrate_custom_field_record") as hydrate_one, \
             patch.object(summary_services, "hydrate_custom_field_records", side_effect=lambda *args, **kwargs: kwargs["records"]):
            summary = summary_services.build_organization_summary(EmptyDB(), organization)

        self.assertIs(summary["organization"], organization)
        hydrate_one.assert_not_called()

    def test_opportunity_summary_does_not_rehydrate_primary_opportunity(self):
        opportunity = SimpleNamespace(
            tenant_id=3,
            opportunity_id=33,
            contact_id=None,
            organization_id=None,
            campaign_type=None,
            delivery_format=None,
            tactics=None,
            target_audience=None,
        )

        with patch.object(summary_services, "hydrate_custom_field_record") as hydrate_one:
            summary = summary_services.build_opportunity_summary(EmptyDB(), opportunity)

        self.assertIs(summary["opportunity"], opportunity)
        hydrate_one.assert_not_called()


class SummaryRelatedQuoteTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default"),
                Tenant(id=99, slug="other", name="Other"),
                SalesOrganization(org_id=20, tenant_id=10, org_name="Acme", primary_email="hello@acme.test"),
                SalesContact(contact_id=30, tenant_id=10, first_name="Ada", primary_email="ada@acme.test", assigned_to=1, organization_id=20),
                SalesOpportunity(opportunity_id=35, tenant_id=10, opportunity_name="Acme Pilot", client="Ada", contact_id=30, organization_id=20, sales_stage="proposal"),
                SalesQuote(
                    quote_id=40,
                    tenant_id=10,
                    quote_number="Q-40",
                    customer_name="Acme",
                    contact_id=30,
                    organization_id=20,
                    opportunity_id=35,
                    status="sent",
                    currency="USD",
                    total_amount=Decimal("1200.00"),
                ),
                SalesQuote(
                    quote_id=41,
                    tenant_id=99,
                    quote_number="Q-41",
                    customer_name="Other",
                    contact_id=30,
                    organization_id=20,
                    status="sent",
                    currency="USD",
                    total_amount=Decimal("900.00"),
                ),
                SalesQuote(
                    quote_id=42,
                    tenant_id=10,
                    quote_number="Q-42",
                    customer_name="Deleted",
                    contact_id=30,
                    organization_id=20,
                    status="sent",
                    currency="USD",
                    total_amount=Decimal("500.00"),
                    deleted_at=datetime(2026, 1, 1),
                ),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_contact_summary_returns_active_tenant_quotes(self):
        contact = self.db.query(SalesContact).filter(SalesContact.contact_id == 30).one()

        summary = summary_services.build_contact_summary(self.db, contact)

        self.assertEqual([quote.quote_id for quote in summary["related_quotes"]], [40])
        self.assertEqual(summary["quote_count"], 1)

    def test_organization_summary_returns_active_tenant_quotes(self):
        organization = self.db.query(SalesOrganization).filter(SalesOrganization.org_id == 20).one()

        summary = summary_services.build_organization_summary(self.db, organization)

        self.assertEqual([quote.quote_id for quote in summary["related_quotes"]], [40])
        self.assertEqual(summary["quote_count"], 1)

    def test_opportunity_summary_returns_explicitly_linked_quotes(self):
        opportunity = self.db.query(SalesOpportunity).filter(SalesOpportunity.opportunity_id == 35).one()

        summary = summary_services.build_opportunity_summary(self.db, opportunity)

        self.assertEqual([quote.quote_id for quote in summary["related_quotes"]], [40])


class SummaryRelatedInsertionOrderTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default"),
                Tenant(id=99, slug="other", name="Other"),
                FinanceIO(
                    id=1,
                    tenant_id=10,
                    module_id=1,
                    io_number="IO-CONTACT",
                    file_name="contact.pdf",
                    customer_contact_id=30,
                    customer_name="Contact Match",
                    status="draft",
                    currency="USD",
                    updated_at=datetime(2026, 1, 4),
                ),
                FinanceIO(
                    id=2,
                    tenant_id=10,
                    module_id=1,
                    io_number="IO-ORG",
                    file_name="org.pdf",
                    customer_organization_id=20,
                    customer_name="Org Match",
                    status="draft",
                    currency="USD",
                    updated_at=datetime(2026, 1, 3),
                ),
                FinanceIO(
                    id=3,
                    tenant_id=10,
                    module_id=1,
                    io_number="IO-NAME",
                    file_name="name.pdf",
                    customer_name="Acme",
                    status="draft",
                    currency="USD",
                    updated_at=datetime(2026, 1, 2),
                ),
                FinanceIO(
                    id=4,
                    tenant_id=99,
                    module_id=1,
                    io_number="IO-OTHER-TENANT",
                    file_name="other.pdf",
                    customer_contact_id=30,
                    customer_organization_id=20,
                    customer_name="Acme",
                    status="draft",
                    currency="USD",
                    updated_at=datetime(2026, 1, 5),
                ),
                FinanceIO(
                    id=5,
                    tenant_id=10,
                    module_id=1,
                    io_number="IO-DELETED",
                    file_name="deleted.pdf",
                    customer_contact_id=30,
                    customer_name="Acme",
                    status="draft",
                    currency="USD",
                    deleted_at=datetime(2026, 1, 1),
                    updated_at=datetime(2026, 1, 6),
                ),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_related_insertion_orders_match_by_contact_only(self):
        records = summary_services._get_related_insertion_orders(
            self.db,
            tenant_id=10,
            organization_name=None,
            contact_id=30,
        )

        self.assertEqual([record.io_number for record in records], ["IO-CONTACT"])

    def test_related_insertion_orders_match_by_organization_only(self):
        records = summary_services._get_related_insertion_orders(
            self.db,
            tenant_id=10,
            organization_name=None,
            organization_id=20,
        )

        self.assertEqual([record.io_number for record in records], ["IO-ORG"])

    def test_related_insertion_orders_match_by_normalized_name_only(self):
        records = summary_services._get_related_insertion_orders(
            self.db,
            tenant_id=10,
            organization_name=" acme ",
        )

        self.assertEqual([record.io_number for record in records], ["IO-NAME"])

    def test_related_insertion_orders_combine_contact_org_and_name_conditions(self):
        records = summary_services._get_related_insertion_orders(
            self.db,
            tenant_id=10,
            organization_name="ACME",
            organization_id=20,
            contact_id=30,
        )

        self.assertEqual([record.io_number for record in records], ["IO-CONTACT", "IO-ORG", "IO-NAME"])


if __name__ == "__main__":
    unittest.main()
