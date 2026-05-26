import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from app.modules.sales.services import followups


class SalesFollowUpTests(unittest.TestCase):
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
        self.assertEqual(log_activity.call_args_list[0].kwargs["module_key"], "sales_quotes")
        self.assertEqual(log_activity.call_args_list[0].kwargs["action"], "follow_up.email")
        self.assertEqual(log_activity.call_args_list[2].kwargs["module_key"], "sales_quotes")
        self.assertEqual(log_activity.call_args_list[2].kwargs["entity_type"], "sales_quote")
        self.assertEqual(log_activity.call_args_list[2].kwargs["action"], "task.follow_up_created")


if __name__ == "__main__":
    unittest.main()
