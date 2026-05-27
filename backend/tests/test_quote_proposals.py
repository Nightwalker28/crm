import unittest
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.sales.models import SalesQuote, SalesQuoteDocument, SalesQuoteOpenEvent
from app.modules.sales.services.quotes_services import (
    generate_quote_proposal,
    get_public_quote_proposal_or_404,
    list_quote_proposal_events,
    record_quote_proposal_event,
    send_quote_proposal,
)
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus


class QuoteProposalTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.user = User(
            id=1,
            tenant_id=10,
            email="owner@example.com",
            first_name="Owner",
            last_name="User",
            is_active=UserStatus.active,
        )
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default"),
                Tenant(id=99, slug="other", name="Other"),
                self.user,
                User(
                    id=2,
                    tenant_id=99,
                    email="other@example.com",
                    first_name="Other",
                    last_name="User",
                    is_active=UserStatus.active,
                ),
                SalesQuote(
                    quote_id=100,
                    tenant_id=10,
                    quote_number="Q-100",
                    customer_name="Acme",
                    title="Launch proposal",
                    total_amount="1250",
                    currency="USD",
                ),
                SalesQuote(
                    quote_id=200,
                    tenant_id=99,
                    quote_number="Q-200",
                    customer_name="Other",
                    total_amount="500",
                    currency="USD",
                ),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_generate_quote_proposal_creates_tenant_scoped_metadata(self):
        quote = self.db.query(SalesQuote).filter(SalesQuote.quote_id == 100).one()

        proposal = generate_quote_proposal(self.db, quote, self.user)

        self.assertEqual(proposal.tenant_id, 10)
        self.assertEqual(proposal.quote_id, 100)
        self.assertEqual(proposal.status, "generated")
        self.assertEqual(proposal.template_name, "default_quote_proposal")
        self.assertIn("Q-100", proposal.content_text)
        self.assertIsNone(proposal.public_token_hash)

    def test_send_quote_proposal_adds_signed_link_hash_and_sent_event(self):
        quote = self.db.query(SalesQuote).filter(SalesQuote.quote_id == 100).one()

        proposal, public_url_path, expires_at = send_quote_proposal(
            self.db,
            quote,
            sent_to="buyer@example.com",
            current_user=self.user,
        )

        self.assertEqual(proposal.status, "sent")
        self.assertEqual(proposal.sent_to, "buyer@example.com")
        self.assertIsNotNone(proposal.public_token_hash)
        self.assertNotIn(public_url_path.rsplit("/", 1)[-1], proposal.public_token_hash)
        self.assertGreater(expires_at, datetime.now(timezone.utc))
        events = list_quote_proposal_events(self.db, quote)
        self.assertEqual([event.event_type for event in events], ["sent"])

    def test_public_tracking_records_hashed_request_metadata(self):
        quote = self.db.query(SalesQuote).filter(SalesQuote.quote_id == 100).one()
        proposal, public_url_path, _expires_at = send_quote_proposal(
            self.db,
            quote,
            sent_to="buyer@example.com",
            current_user=self.user,
        )
        token = public_url_path.rsplit("/", 1)[-1]

        public_proposal, public_quote = get_public_quote_proposal_or_404(self.db, token)
        event = record_quote_proposal_event(
            self.db,
            proposal=public_proposal,
            event_type="downloaded",
            ip_address="203.0.113.5",
            user_agent="UnitTest/1.0",
        )

        self.assertEqual(public_quote.quote_id, quote.quote_id)
        self.assertEqual(public_proposal.id, proposal.id)
        self.assertEqual(event.event_type, "downloaded")
        self.assertNotEqual(event.ip_hash, "203.0.113.5")
        self.assertNotEqual(event.user_agent_hash, "UnitTest/1.0")
        self.assertEqual(self.db.query(SalesQuoteOpenEvent).filter(SalesQuoteOpenEvent.tenant_id == 99).count(), 0)

    def test_expired_public_link_is_not_resolved(self):
        quote = self.db.query(SalesQuote).filter(SalesQuote.quote_id == 100).one()
        proposal, public_url_path, _expires_at = send_quote_proposal(
            self.db,
            quote,
            sent_to="buyer@example.com",
            current_user=self.user,
        )
        proposal.public_expires_at = datetime.now(timezone.utc) - timedelta(days=1)
        self.db.add(proposal)
        self.db.commit()

        with self.assertRaises(HTTPException) as exc:
            get_public_quote_proposal_or_404(self.db, public_url_path.rsplit("/", 1)[-1])

        self.assertEqual(exc.exception.status_code, 404)

    def test_unknown_public_token_is_not_resolved(self):
        with self.assertRaises(HTTPException) as exc:
            get_public_quote_proposal_or_404(self.db, "missing")

        self.assertEqual(exc.exception.status_code, 404)
        self.assertEqual(self.db.query(SalesQuoteDocument).count(), 0)


if __name__ == "__main__":
    unittest.main()
