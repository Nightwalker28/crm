"""Relationship summaries (05-relationships-data-model, Phase 4).

The Contact, Account and Deal summaries feed the record workspace's relationship
context. Each related section is shown only to a reader who may view that module,
hidden sections say so instead of looking empty, counts are true totals rather than
the length of a capped list, and a contact's deals include the ones it is a
participant on, with its role there.
"""

import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core import permissions as permissions_module
from app.core.database import Base, get_db
from app.core.security import require_user
from app.main import app
from app.modules.catalog import models as catalog_models  # noqa: F401
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.finance.models import FinanceIO, FinancePosInvoice
from app.modules.sales.models import (
    SalesContact,
    SalesOpportunity,
    SalesOpportunityContact,
    SalesOrder,
    SalesOrganization,
    SalesQuote,
)
from app.modules.sales.schema import ContactSummaryResponse, OpportunitySummaryResponse, OrganizationSummaryResponse
from app.modules.sales.services import summary_services
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus

TENANT = 10
OTHER_TENANT = 99
ACME = 20
ADA = 30  # primary on the Pilot deal
GRACE = 31  # participant on the Pilot deal
PILOT = 40
EXPANSION = 41  # Grace's own deal, as primary
RENEWAL = 42  # Grace was removed from it
ARCHIVED = 43  # soft-deleted deal Grace is on
RIVAL_DEAL = 90  # another tenant's deal

EVERYTHING = {
    "sales_contacts",
    "sales_opportunities",
    "sales_quotes",
    "sales_orders",
    "finance_pos",
    "finance_io",
}


def policy_for(viewable):
    """A stand-in policy that grants `view` on exactly the given modules."""

    class Policy:
        def __init__(self, db=None, user=None):
            pass

        def can_view_module(self, module_key):
            return module_key in viewable

        def can_perform_action(self, module_key, action):
            return module_key in viewable and action == "view"

        def require_module(self, module_key):
            if module_key not in viewable:
                raise PermissionError("module not available")

        def require_action(self, module_key, action):
            if not self.can_perform_action(module_key, action):
                raise PermissionError("action not permitted")

    return Policy


class SummaryFixture(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        now = datetime(2026, 9, 1, tzinfo=timezone.utc)
        deleted = now - timedelta(days=1)

        def deal(opportunity_id, name, contact_id, *, tenant_id=TENANT, organization_id=ACME, **kwargs):
            return SalesOpportunity(
                opportunity_id=opportunity_id,
                tenant_id=tenant_id,
                opportunity_name=name,
                client=name,
                contact_id=contact_id,
                organization_id=organization_id,
                **kwargs,
            )

        self.db.add_all(
            [
                Tenant(id=TENANT, slug="default", name="Default"),
                Tenant(id=OTHER_TENANT, slug="rival", name="Rival"),
                User(id=1, tenant_id=TENANT, email="ava@example.com", first_name="Ava", is_active=UserStatus.active),
                SalesOrganization(org_id=ACME, tenant_id=TENANT, org_name="Acme", primary_email="hello@acme.example"),
                SalesOrganization(org_id=21, tenant_id=OTHER_TENANT, org_name="Rival Co", primary_email="hello@rival.example"),
                SalesContact(contact_id=ADA, tenant_id=TENANT, first_name="Ada", primary_email="ada@acme.example", organization_id=ACME),
                SalesContact(contact_id=GRACE, tenant_id=TENANT, first_name="Grace", primary_email="grace@acme.example", organization_id=ACME),
                SalesContact(contact_id=60, tenant_id=OTHER_TENANT, first_name="Rival", primary_email="rival@other.example", organization_id=21),
                deal(PILOT, "Acme Pilot", ADA),
                deal(EXPANSION, "Acme Expansion", GRACE),
                deal(RENEWAL, "Acme Renewal", ADA),
                deal(ARCHIVED, "Acme Archived", ADA, deleted_at=deleted),
                deal(RIVAL_DEAL, "Rival deal", 60, tenant_id=OTHER_TENANT, organization_id=21),
                SalesQuote(quote_id=70, tenant_id=TENANT, quote_number="Q-70", customer_name="Acme", contact_id=GRACE, organization_id=ACME, opportunity_id=PILOT, status="sent", currency="USD", total_amount=Decimal("100")),
                SalesQuote(quote_id=71, tenant_id=OTHER_TENANT, quote_number="Q-71", customer_name="Rival", contact_id=GRACE, organization_id=ACME, status="sent", currency="USD", total_amount=Decimal("100")),
                SalesOrder(id=80, tenant_id=TENANT, order_number="SO-80", organization_id=ACME, contact_id=GRACE, status="confirmed", currency="USD", grand_total=Decimal("100")),
                SalesOrder(id=81, tenant_id=TENANT, order_number="SO-81", organization_id=None, contact_id=GRACE, status="confirmed", currency="USD", grand_total=Decimal("50")),
                SalesOrder(id=82, tenant_id=OTHER_TENANT, order_number="SO-82", organization_id=ACME, contact_id=GRACE, status="confirmed", currency="USD", grand_total=Decimal("100")),
                FinancePosInvoice(id=85, tenant_id=TENANT, invoice_number="INV-85", customer_name="Acme", customer_organization_id=ACME, status="issued", payment_status="unpaid", currency="USD", total_amount=Decimal("100")),
                FinanceIO(id=88, tenant_id=TENANT, module_id=1, io_number="IO-88", file_name="io.pdf", customer_contact_id=GRACE, customer_name="Acme", status="draft", currency="USD", updated_at=now),
            ]
        )
        self.db.flush()
        self.db.add_all(
            [
                SalesOpportunityContact(tenant_id=TENANT, opportunity_id=PILOT, contact_id=ADA, role_key="decision_maker", is_primary=True),
                SalesOpportunityContact(tenant_id=TENANT, opportunity_id=PILOT, contact_id=GRACE, role_key="champion"),
                SalesOpportunityContact(tenant_id=TENANT, opportunity_id=EXPANSION, contact_id=GRACE, role_key="finance", is_primary=True),
                SalesOpportunityContact(tenant_id=TENANT, opportunity_id=RENEWAL, contact_id=GRACE, role_key="legal", deleted_at=deleted),
                SalesOpportunityContact(tenant_id=TENANT, opportunity_id=ARCHIVED, contact_id=GRACE, role_key="technical"),
                # Corrupt: a tenant-10 row pointing at another tenant's deal.
                SalesOpportunityContact(tenant_id=TENANT, opportunity_id=RIVAL_DEAL, contact_id=GRACE, role_key="other"),
            ]
        )
        self.db.commit()
        self.current_user = SimpleNamespace(id=1, tenant_id=TENANT)

    def tearDown(self):
        self.db.close()

    def with_policy(self, viewable, build):
        original = summary_services.PermissionPolicy
        summary_services.PermissionPolicy = policy_for(viewable)
        try:
            return build()
        finally:
            summary_services.PermissionPolicy = original

    def contact_summary(self, contact_id=GRACE, viewable=EVERYTHING):
        contact = self.db.get(SalesContact, contact_id)
        return ContactSummaryResponse.model_validate(
            self.with_policy(viewable, lambda: summary_services.build_contact_summary(self.db, contact, current_user=self.current_user))
        )

    def organization_summary(self, viewable=EVERYTHING):
        organization = self.db.get(SalesOrganization, ACME)
        return OrganizationSummaryResponse.model_validate(
            self.with_policy(viewable, lambda: summary_services.build_organization_summary(self.db, organization, current_user=self.current_user))
        )

    def opportunity_summary(self, viewable=EVERYTHING):
        opportunity = self.db.get(SalesOpportunity, PILOT)
        return OpportunitySummaryResponse.model_validate(
            self.with_policy(viewable, lambda: summary_services.build_opportunity_summary(self.db, opportunity, current_user=self.current_user))
        )


class ContactDealTests(SummaryFixture):
    def test_a_contacts_deals_include_the_ones_it_participates_in_with_its_role(self):
        summary = self.contact_summary()

        deals = {item.opportunity_id: item for item in summary.related_opportunities}
        self.assertEqual(set(deals), {PILOT, EXPANSION})
        self.assertEqual(summary.opportunity_count, 2)
        self.assertEqual((deals[PILOT].contact_role_label, deals[PILOT].is_primary_contact), ("Champion", False))
        self.assertEqual((deals[EXPANSION].contact_role_label, deals[EXPANSION].is_primary_contact), ("Finance", True))

    def test_removed_links_deleted_deals_and_other_tenants_deals_are_left_out(self):
        ids = {item.opportunity_id for item in self.contact_summary().related_opportunities}

        self.assertNotIn(RENEWAL, ids)
        self.assertNotIn(ARCHIVED, ids)
        self.assertNotIn(RIVAL_DEAL, ids)

    def test_a_legacy_primary_without_a_participant_row_is_still_listed_as_primary(self):
        self.db.query(SalesOpportunityContact).filter(SalesOpportunityContact.contact_id == ADA).delete()
        self.db.commit()

        deals = {item.opportunity_id: item for item in self.contact_summary(ADA).related_opportunities}

        self.assertEqual(set(deals), {PILOT, RENEWAL})
        self.assertTrue(deals[PILOT].is_primary_contact)
        self.assertIsNone(deals[PILOT].contact_role_key)

    def test_counts_are_totals_not_the_length_of_the_list(self):
        for index in range(12):
            self.db.add(
                SalesOpportunity(
                    opportunity_id=200 + index,
                    tenant_id=TENANT,
                    opportunity_name=f"Extra {index}",
                    client="Grace",
                    contact_id=GRACE,
                    organization_id=ACME,
                )
            )
        self.db.commit()

        summary = self.contact_summary()

        self.assertEqual(summary.opportunity_count, 14)
        self.assertEqual(len(summary.related_opportunities), 10)

    def test_a_contacts_orders_follow_the_same_rule_as_its_quotes(self):
        summary = self.contact_summary()

        self.assertEqual({order.id for order in summary.related_orders}, {80, 81})
        self.assertEqual(summary.order_count, 2)
        self.assertEqual([quote.quote_id for quote in summary.related_quotes], [70])
        self.assertEqual(summary.insertion_order_count, 1)


class PermissionTests(SummaryFixture):
    def test_a_section_the_reader_cannot_view_is_hidden_and_says_so(self):
        summary = self.contact_summary(viewable={"sales_contacts", "sales_opportunities"})

        self.assertTrue(summary.related_access.opportunities)
        self.assertEqual(summary.opportunity_count, 2)
        for section, items, count in (
            ("quotes", summary.related_quotes, summary.quote_count),
            ("orders", summary.related_orders, summary.order_count),
            ("insertion_orders", summary.related_insertion_orders, summary.insertion_order_count),
        ):
            with self.subTest(section=section):
                self.assertFalse(getattr(summary.related_access, section))
                self.assertEqual(items, [])
                self.assertEqual(count, 0)

    def test_hidden_deals_also_hide_the_services_inferred_from_them(self):
        self.db.get(SalesOpportunity, EXPANSION).campaign_type = "Webinar"
        self.db.commit()

        visible = self.contact_summary()
        hidden = self.contact_summary(viewable={"sales_contacts"})

        self.assertEqual(visible.inferred_services, ["Webinar"])
        self.assertEqual(hidden.inferred_services, [])
        self.assertEqual(hidden.related_opportunities, [])

    def test_no_reader_means_no_related_records(self):
        contact = self.db.get(SalesContact, GRACE)

        summary = ContactSummaryResponse.model_validate(summary_services.build_contact_summary(self.db, contact))

        self.assertFalse(summary.related_access.opportunities)
        self.assertEqual(summary.related_opportunities, [])
        self.assertEqual(summary.quote_count, 0)

    def test_an_account_hides_each_section_independently(self):
        summary = self.organization_summary(viewable={"sales_organizations", "sales_quotes", "finance_pos"})

        self.assertEqual(summary.related_contacts, [])
        self.assertEqual(summary.contact_count, 0)
        self.assertFalse(summary.related_access.contacts)
        self.assertEqual(summary.related_opportunities, [])
        self.assertEqual(summary.related_orders, [])
        self.assertEqual([quote.quote_id for quote in summary.related_quotes], [70])
        self.assertEqual([invoice.id for invoice in summary.related_invoices], [85])
        self.assertTrue(summary.related_access.invoices)

    def test_an_account_with_full_access_counts_every_section(self):
        summary = self.organization_summary()

        self.assertEqual(summary.contact_count, 2)
        self.assertEqual(summary.opportunity_count, 3)  # Pilot, Expansion, Renewal; not the deleted one
        self.assertEqual(summary.quote_count, 1)
        self.assertEqual(summary.order_count, 1)  # SO-81 has no account
        self.assertEqual(summary.invoice_count, 1)

    def test_a_deal_hides_quotes_from_a_reader_without_quotes_access(self):
        allowed = self.opportunity_summary()
        denied = self.opportunity_summary(viewable={"sales_opportunities", "sales_contacts"})

        self.assertEqual([quote.quote_id for quote in allowed.related_quotes], [70])
        self.assertEqual(allowed.quote_count, 1)
        self.assertEqual(denied.related_quotes, [])
        self.assertEqual(denied.quote_count, 0)
        self.assertFalse(denied.related_access.quotes)
        self.assertTrue(denied.can_view_contacts)


class SummaryRouteTests(SummaryFixture):
    """The routes pass the reader through, so the API response is what is filtered."""

    def setUp(self):
        super().setUp()
        self.viewable = {"sales_contacts", "sales_organizations", "sales_opportunities"}
        policy = policy_for(self.viewable)
        self._originals = (permissions_module.PermissionPolicy, summary_services.PermissionPolicy)
        permissions_module.PermissionPolicy = policy
        summary_services.PermissionPolicy = policy
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[require_user] = lambda: self.current_user
        self.client = TestClient(app)

    def tearDown(self):
        permissions_module.PermissionPolicy, summary_services.PermissionPolicy = self._originals
        app.dependency_overrides.clear()
        self.client.close()
        super().tearDown()

    def test_the_contact_summary_route_omits_quotes_the_reader_cannot_view(self):
        response = self.client.get(f"/api/v1/sales/contacts/{GRACE}/summary")

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["related_quotes"], [])
        self.assertFalse(body["related_access"]["quotes"])
        self.assertEqual(body["opportunity_count"], 2)

    def test_the_account_summary_route_omits_orders_the_reader_cannot_view(self):
        response = self.client.get(f"/api/v1/sales/organizations/{ACME}/summary")

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["related_orders"], [])
        self.assertEqual(body["order_count"], 0)
        self.assertEqual(body["contact_count"], 2)

    def test_another_tenants_contact_is_not_found(self):
        self.assertEqual(self.client.get("/api/v1/sales/contacts/60/summary").status_code, 404)


if __name__ == "__main__":
    unittest.main()
