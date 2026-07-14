import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock, patch

from app.modules.sales.services import followups


class SalesFollowUpTests(unittest.TestCase):
    def test_lead_follow_up_synchronizes_next_follow_up_date_with_reminder(self):
        db = Mock()
        current_user = SimpleNamespace(id=7, tenant_id=11)
        lead = SimpleNamespace(
            lead_id=24,
            first_name="Ada",
            last_name="Lovelace",
            primary_email="ada@example.com",
            next_follow_up_at=None,
        )
        task = SimpleNamespace(id=100, title="Follow up with Ada Lovelace")
        contacted_at = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)
        due_at = datetime(2026, 7, 15, 10, 0, tzinfo=timezone.utc)

        with (
            patch.object(followups, "_utcnow", return_value=contacted_at),
            patch.object(followups, "_require_task_create_access"),
            patch.object(followups, "create_task", return_value=(task, ["user:7"])),
            patch.object(followups, "create_task_assignment_notifications"),
            patch.object(followups, "serialize_task", return_value={"id": 100, "title": task.title}),
            patch.object(followups, "log_activity"),
        ):
            result = followups.log_lead_follow_up(
                db,
                lead=lead,
                payload={
                    "channel": "email",
                    "note": None,
                    "create_follow_up_task": True,
                    "follow_up_due_at": due_at,
                },
                current_user=current_user,
            )

        self.assertEqual(lead.last_contacted_at, contacted_at)
        self.assertEqual(lead.next_follow_up_at, due_at)
        self.assertEqual(result["next_follow_up_at"], due_at)
        self.assertEqual(result["follow_up_task_id"], 100)
        db.commit.assert_called_once()
        db.rollback.assert_not_called()

    def test_quote_follow_up_logs_activity_and_source_linked_task(self):
        db = Mock()
        current_user = SimpleNamespace(id=7, tenant_id=11)
        quote = SimpleNamespace(quote_id=42, quote_number="Q-1042", title="Expansion")
        task = SimpleNamespace(id=99, title="Follow up with Q-1042")

        with (
            patch.object(followups, "_utcnow", return_value=SimpleNamespace(isoformat=lambda: "2026-05-26T10:00:00+00:00")),
            patch.object(followups, "_require_task_create_access"),
            patch.object(followups, "create_task", return_value=(task, ["user:7"])) as create_task,
            patch.object(followups, "create_task_assignment_notifications") as notify,
            patch.object(followups, "serialize_task", return_value={"id": 99, "title": task.title}),
            patch.object(followups, "log_activity") as log_activity,
        ):
            result = followups.log_quote_follow_up(
                db,
                quote=quote,
                payload={
                    "channel": "email",
                    "note": "Check whether the client approved pricing.",
                    "create_follow_up_task": True,
                    "follow_up_due_at": "2026-05-27T10:00:00+00:00",
                },
                current_user=current_user,
            )

        self.assertEqual(result["module_key"], "sales_quotes")
        self.assertEqual(result["entity_id"], "42")
        self.assertEqual(result["follow_up_task_id"], 99)
        create_task.assert_called_once()
        task_payload = create_task.call_args.kwargs["payload"]
        self.assertEqual(task_payload["source_module_key"], "sales_quotes")
        self.assertEqual(task_payload["source_entity_id"], "42")
        self.assertEqual(task_payload["source_label"], "Q-1042")
        notify.assert_called_once()
        self.assertFalse(create_task.call_args.kwargs["commit"])
        self.assertFalse(notify.call_args.kwargs["commit"])
        db.commit.assert_called_once()
        db.rollback.assert_not_called()
        self.assertEqual(log_activity.call_args_list[0].kwargs["module_key"], "sales_quotes")
        self.assertEqual(log_activity.call_args_list[0].kwargs["action"], "follow_up.email")
        self.assertFalse(log_activity.call_args_list[0].kwargs["commit"])
        self.assertEqual(log_activity.call_args_list[2].kwargs["module_key"], "sales_quotes")
        self.assertEqual(log_activity.call_args_list[2].kwargs["entity_type"], "sales_quote")
        self.assertEqual(log_activity.call_args_list[2].kwargs["action"], "task.follow_up_created")
        self.assertFalse(log_activity.call_args_list[2].kwargs["commit"])


if __name__ == "__main__":
    unittest.main()
