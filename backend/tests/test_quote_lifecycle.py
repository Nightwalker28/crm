"""13d §3.5 (Step 7, F5 slice 5.5): the quote lifecycle — dates, acceptance with a signer and
optional items, declining, revisions, conversion locking, the expiry scan, and the customer's
proposal page."""

import unittest
from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.platform.models import ActivityLog
from app.modules.sales.models import SalesOrganization, SalesQuote
from app.modules.sales.services import quotes_services as quotes
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import CompanyProfile, Tenant, User, UserStatus

TENANT = 10
TODAY = date(2026, 10, 9)
SIGNATURE = "data:image/png;base64,iVBORw0KGgo="


class QuoteLifecycleTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.user = SimpleNamespace(id=1, tenant_id=TENANT, first_name="Ada", last_name="Owner", email="owner@example.com")
        self.db.add_all([
            Tenant(id=TENANT, slug="main", name="Main"),
            User(id=1, tenant_id=TENANT, email="owner@example.com", is_active=UserStatus.active),
            CompanyProfile(id=1, tenant_id=TENANT, name="Northwind", operating_currencies=["USD"], base_currency="USD",
                           quote_validity_days=14),
            SalesOrganization(org_id=5, tenant_id=TENANT, org_name="Acme", primary_email="ap@acme.test", assigned_to=1),
        ])
        self.db.commit()
        today = patch.object(quotes, "_today", return_value=TODAY)
        today.start()
        self.addCleanup(today.stop)

    def tearDown(self):
        self.db.close()

    def quote(self, **extra) -> SalesQuote:
        payload = {"organization_id": 5, "items": [
            {"name": "Lens", "quantity": "1", "unit_price": "100"},
            {"name": "Cleaning kit", "quantity": "1", "unit_price": "20", "is_optional": True},
        ], **extra}
        return quotes.create_sales_quote(self.db, payload, self.user)

    def actions(self, quote) -> list[str]:
        return [row.action for row in self.db.query(ActivityLog).filter(ActivityLog.entity_id == quote.quote_id).order_by(ActivityLog.id)]

    def test_a_new_quote_is_issued_today_and_valid_for_the_company_period(self):
        quote = self.quote()
        self.assertEqual(quote.issue_date, TODAY)
        self.assertEqual(quote.expiry_date, TODAY + timedelta(days=14))
        self.assertEqual(quote.customer_name, "Acme")

    def test_expiry_before_issue_is_refused(self):
        with self.assertRaises(HTTPException) as caught:
            self.quote(issue_date="2026-10-09", expiry_date="2026-10-01")
        self.assertIn("expiry date cannot be before", caught.exception.detail)

    def test_optional_lines_stay_out_of_the_total_until_chosen(self):
        quote = self.quote(status="sent")
        self.assertEqual(Decimal(quote.total_amount), Decimal("100"))
        optional = next(item for item in quote.items if item.is_optional)
        quotes.accept_quote(self.db, quote, signer_name="  Bea   Buyer ", signature=SIGNATURE, optional_item_ids=[optional.id],
                            signer_ip="203.0.113.9")
        self.db.commit()
        self.assertEqual(quote.status, "accepted")
        self.assertEqual(quote.accepted_by_name, "Bea Buyer")
        self.assertIsNotNone(quote.accepted_at)
        self.assertEqual(quote.signature_data, SIGNATURE)
        self.assertEqual(Decimal(quote.total_amount), Decimal("120"))
        self.assertFalse(any(item.is_optional for item in quote.items))
        log = self.db.query(ActivityLog).filter(ActivityLog.action == "quote.accepted").one()
        self.assertEqual(log.after_state["optional_items"], ["Cleaning kit"])
        self.assertTrue(log.after_state["ip_hash"])
        self.assertNotIn("203.0.113.9", str(log.after_state))

    def test_accepting_needs_a_name_and_a_real_signature(self):
        quote = self.quote(status="sent")
        with self.assertRaises(HTTPException):
            quotes.accept_quote(self.db, quote, signer_name="   ")
        with self.assertRaises(HTTPException):
            quotes.accept_quote(self.db, quote, signer_name="Bea", signature="javascript:alert(1)")
        with self.assertRaises(HTTPException):
            quotes.accept_quote(self.db, quote, signer_name="Bea", optional_item_ids=[999])

    def test_an_expired_quote_cannot_be_accepted(self):
        quote = self.quote(status="sent", issue_date="2026-09-01", expiry_date="2026-09-30")
        with self.assertRaises(HTTPException) as caught:
            quotes.accept_quote(self.db, quote, signer_name="Bea")
        self.assertEqual(caught.exception.status_code, 409)

    def test_declining_keeps_the_note(self):
        quote = self.quote(status="sent")
        quotes.decline_quote(self.db, quote, note="  Over budget this quarter ")
        self.db.commit()
        self.assertEqual(quote.status, "declined")
        self.assertEqual(quote.decline_note, "Over budget this quarter")
        self.assertIn("quote.declined", self.actions(quote))

    def test_revising_copies_to_the_next_revision_and_supersedes(self):
        quote = self.quote(status="sent")
        number = quote.quote_number
        revision = quotes.revise_quote(self.db, quote, self.user)
        self.db.commit()
        self.assertEqual(revision.quote_number, f"{number}-R2")
        self.assertEqual(revision.revision, 2)
        self.assertEqual(revision.revised_from_id, quote.quote_id)
        self.assertEqual(revision.status, "draft")
        self.assertEqual(len(revision.items), 2)
        self.assertEqual(quote.status, "superseded")
        self.assertEqual(quote.superseded_by, {"quote_id": revision.quote_id, "quote_number": revision.quote_number})
        self.assertEqual(revision.revised_from_number, number)

        revision.status = "declined"
        self.db.commit()
        third = quotes.revise_quote(self.db, revision, self.user)
        self.assertEqual(third.quote_number, f"{number}-R3")

    def test_a_draft_cannot_be_revised(self):
        with self.assertRaises(HTTPException) as caught:
            quotes.revise_quote(self.db, self.quote(), self.user)
        self.assertEqual(caught.exception.status_code, 409)

    def test_superseded_and_converted_quotes_are_locked(self):
        quote = self.quote(status="accepted")
        quotes.mark_converted(self.db, quote, actor=self.user)
        self.db.commit()
        self.assertEqual(quote.status, "converted")
        with self.assertRaises(HTTPException):
            quotes.update_sales_quote(self.db, quote, {"title": "Changed"})
        with self.assertRaises(HTTPException):
            quotes.accept_quote(self.db, quote, signer_name="Bea")

    def test_the_scan_expires_open_quotes_once(self):
        stale = self.quote(status="sent", issue_date="2026-09-01", expiry_date="2026-09-30")
        draft = self.quote(issue_date="2026-09-01", expiry_date="2026-10-08")
        current = self.quote(status="sent")
        accepted = self.quote(status="accepted", issue_date="2026-09-01", expiry_date="2026-09-30")
        self.assertEqual(quotes.scan_expired_quotes(self.db, today=TODAY), 2)
        self.assertEqual([stale.status, draft.status, current.status, accepted.status], ["expired", "expired", "sent", "accepted"])
        self.assertEqual(quotes.scan_expired_quotes(self.db, today=TODAY), 0)
        self.assertEqual(self.actions(stale).count("quote.expired"), 1)

    def test_the_proposal_page_says_what_the_customer_can_do(self):
        quote = self.quote(status="sent")
        proposal = SimpleNamespace(id=1)
        view = quotes.public_proposal_view(self.db, proposal, quote)
        self.assertEqual(view["state"], "open")
        self.assertTrue(view["can_respond"])
        self.assertEqual([item["name"] for item in view["optional_items"]], ["Cleaning kit"])
        self.assertIn(quote.quote_number, view["html"])
        self.assertNotIn("assigned_to", view)

        quotes.revise_quote(self.db, quote, self.user)
        view = quotes.public_proposal_view(self.db, proposal, quote)
        self.assertEqual(view["state"], "replaced")
        self.assertFalse(view["can_respond"])
        self.assertEqual(view["optional_items"], [])


if __name__ == "__main__":
    unittest.main()
