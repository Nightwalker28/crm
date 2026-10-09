"""13d §3.7 (Step 7, F5 slice 5.7): the client portal — invites, forgot and reset password,
the account's orders and invoices with their PDFs, and the scope every one of them keeps."""

import unittest
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.passwords import hash_password, verify_password
from app.modules.client_portal.models import ClientAccount, ClientPasswordReset
from app.modules.client_portal.services import client_access_services, client_documents_services
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.finance.models import FinancePosInvoice
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.sales.models import SalesContact, SalesOrder, SalesOrganization, SalesQuote
from app.modules.sales.services.quotes_services import list_client_quotes
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import CompanyProfile, Tenant, User, UserStatus

PASSWORD = "Correct-Horse-9-Battery"
NEW_PASSWORD = "Another-Horse-7-Staple"


class ClientPortalF5Tests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.db.add_all([
            Tenant(id=10, slug="main", name="Main"),
            Tenant(id=99, slug="other", name="Other"),
            User(id=1, tenant_id=10, email="owner@example.com", is_active=UserStatus.active),
            CompanyProfile(id=1, tenant_id=10, name="Northwind", operating_currencies=["USD"], base_currency="USD"),
            SalesOrganization(org_id=3, tenant_id=10, org_name="Buyer Co", assigned_to=1),
            SalesOrganization(org_id=4, tenant_id=10, org_name="Someone Else", assigned_to=1),
            SalesOrganization(org_id=9, tenant_id=99, org_name="Other tenant", assigned_to=1),
            SalesContact(contact_id=7, tenant_id=10, first_name="Bea", primary_email="bea@buyer.test", organization_id=3, assigned_to=1),
            ClientAccount(id=40, tenant_id=10, organization_id=3, email="bea@buyer.test", status="active", password_hash=hash_password(PASSWORD)),
            ClientAccount(id=41, tenant_id=10, contact_id=7, email="contact-only@buyer.test", status="active", password_hash=hash_password(PASSWORD)),
        ])
        self.db.commit()
        self.account = self.db.get(ClientAccount, 40)

    def tearDown(self):
        self.db.close()

    def order(self, order_id, *, org_id=3, status="confirmed", tenant_id=10, client_account_id=None, source="crm"):
        order = SalesOrder(id=order_id, tenant_id=tenant_id, order_number=f"SO-{order_id}", organization_id=org_id, status=status, source=source,
                           client_account_id=client_account_id, currency="USD", grand_total=Decimal("10"))
        self.db.add(order)
        self.db.commit()
        return order

    def invoice(self, invoice_id, *, org_id=3, status="issued", tenant_id=10, balance="10"):
        invoice = FinancePosInvoice(id=invoice_id, tenant_id=tenant_id, invoice_number=f"INV-{invoice_id}", customer_name="Buyer Co",
                                    customer_organization_id=org_id, status=status, currency="USD", total_amount=Decimal("10"),
                                    balance_due=Decimal(balance), amount_paid=Decimal("0"), issue_date=date(2026, 10, 1), due_date=date(2026, 10, 31))
        self.db.add(invoice)
        self.db.commit()
        return invoice

    # Orders ----------------------------------------------------------------------------------

    def test_orders_are_the_accounts_confirmed_ones_and_my_requests(self):
        self.order(1)
        self.order(2, status="draft")  # the team's draft for this account: not shown
        self.order(3, status="draft", client_account_id=40, source="client_portal")  # my request: shown
        self.order(4, org_id=4)  # another account
        self.order(5, org_id=9, tenant_id=99)  # another tenant
        self.assertEqual(sorted(order.id for order in client_documents_services.list_orders(self.db, account=self.account)), [1, 3])
        for hidden in (2, 4, 5):
            with self.assertRaises(HTTPException) as caught:
                client_documents_services.get_order(self.db, account=self.account, order_id=hidden)
            self.assertEqual(caught.exception.status_code, 404)

    def test_a_request_has_no_document_until_confirmed(self):
        self.order(3, status="draft", client_account_id=40, source="client_portal")
        with self.assertRaises(HTTPException) as caught:
            client_documents_services.document_pdf(self.db, account=self.account, module_key="sales_orders", record_id=3)
        self.assertEqual(caught.exception.status_code, 409)

    # Invoices --------------------------------------------------------------------------------

    def test_invoices_are_the_accounts_issued_ones(self):
        self.invoice(1)
        self.invoice(2, status="draft")
        self.invoice(3, org_id=4)
        self.invoice(4, org_id=9, tenant_id=99)
        self.assertEqual([invoice.id for invoice in client_documents_services.list_invoices(self.db, account=self.account)], [1])
        for hidden in (2, 3, 4):
            with self.assertRaises(HTTPException):
                client_documents_services.get_invoice(self.db, account=self.account, invoice_id=hidden)
            with self.assertRaises(HTTPException):
                client_documents_services.document_pdf(self.db, account=self.account, module_key="finance_pos", record_id=hidden)

    def test_a_contact_only_account_sees_its_contacts_invoices(self):
        invoice = self.invoice(1, org_id=None)
        invoice.customer_contact_id = 7
        self.db.commit()
        contact_account = self.db.get(ClientAccount, 41)
        self.assertEqual([row.id for row in client_documents_services.list_invoices(self.db, account=contact_account)], [1])
        self.assertEqual(client_documents_services.list_invoices(self.db, account=self.account), [])

    def test_other_documents_are_not_printable_from_the_portal(self):
        with self.assertRaises(HTTPException) as caught:
            client_documents_services.document_pdf(self.db, account=self.account, module_key="purchase_bills", record_id=1)
        self.assertEqual(caught.exception.status_code, 404)

    def test_draft_quotes_are_not_shown(self):
        self.db.add_all([
            SalesQuote(quote_id=1, tenant_id=10, quote_number="Q-1", customer_name="Buyer Co", organization_id=3, status="draft", currency="USD"),
            SalesQuote(quote_id=2, tenant_id=10, quote_number="Q-2", customer_name="Buyer Co", organization_id=3, status="sent", currency="USD"),
        ])
        self.db.commit()
        quotes = list_client_quotes(self.db, tenant_id=10, contact_id=None, organization_id=3)
        self.assertEqual([quote.quote_id for quote in quotes], [2])

    # Invite, forgot, reset -------------------------------------------------------------------

    def test_the_invite_is_emailed_and_a_missing_sender_is_reported(self):
        with patch("app.modules.mail.services.tenant_mail.send_transactional_message") as send:
            sent, error = client_access_services.send_invite(self.db, account=self.account, setup_link="https://app.test/client/setup?token=x",
                                                             actor_user_id=1)
        self.assertEqual((sent, error), (True, None))
        self.assertIn("Set your password to sign in to Northwind", send.call_args.kwargs["subject"])
        self.assertIn("https://app.test/client/setup?token=x", send.call_args.kwargs["body"])
        with patch("app.modules.mail.services.tenant_mail.send_transactional_message", side_effect=ValueError("No email sender is set up")):
            sent, error = client_access_services.send_invite(self.db, account=self.account, setup_link="https://x", actor_user_id=1)
        self.assertFalse(sent)
        self.assertIn("No email sender", error)

    def _reset_token(self, email="bea@buyer.test"):
        with patch("app.modules.mail.services.tenant_mail.send_transactional_message") as send:
            client_access_services.request_password_reset(self.db, tenant_id=10, email=email)
        if not send.called:
            return None
        body = send.call_args.kwargs["body"]
        return body.split("token=")[1].split("&")[0].split()[0]

    def test_forgot_emails_a_single_use_link_and_reset_changes_the_password(self):
        token = self._reset_token()
        self.assertTrue(token)
        client_access_services.reset_password(self.db, token=token, password=NEW_PASSWORD, expected_tenant_id=10)
        self.db.refresh(self.account)
        self.assertTrue(verify_password(NEW_PASSWORD, self.account.password_hash))
        with self.assertRaises(HTTPException):
            client_access_services.reset_password(self.db, token=token, password=PASSWORD)

    def test_forgot_for_an_unknown_address_sends_nothing(self):
        self.assertIsNone(self._reset_token("nobody@buyer.test"))
        self.assertEqual(self.db.query(ClientPasswordReset).count(), 0)

    def test_a_new_link_ends_the_old_one_and_links_expire(self):
        first = self._reset_token()
        second = self._reset_token()
        with self.assertRaises(HTTPException):
            client_access_services.reset_password(self.db, token=first, password=NEW_PASSWORD)
        row = self.db.query(ClientPasswordReset).filter(ClientPasswordReset.used_at.is_(None)).one()
        row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        self.db.commit()
        with self.assertRaises(HTTPException):
            client_access_services.reset_password(self.db, token=second, password=NEW_PASSWORD)

    def test_a_reset_link_from_another_workspace_is_refused(self):
        token = self._reset_token()
        with self.assertRaises(HTTPException):
            client_access_services.reset_password(self.db, token=token, password=NEW_PASSWORD, expected_tenant_id=99)

    def test_changing_the_password_needs_the_current_one(self):
        with self.assertRaises(HTTPException):
            client_access_services.change_password(self.db, account=self.account, current_password="wrong", new_password=NEW_PASSWORD)
        client_access_services.change_password(self.db, account=self.account, current_password=PASSWORD, new_password=NEW_PASSWORD)
        self.assertTrue(verify_password(NEW_PASSWORD, self.account.password_hash))


if __name__ == "__main__":
    unittest.main()
