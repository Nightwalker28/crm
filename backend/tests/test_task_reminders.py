import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.platform.models import CrmEvent
from app.modules.sales.models import SalesContact, SalesOpportunity
from app.modules.sales.services import reminder_scans
from app.modules.tasks.models import Task, TaskAssignee
from app.modules.tasks.services import tasks_services
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import User, UserStatus


class TaskDueAlertScanTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.now = datetime(2026, 5, 4, 10, 0, tzinfo=timezone.utc)
        self.db.add_all(
            [
                User(
                    id=1,
                    tenant_id=10,
                    email="creator@example.com",
                    first_name="Casey",
                    last_name="Creator",
                    is_active=UserStatus.active,
                ),
                User(
                    id=2,
                    tenant_id=10,
                    email="owner@example.com",
                    first_name="Owner",
                    last_name="User",
                    is_active=UserStatus.active,
                ),
                Task(
                    id=1,
                    tenant_id=10,
                    title="Call buyer",
                    status="todo",
                    priority="high",
                    due_at=self.now + timedelta(hours=2),
                    created_by_user_id=1,
                    updated_by_user_id=1,
                    assigned_by_user_id=1,
                ),
                TaskAssignee(
                    id=1,
                    tenant_id=10,
                    task_id=1,
                    assignee_type="user",
                    assignee_key="user:2",
                    user_id=2,
                ),
                Task(
                    id=2,
                    tenant_id=10,
                    title="Tomorrow task",
                    status="todo",
                    priority="medium",
                    due_at=self.now + timedelta(days=1),
                    created_by_user_id=1,
                    updated_by_user_id=1,
                ),
                Task(
                    id=3,
                    tenant_id=10,
                    title="Completed task",
                    status="completed",
                    priority="medium",
                    due_at=self.now + timedelta(hours=3),
                    created_by_user_id=1,
                    updated_by_user_id=1,
                ),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_scan_due_task_alerts_emits_once_for_open_tasks_due_today(self):
        with patch.object(tasks_services, "safe_emit_crm_event", return_value=SimpleNamespace(id=10)) as event_mock, \
             patch.object(tasks_services, "create_notification") as notification_mock:
            result = tasks_services.scan_due_task_alerts(self.db, now=self.now)

        self.assertEqual(result["due_tasks"], 1)
        self.assertEqual(result["alerts_created"], 1)
        self.assertEqual(result["notifications_created"], 1)
        event_mock.assert_called_once()
        event_kwargs = event_mock.call_args.kwargs
        self.assertEqual(event_kwargs["event_type"], "task.due_today")
        self.assertEqual(event_kwargs["entity_id"], 1)
        self.assertEqual(event_kwargs["payload"]["task_title"], "Call buyer")
        notification_mock.assert_called_once()
        notification_kwargs = notification_mock.call_args.kwargs
        self.assertEqual(notification_kwargs["user_id"], 2)
        self.assertEqual(notification_kwargs["category"], tasks_services.TASK_DUE_TODAY_NOTIFICATION_CATEGORY)

    def test_scan_due_task_alerts_skips_task_already_alerted_today(self):
        self.db.add(
            CrmEvent(
                id=1,
                tenant_id=10,
                event_type="task.due_today",
                entity_type="task",
                entity_id="1",
                created_at=self.now.replace(hour=1),
            )
        )
        self.db.commit()

        with patch.object(tasks_services, "safe_emit_crm_event") as event_mock, \
             patch.object(tasks_services, "create_notification") as notification_mock:
            result = tasks_services.scan_due_task_alerts(self.db, now=self.now)

        self.assertEqual(result["due_tasks"], 1)
        self.assertEqual(result["alerts_created"], 0)
        self.assertEqual(result["notifications_created"], 0)
        event_mock.assert_not_called()
        notification_mock.assert_not_called()


class FollowUpReminderScanTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.now = datetime(2026, 5, 4, 10, 0, tzinfo=timezone.utc)
        self.db.add_all(
            [
                User(
                    id=1,
                    tenant_id=10,
                    email="owner@example.com",
                    first_name="Owner",
                    last_name="User",
                    is_active=UserStatus.active,
                ),
                SalesContact(
                    contact_id=7,
                    tenant_id=10,
                    first_name="Stale",
                    last_name="Contact",
                    primary_email="stale@example.com",
                    assigned_to=1,
                    last_contacted_at=self.now - timedelta(days=4),
                ),
                SalesContact(
                    contact_id=8,
                    tenant_id=10,
                    first_name="Fresh",
                    last_name="Contact",
                    primary_email="fresh@example.com",
                    assigned_to=1,
                    last_contacted_at=self.now - timedelta(days=1),
                ),
                SalesOpportunity(
                    opportunity_id=11,
                    tenant_id=10,
                    opportunity_name="Stale deal",
                    client="Stale Contact",
                    sales_stage="proposal",
                    assigned_to=1,
                    last_contacted_at=self.now - timedelta(days=20),
                ),
                SalesOpportunity(
                    opportunity_id=12,
                    tenant_id=10,
                    opportunity_name="Closed deal",
                    client="Closed Contact",
                    sales_stage="closed_won",
                    assigned_to=1,
                    last_contacted_at=self.now - timedelta(days=20),
                ),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_scan_follow_up_reminders_creates_source_linked_tasks_for_stale_records(self):
        with patch.object(reminder_scans, "_create_source_linked_reminder_task") as create_mock:
            result = reminder_scans.scan_follow_up_reminders(
                self.db,
                now=self.now,
                no_reply_days=3,
                inactive_deal_days=14,
            )

        self.assertEqual(result["contacts_checked"], 1)
        self.assertEqual(result["contact_tasks_created"], 1)
        self.assertEqual(result["opportunities_checked"], 1)
        self.assertEqual(result["opportunity_tasks_created"], 1)
        self.assertEqual(create_mock.call_count, 2)
        contact_call = create_mock.call_args_list[0].kwargs
        self.assertEqual(contact_call["source_module_key"], "sales_contacts")
        self.assertEqual(contact_call["source_entity_id"], "7")
        self.assertEqual(contact_call["assigned_to_user_id"], 1)
        opportunity_call = create_mock.call_args_list[1].kwargs
        self.assertEqual(opportunity_call["source_module_key"], "sales_opportunities")
        self.assertEqual(opportunity_call["source_entity_id"], "11")

    def test_scan_follow_up_reminders_skips_records_with_open_reminder_task(self):
        self.db.add(
            Task(
                id=20,
                tenant_id=10,
                title="No reply follow-up: Stale Contact",
                status="todo",
                priority="medium",
                source_module_key="sales_contacts",
                source_entity_id="7",
                created_by_user_id=1,
                updated_by_user_id=1,
            )
        )
        self.db.commit()

        with patch.object(reminder_scans, "_create_source_linked_reminder_task") as create_mock:
            result = reminder_scans.scan_follow_up_reminders(
                self.db,
                now=self.now,
                no_reply_days=3,
                inactive_deal_days=14,
            )

        self.assertEqual(result["contacts_checked"], 1)
        self.assertEqual(result["contact_tasks_created"], 0)
        self.assertEqual(result["opportunity_tasks_created"], 1)
        self.assertEqual(create_mock.call_count, 1)
        self.assertEqual(create_mock.call_args.kwargs["source_module_key"], "sales_opportunities")


if __name__ == "__main__":
    unittest.main()
