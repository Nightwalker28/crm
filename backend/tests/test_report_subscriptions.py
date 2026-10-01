"""Schedules stay tenant-owned and sends recheck the subscriber's access."""

import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from app.modules.platform.models import ReportSubscription, ReportSubscriptionDelivery
from app.modules.platform.services import module_reports, report_dashboards, report_subscriptions
from app.modules.platform.services import data_transfer_jobs
from app.modules.mail.services import tenant_mail
from app.modules.user_management.models import User, UserStatus
from tests.test_report_engine import ReportFixture, _summary


class ScheduleTimeTests(unittest.TestCase):
    def test_weekly_schedule_uses_local_zone(self):
        after = datetime(2026, 10, 1, 0, 0, tzinfo=timezone.utc)
        next_send = report_subscriptions.next_run(frequency="weekly", hour=9, minute=0, weekday=4, day_of_month=None, timezone_name="Asia/Colombo", after=after)
        self.assertEqual(next_send.isoformat(), "2026-10-02T03:30:00+00:00")

    def test_nonexistent_dst_time_is_skipped(self):
        after = datetime(2026, 3, 7, 0, 0, tzinfo=timezone.utc)
        next_send = report_subscriptions.next_run(frequency="daily", hour=2, minute=30, weekday=None, day_of_month=None, timezone_name="America/New_York", after=after)
        self.assertEqual(next_send.astimezone(report_subscriptions._zone("America/New_York")).day, 7)
        following = report_subscriptions.next_run(frequency="daily", hour=2, minute=30, weekday=None, day_of_month=None, timezone_name="America/New_York", after=next_send)
        self.assertEqual(following.astimezone(report_subscriptions._zone("America/New_York")).day, 9)


class SubscriptionTests(ReportFixture):
    def setUp(self):
        super().setUp()
        self.user = self.db.query(User).filter(User.id == 1).one()
        self.deal("lead", value="100")
        self.report = module_reports.create_saved_report(self.db, self.user, module_key="sales_opportunities", name="My pipeline", config=_summary([{"field": "sales_stage"}]))

    def save(self):
        with patch.object(report_subscriptions, "get_settings", return_value=object()):
            return report_subscriptions.save_subscription(
                self.db, self.user, target_type="report", target_id=self.report["id"], frequency="daily",
                hour=9, minute=0, weekday=None, day_of_month=None, timezone_name="UTC", is_active=True,
            )

    def test_sender_must_be_configured(self):
        with self.assertRaises(HTTPException) as caught:
            report_subscriptions.save_subscription(self.db, self.user, target_type="report", target_id=self.report["id"], frequency="daily", hour=9, minute=0, weekday=None, day_of_month=None, timezone_name="UTC", is_active=True)
        self.assertEqual(caught.exception.status_code, 409)

    def test_target_must_be_visible_in_own_tenant(self):
        with patch.object(report_subscriptions, "get_settings", return_value=object()):
            with self.assertRaises(HTTPException):
                report_subscriptions.save_subscription(self.db, self.user, target_type="report", target_id=999999, frequency="daily", hour=9, minute=0, weekday=None, day_of_month=None, timezone_name="UTC", is_active=True)

    def test_due_scan_claims_once_and_sends_as_subscriber(self):
        saved = self.save()
        with patch.object(report_subscriptions, "send_system_message") as send, patch.object(report_subscriptions, "require_department_module_access"), patch.object(report_subscriptions, "require_role_module_action_access"):
            now = saved["next_run_at"]
            self.assertEqual(report_subscriptions.scan_due(self.db, now=now), 1)
            self.assertEqual(report_subscriptions.scan_due(self.db, now=now), 0)
        send.assert_called_once()
        self.assertEqual(send.call_args.kwargs["recipient"], self.user.email)
        self.assertEqual(self.db.query(ReportSubscriptionDelivery).count(), 1)

    def test_send_fails_closed_after_subscriber_is_disabled(self):
        saved = self.save()
        self.user.is_active = UserStatus.inactive
        self.db.commit()
        with patch.object(report_subscriptions, "send_system_message") as send:
            report_subscriptions.scan_due(self.db, now=saved["next_run_at"])
        send.assert_not_called()
        row = self.db.query(ReportSubscription).filter(ReportSubscription.id == saved["id"]).one()
        self.assertEqual(row.last_status, "failed")

    def test_scan_recovers_a_queued_delivery_without_sending_twice(self):
        saved = self.save()
        queued = ReportSubscriptionDelivery(tenant_id=self.user.tenant_id, subscription_id=saved["id"], scheduled_for=saved["next_run_at"], status="queued")
        self.db.add(queued)
        self.db.commit()
        before_due = saved["next_run_at"].replace(year=2025)
        with patch.object(report_subscriptions, "send_system_message") as send, patch.object(report_subscriptions, "require_department_module_access"), patch.object(report_subscriptions, "require_role_module_action_access"):
            self.assertEqual(report_subscriptions.scan_due(self.db, now=before_due), 0)
            self.assertEqual(report_subscriptions.scan_due(self.db, now=before_due), 0)
        send.assert_called_once()

    def test_workspace_sender_keeps_secret_out_of_settings_response(self):
        with patch.object(tenant_mail, "encrypt_application_secret", return_value=SimpleNamespace(ciphertext="encrypted", key_version="v1")):
            summary = tenant_mail.save_settings(
                self.db, self.user.tenant_id, actor_user_id=self.user.id,
                sender_email=" Reports@Example.com ", smtp_host="smtp.example.com", smtp_port=587,
                smtp_security="starttls", smtp_username="reports", password="private-password",
            )
        self.assertEqual(summary["sender_email"], "reports@example.com")
        self.assertNotIn("password", summary)
        client = MagicMock()
        with patch.object(tenant_mail, "decrypt_application_secret", return_value="private-password"), patch.object(tenant_mail, "_connect_smtp", return_value=client):
            tenant_mail.send_system_message(self.db, tenant_id=self.user.tenant_id, recipient=self.user.email, subject="Report", body="Ready")
        client.login.assert_called_once_with("reports", "private-password")
        self.assertEqual(client.send_message.call_args.args[0]["To"], self.user.email)

    def test_dashboard_email_applies_its_date_filter_to_default_date_field(self):
        dashboard = report_dashboards.create_dashboard(
            self.db, self.user, name="Sales", widgets=[{"id": "pipeline", "type": "kpi", "size": "small", "report_id": self.report["id"]}],
            filters={"date_range": "this_month", "scope": "mine"},
        )
        row = ReportSubscription(tenant_id=self.user.tenant_id, user_id=self.user.id, target_type="dashboard", target_id=dashboard["id"])
        with patch.object(report_subscriptions.report_engine, "run_report", return_value={"totals": {"count": 2}}) as run:
            title, body, attachment = report_subscriptions._message(self.db, self.user, row)
        self.assertEqual(title, "Sales")
        self.assertIn("2 records", body)
        self.assertIsNone(attachment)
        self.assertEqual(run.call_args.kwargs["config"]["date_filter"], {"field": "expected_close_date", "range": "this_month"})
        self.assertEqual(run.call_args.kwargs["config"]["scope"], "mine")

    def test_report_job_download_rechecks_report_and_source_access(self):
        job = SimpleNamespace(operation_type="report_export", module_key="reports", payload={"source_module_key": "sales_opportunities"})
        with patch.object(data_transfer_jobs, "require_data_transfer_module_access") as access:
            data_transfer_jobs.require_data_transfer_job_access(self.db, current_user=self.user, job=job, action="export")
        self.assertEqual([(call.kwargs["module_key"], call.kwargs["action"]) for call in access.call_args_list], [("reports", "export"), ("sales_opportunities", "view")])
