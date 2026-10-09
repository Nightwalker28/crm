"""13d §3.6 (Step 7, F5 slice 5.6): recurring invoices, payment reminders, statements and
write-offs."""

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
from app.modules.finance.models import FinancePosInvoice, FinanceRecurringInvoice, FinanceReminderRule, FinanceReminderSend
from app.modules.finance.services import payment_services, pos_invoice_services, receivables
from app.modules.finance.services import recurring_invoices as recurring
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.platform.models import ActivityLog
from app.modules.sales.models import SalesContact, SalesOrganization
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import CompanyProfile, Tenant, User, UserStatus

TENANT = 10
TODAY = date(2026, 10, 9)


class ReceivablesFixture(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.user = SimpleNamespace(id=1, tenant_id=TENANT, first_name="Ada", last_name="Owner", email="owner@example.com")
        self.db.add_all([
            Tenant(id=TENANT, slug="main", name="Main"),
            User(id=1, tenant_id=TENANT, email="owner@example.com", is_active=UserStatus.active),
            CompanyProfile(id=1, tenant_id=TENANT, name="Northwind", operating_currencies=["USD"], base_currency="USD", write_off_limit=5),
            SalesOrganization(org_id=5, tenant_id=TENANT, org_name="Acme", primary_email="ap@acme.test", assigned_to=1),
            SalesOrganization(org_id=6, tenant_id=TENANT, org_name="Quiet Ltd", primary_email="ap@quiet.test", assigned_to=1, no_reminders=True),
            SalesContact(contact_id=11, tenant_id=TENANT, first_name="Bea", last_name="Buyer", primary_email="bea@acme.test", organization_id=5, assigned_to=1),
        ])
        self.db.commit()
        render = patch("app.modules.platform.services.document_pdfs.render_pdf", return_value=b"%PDF-test")
        render.start()
        self.addCleanup(render.stop)

    def tearDown(self):
        self.db.close()

    def invoice(self, *, org_id=5, total="100", issue=True, issue_date=None, due_date=None) -> FinancePosInvoice:
        payload = {"customer_name": "Acme", "customer_organization_id": org_id, "lines": [{"description": "Service", "quantity": "1", "unit_price": total}],
                   "issue": issue}
        if issue_date:
            payload["issue_date"] = issue_date.isoformat()
        if due_date:
            payload["due_date"] = due_date.isoformat()
        return pos_invoice_services.create_invoice(self.db, self.user, payload)

    def pay(self, invoice, amount, paid_on):
        payment_services.record_payment(self.db, tenant_id=TENANT, actor_user_id=1, finance_user=self.user, payload={
            "direction": "received", "kind": "payment", "paid_on": paid_on.isoformat(),
            "allocations": [{"invoice_id": invoice.id, "amount": amount}]})
        self.db.commit()


class RecurringInvoiceTests(ReceivablesFixture):
    def profile(self, **extra):
        payload = {"name": "Acme retainer", "customer_organization_id": 5, "customer_contact_id": 11, "frequency": "monthly",
                   "start_date": "2026-10-31", "lines": [{"description": "Retainer", "quantity": "1", "unit_price": "500"}], **extra}
        profile = recurring.save_profile(self.db, self.user, payload, today=TODAY)
        self.db.commit()
        return profile

    def test_months_keep_the_start_day_clamped_to_short_months(self):
        dates = [date(2026, 1, 31)]
        for _ in range(3):
            dates.append(recurring.advance(dates[-1], frequency="monthly", interval=1, anchor_day=31))
        self.assertEqual(dates, [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30)])
        self.assertEqual(recurring.advance(date(2026, 1, 15), frequency="quarterly", interval=2, anchor_day=15), date(2026, 7, 15))
        self.assertEqual(recurring.advance(date(2026, 1, 1), frequency="weekly", interval=2, anchor_day=1), date(2026, 1, 15))

    def test_a_past_start_begins_at_the_next_date_not_a_backlog(self):
        profile = self.profile(start_date="2026-06-09")
        self.assertEqual(profile.next_run_date, TODAY)
        profile = self.profile(start_date="2026-06-10")
        self.assertEqual(profile.next_run_date, date(2026, 10, 10))

    def test_the_scan_makes_a_draft_and_moves_on(self):
        profile = self.profile(start_date="2026-10-09")
        result = recurring.scan_due(self.db, today=TODAY)
        self.assertEqual(result, {"made": 1, "failed": 0})
        invoice = self.db.query(FinancePosInvoice).filter(FinancePosInvoice.recurring_invoice_id == profile.id).one()
        self.assertEqual(invoice.status, "draft")
        self.assertEqual(Decimal(invoice.total_amount), Decimal("500"))
        self.assertEqual(invoice.customer_organization_id, 5)
        self.db.refresh(profile)
        self.assertEqual(profile.issued_count, 1)
        self.assertEqual(profile.next_run_date, date(2026, 11, 9))
        self.assertEqual(recurring.scan_due(self.db, today=TODAY), {"made": 0, "failed": 0})

    def test_issue_and_send_issues_and_emails_with_the_pdf(self):
        profile = self.profile(start_date="2026-10-09", action="issue_and_send")
        with patch("app.modules.mail.services.tenant_mail.send_system_message") as send:
            recurring.scan_due(self.db, today=TODAY)
        invoice = self.db.query(FinancePosInvoice).filter(FinancePosInvoice.recurring_invoice_id == profile.id).one()
        self.assertEqual(invoice.status, "issued")
        self.assertTrue(invoice.invoice_number)
        send.assert_called_once()
        self.assertEqual(send.call_args.kwargs["recipient"], "ap@acme.test")
        self.assertEqual(send.call_args.kwargs["attachment"][2], "application/pdf")
        self.assertIn(invoice.invoice_number, send.call_args.kwargs["body"])

    def test_a_failed_send_leaves_the_invoice_issued_and_says_why(self):
        profile = self.profile(start_date="2026-10-09", action="issue_and_send")
        with patch("app.modules.mail.services.tenant_mail.send_system_message", side_effect=ValueError("Configure the workspace email sender")):
            recurring.scan_due(self.db, today=TODAY)
        self.db.refresh(profile)
        self.assertIn("issued but not emailed", profile.last_error)
        self.assertEqual(profile.issued_count, 1)

    def test_a_count_limit_finishes_the_profile(self):
        profile = self.profile(start_date="2026-10-09", max_count=1)
        recurring.scan_due(self.db, today=TODAY)
        self.db.refresh(profile)
        self.assertFalse(profile.active)
        self.assertIsNone(profile.next_run_date)

    def test_bad_lines_are_refused_when_saved(self):
        with self.assertRaises(HTTPException):
            self.profile(lines=[{"description": "Retainer", "quantity": "0", "unit_price": "500"}])
        with self.assertRaises(HTTPException):
            self.profile(lines=[])

    def test_make_recurring_copies_the_invoice(self):
        invoice = self.invoice(total="80")
        draft = recurring.draft_from_invoice(self.db, self.user, invoice.id)
        self.assertEqual(draft["customer_organization_id"], 5)
        self.assertEqual(draft["lines"][0]["description"], "Service")
        self.assertEqual(draft["source_invoice_id"], invoice.id)


class ReminderTests(ReceivablesFixture):
    def rule(self, offset, active=True):
        rule = FinanceReminderRule(tenant_id=TENANT, name=f"Day {offset}", days_offset=offset, subject="Invoice {{document.number}}",
                                   body="Hello {{contact.first_name}}, {{document.balance_due}} is due.", attach_pdf=False, active=active)
        self.db.add(rule)
        self.db.commit()
        return rule

    def scan(self, today):
        with patch("app.modules.mail.services.tenant_mail.get_settings", return_value=object()), \
                patch("app.modules.mail.services.tenant_mail.send_system_message") as send:
            result = receivables.scan_reminders(self.db, today=today)
        return result, send

    def test_seeded_rules_start_inactive(self):
        receivables.ensure_default_reminder_rules(self.db, TENANT)
        rules = self.db.query(FinanceReminderRule).all()
        self.assertEqual(sorted(rule.days_offset for rule in rules), [-3, 1, 7])
        self.assertFalse(any(rule.active for rule in rules))

    def test_one_reminder_per_rule_per_invoice(self):
        invoice = self.invoice(issue_date=TODAY - timedelta(days=31), due_date=TODAY - timedelta(days=1))
        rule = self.rule(1)
        result, send = self.scan(TODAY)
        self.assertEqual(result["sent"], 1)
        self.assertEqual(send.call_args.kwargs["recipient"], "ap@acme.test")
        self.assertIn(invoice.invoice_number, send.call_args.kwargs["subject"])
        result, _send = self.scan(TODAY + timedelta(days=1))
        self.assertEqual(result["sent"], 0)
        self.assertEqual(self.db.query(FinanceReminderSend).filter(FinanceReminderSend.rule_id == rule.id).count(), 1)
        self.assertIn("invoice.reminder_sent", [row.action for row in self.db.query(ActivityLog).filter(ActivityLog.entity_id == invoice.id)])

    def test_inactive_rules_paid_invoices_and_opted_out_accounts_get_nothing(self):
        self.rule(1, active=False)
        self.invoice(issue_date=TODAY - timedelta(days=31), due_date=TODAY - timedelta(days=1))
        self.assertEqual(self.scan(TODAY)[0]["sent"], 0)
        self.rule(1)
        paid = self.invoice(issue_date=TODAY - timedelta(days=31), due_date=TODAY - timedelta(days=1), total="10")
        self.pay(paid, "10", TODAY)
        self.invoice(org_id=6, issue_date=TODAY - timedelta(days=31), due_date=TODAY - timedelta(days=1))
        result, send = self.scan(TODAY)
        self.assertEqual(result["sent"], 1)
        self.assertEqual(send.call_args.kwargs["recipient"], "ap@acme.test")

    def test_a_before_due_rule_never_reaches_an_overdue_invoice(self):
        self.rule(-3)
        self.invoice(issue_date=TODAY - timedelta(days=31), due_date=TODAY - timedelta(days=1))
        due_soon = self.invoice(issue_date=TODAY, due_date=TODAY + timedelta(days=3))
        result, send = self.scan(TODAY)
        self.assertEqual(result["sent"], 1)
        self.assertIn(due_soon.invoice_number, send.call_args.kwargs["subject"])

    def test_no_workspace_sender_skips_without_recording(self):
        self.rule(1)
        self.invoice(issue_date=TODAY - timedelta(days=31), due_date=TODAY - timedelta(days=1))
        with patch("app.modules.mail.services.tenant_mail.get_settings", return_value=None):
            result = receivables.scan_reminders(self.db, today=TODAY)
        self.assertEqual(result, {"sent": 0, "skipped": 0, "failed": 0})
        self.assertEqual(self.db.query(FinanceReminderSend).count(), 0)


class WriteOffTests(ReceivablesFixture):
    def test_a_small_balance_is_written_off_and_reads_paid(self):
        invoice = self.invoice(total="100")
        self.pay(invoice, "97", TODAY)
        receivables.write_off_invoice(self.db, invoice=invoice, actor_user_id=1, reason="Bank charges", may_exceed_limit=False)
        self.db.commit()
        self.assertEqual(Decimal(invoice.balance_due), Decimal("0"))
        self.assertEqual(Decimal(invoice.amount_written_off), Decimal("3"))
        self.assertEqual(invoice.payment_status, "paid")

    def test_above_the_limit_needs_configure(self):
        invoice = self.invoice(total="100")
        with self.assertRaises(HTTPException) as caught:
            receivables.write_off_invoice(self.db, invoice=invoice, actor_user_id=1, reason="Disputed", may_exceed_limit=False)
        self.assertEqual(caught.exception.status_code, 403)
        receivables.write_off_invoice(self.db, invoice=invoice, actor_user_id=1, reason="Disputed", may_exceed_limit=True)
        self.assertEqual(Decimal(invoice.balance_due), Decimal("0"))

    def test_a_written_off_invoice_cannot_be_voided_until_reversed(self):
        invoice = self.invoice(total="4")
        row = receivables.write_off_invoice(self.db, invoice=invoice, actor_user_id=1, reason="Rounding", may_exceed_limit=False)
        self.db.commit()
        with self.assertRaises(HTTPException):
            pos_invoice_services.void_invoice(self.db, self.user, invoice.id, reason="Wrong customer")
        self.db.rollback()
        receivables.reverse_write_off(self.db, invoice=invoice, write_off_id=row.id, actor_user_id=1)
        self.db.commit()
        self.assertEqual(Decimal(invoice.balance_due), Decimal("4"))


class StatementTests(ReceivablesFixture):
    def test_activity_statement_runs_from_the_opening_balance(self):
        september = self.invoice(total="100", issue_date=date(2026, 9, 10), due_date=date(2026, 9, 20))
        self.pay(september, "40", date(2026, 9, 25))
        october = self.invoice(total="50", issue_date=date(2026, 10, 2), due_date=date(2026, 10, 30))
        self.pay(september, "60", date(2026, 10, 5))
        statement = receivables.customer_statement(self.db, tenant_id=TENANT, org_id=5, start=date(2026, 10, 1), end=date(2026, 10, 31))
        self.assertEqual(statement["opening_balance"], Decimal("60"))
        self.assertEqual([row["type"] for row in statement["entries"]], ["Invoice", "Payment"])
        self.assertEqual(statement["closing_balance"], Decimal("50"))
        self.assertEqual(statement["entries"][-1]["balance"], Decimal("50"))
        self.assertEqual(october.invoice_number, statement["entries"][0]["number"])

    def test_open_statement_lists_unpaid_invoices_with_ageing(self):
        self.invoice(total="100", issue_date=date(2026, 7, 1), due_date=date(2026, 7, 31))
        self.invoice(total="20", issue_date=TODAY, due_date=TODAY + timedelta(days=30))
        statement = receivables.customer_statement(self.db, tenant_id=TENANT, org_id=5, kind="open")
        self.assertEqual(len(statement["invoices"]), 2)
        self.assertEqual(statement["closing_balance"], Decimal("120"))
        ageing = {row["key"]: row["amount"] for row in statement["ageing"]}
        self.assertEqual(ageing["current"], Decimal("20"))
        self.assertEqual(sum(ageing.values()), Decimal("120"))

    def test_another_workspace_account_is_not_found(self):
        with self.assertRaises(HTTPException) as caught:
            receivables.customer_statement(self.db, tenant_id=99, org_id=5)
        self.assertEqual(caught.exception.status_code, 404)

    def test_the_statement_renders_as_a_document(self):
        self.invoice(total="100", issue_date=date(2026, 10, 2))
        statement = receivables.customer_statement(self.db, tenant_id=TENANT, org_id=5, start=date(2026, 10, 1), end=date(2026, 10, 31))
        html = receivables.statement_html(self.db, tenant_id=TENANT, statement=statement)
        self.assertIn("Statement of account", html)
        self.assertIn("Opening balance", html)
        self.assertIn("100.00", html)


if __name__ == "__main__":
    unittest.main()
