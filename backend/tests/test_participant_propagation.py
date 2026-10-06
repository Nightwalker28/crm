"""Relationship context carried downstream (05-relationships-data-model, Phase 3).

A quote or order linked to a deal is addressed to one of the deal's participants:
the primary by default, any active participant by choice, and never a contact who
is not on the deal. Lead conversion links only the contact it converts. Nothing
copies every participant onto a downstream record.
"""

import unittest
from datetime import datetime, timezone
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
from app.modules.sales.models import (
    SalesContact,
    SalesLead,
    SalesOpportunity,
    SalesOpportunityContact,
    SalesOrganization,
    SalesQuote,
)
from app.modules.sales.services import quotes_services
from app.modules.sales.services.leads_services import convert_sales_lead
from app.modules.sales.services.orders_services import convert_quote_to_order, create_sales_order
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus

TENANT = 10
OTHER_TENANT = 99
DEAL = 40
OTHER_DEAL = 41

ADA = 30  # primary
GRACE = 31  # active participant
LINUS = 32  # on another deal only
MIA = 33  # removed from the deal
ZOE = 34  # participant whose contact is in the recycle bin
RIVAL = 60  # another tenant

NOT_A_PARTICIPANT = "contact must be a participant on the linked opportunity"


class PropagationFixture(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        removed_at = datetime(2026, 9, 1, tzinfo=timezone.utc)

        def contact(contact_id, name, **kwargs):
            return SalesContact(
                contact_id=contact_id,
                tenant_id=kwargs.pop("tenant_id", TENANT),
                first_name=name,
                primary_email=f"{name.lower()}@acme.example",
                organization_id=kwargs.pop("organization_id", 20),
                **kwargs,
            )

        def link(contact_id, *, opportunity_id=DEAL, role_key="other", is_primary=False, deleted_at=None):
            return SalesOpportunityContact(
                tenant_id=TENANT,
                opportunity_id=opportunity_id,
                contact_id=contact_id,
                role_key=role_key,
                is_primary=is_primary,
                deleted_at=deleted_at,
            )

        self.db.add_all(
            [
                Tenant(id=TENANT, slug="default", name="Default"),
                Tenant(id=OTHER_TENANT, slug="rival", name="Rival"),
                User(id=1, tenant_id=TENANT, email="ava@example.com", first_name="Ava", is_active=UserStatus.active),
                SalesOrganization(org_id=20, tenant_id=TENANT, org_name="Acme"),
                SalesOrganization(org_id=21, tenant_id=OTHER_TENANT, org_name="Rival Co"),
                contact(ADA, "Ada"),
                contact(GRACE, "Grace"),
                contact(LINUS, "Linus"),
                contact(MIA, "Mia"),
                contact(ZOE, "Zoe", deleted_at=removed_at),
                contact(RIVAL, "Rival", tenant_id=OTHER_TENANT, organization_id=21),
                SalesOpportunity(
                    opportunity_id=DEAL,
                    tenant_id=TENANT,
                    opportunity_name="Acme Pilot",
                    contact_id=ADA,
                    organization_id=20,
                ),
                SalesOpportunity(
                    opportunity_id=OTHER_DEAL,
                    tenant_id=TENANT,
                    opportunity_name="Acme Expansion",
                    contact_id=LINUS,
                    organization_id=20,
                ),
            ]
        )
        self.db.flush()
        self.db.add_all(
            [
                link(ADA, role_key="decision_maker", is_primary=True),
                link(GRACE, role_key="champion"),
                link(MIA, role_key="finance", deleted_at=removed_at),
                link(ZOE, role_key="legal"),
                link(LINUS, opportunity_id=OTHER_DEAL, is_primary=True),
            ]
        )
        self.db.commit()
        self.current_user = SimpleNamespace(id=1, tenant_id=TENANT)

    def tearDown(self):
        self.db.close()


class QuoteParticipantTests(PropagationFixture):
    def create_quote(self, **payload):
        with patch.object(quotes_services, "validate_custom_field_payload", return_value={}), \
             patch.object(quotes_services, "save_custom_field_values"), \
             patch.object(quotes_services, "hydrate_custom_field_record", side_effect=lambda *args, **kwargs: kwargs["record"]):
            return quotes_services.create_sales_quote(
                self.db,
                {"customer_name": "Acme", "opportunity_id": DEAL, "currency": "USD", **payload},
                self.current_user,
            )

    def assert_refused(self, contact_id, detail):
        with self.assertRaises(HTTPException) as exc:
            self.create_quote(contact_id=contact_id)
        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, detail)
        self.assertEqual(self.db.query(SalesQuote).count(), 0)

    def test_a_quote_without_a_contact_is_addressed_to_the_primary(self):
        quote = self.create_quote()

        self.assertEqual(quote.contact_id, ADA)
        self.assertEqual(quote.organization_id, 20)

    def test_a_quote_may_be_addressed_to_another_active_participant(self):
        quote = self.create_quote(contact_id=GRACE)

        self.assertEqual(quote.contact_id, GRACE)
        self.assertEqual(quote.opportunity_id, DEAL)
        self.assertEqual(quote.organization_id, 20)

    def test_a_contact_who_is_not_on_the_deal_is_refused_not_swapped_for_the_primary(self):
        self.assert_refused(LINUS, f"Quote {NOT_A_PARTICIPANT}")

    def test_a_removed_participant_is_refused(self):
        self.assert_refused(MIA, f"Quote {NOT_A_PARTICIPANT}")

    def test_a_participant_whose_contact_is_in_the_recycle_bin_is_refused(self):
        self.assert_refused(ZOE, "Contact not found")

    def test_another_tenants_contact_is_refused(self):
        self.assert_refused(RIVAL, "Contact not found")

    def test_changing_the_contact_on_a_linked_quote_uses_the_same_rule(self):
        quote = self.create_quote()

        with patch.object(quotes_services, "hydrate_custom_field_record", side_effect=lambda *args, **kwargs: kwargs["record"]):
            updated = quotes_services.update_sales_quote(self.db, quote, {"opportunity_id": DEAL, "contact_id": GRACE})
            self.assertEqual(updated.contact_id, GRACE)
            with self.assertRaises(HTTPException) as exc:
                quotes_services.update_sales_quote(self.db, quote, {"opportunity_id": DEAL, "contact_id": LINUS})

        self.assertEqual(exc.exception.detail, f"Quote {NOT_A_PARTICIPANT}")

    def test_the_legacy_primary_is_accepted_even_without_an_association_row(self):
        self.db.query(SalesOpportunityContact).filter(SalesOpportunityContact.contact_id == ADA).delete()
        self.db.commit()

        quote = self.create_quote(contact_id=ADA)

        self.assertEqual(quote.contact_id, ADA)


class OrderParticipantTests(PropagationFixture):
    def accepted_quote(self, contact_id):
        quote = SalesQuote(
            quote_id=50,
            tenant_id=TENANT,
            quote_number="Q-500",
            customer_name="Acme",
            contact_id=contact_id,
            organization_id=20,
            opportunity_id=DEAL,
            status="accepted",
            currency="USD",
            subtotal_amount=Decimal("100"),
            discount_amount=Decimal("0"),
            tax_amount=Decimal("0"),
            total_amount=Decimal("100"),
            assigned_to=1,
        )
        self.db.add(quote)
        self.db.commit()
        return quote

    def create_order(self, **payload):
        return create_sales_order(
            self.db,
            {"opportunity_id": DEAL, "items": [{"name": "Pilot", "quantity": "1", "unit_price": "10"}], **payload},
            self.current_user,
        )

    def test_a_quote_addressed_to_a_participant_converts_with_that_contact(self):
        order = convert_quote_to_order(self.db, self.accepted_quote(GRACE), self.current_user)

        self.assertEqual(order.contact_id, GRACE)
        self.assertEqual(order.opportunity_id, DEAL)
        self.assertEqual(order.organization_id, 20)

    def test_a_manual_order_without_a_contact_is_addressed_to_the_primary(self):
        order = self.create_order()

        self.assertEqual(order.contact_id, ADA)
        self.assertEqual(order.organization_id, 20)

    def test_a_manual_order_may_be_addressed_to_another_active_participant(self):
        self.assertEqual(self.create_order(contact_id=GRACE).contact_id, GRACE)

    def test_a_manual_order_for_a_contact_not_on_the_deal_is_refused(self):
        for contact_id in (LINUS, MIA):
            with self.subTest(contact_id=contact_id):
                with self.assertRaises(HTTPException) as exc:
                    self.create_order(contact_id=contact_id)
                self.assertEqual(exc.exception.status_code, 400)
                self.assertEqual(exc.exception.detail, f"Order {NOT_A_PARTICIPANT}")

    def test_the_account_must_still_match_the_deal(self):
        self.db.add(SalesOrganization(org_id=22, tenant_id=TENANT, org_name="Globex"))
        self.db.commit()

        with self.assertRaises(HTTPException) as exc:
            self.create_order(contact_id=GRACE, organization_id=22)

        self.assertEqual(exc.exception.detail, "Order organization must match the linked opportunity")


class LeadConversionTests(PropagationFixture):
    def test_converting_into_an_account_links_only_the_converted_contact(self):
        lead = SalesLead(lead_id=70, tenant_id=TENANT, first_name="Nina", primary_email="nina@prospect.example", status="new")
        self.db.add(lead)
        self.db.commit()

        result = convert_sales_lead(
            self.db,
            lead,
            {"create_deal": True, "deal_name": "Nina deal", "assigned_to": 1, "deal_stage": "lead", "account_id": 20},
            current_user=self.current_user,
        )

        links = (
            self.db.query(SalesOpportunityContact)
            .filter(SalesOpportunityContact.opportunity_id == result["deal_id"])
            .all()
        )
        # Acme already has five contacts; none of them is copied onto the new deal.
        self.assertEqual([(link.contact_id, link.is_primary) for link in links], [(result["contact_id"], True)])
        self.assertNotIn(result["contact_id"], {ADA, GRACE, LINUS, MIA, ZOE})


if __name__ == "__main__":
    unittest.main()
