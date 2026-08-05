import json
import unittest
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from enum import Enum
from types import SimpleNamespace
from unittest.mock import patch
from uuid import UUID

from sqlalchemy.exc import OperationalError

from app.core.job_errors import CALENDAR_SYNC_SAFE_ERROR, safe_data_transfer_error
from app.core.json_serialization import JsonSerializationError, to_json_safe
from app.modules.platform.models import DataTransferJob, UserNotification
from app.modules.platform.schema import DataTransferJobResponse, UserNotificationResponse
from app.modules.platform.services.data_transfer_jobs import mark_job_completed, mark_job_failed
from app.modules.calendar.services import calendar_services
from app.modules.platform.services import data_transfer_jobs
from app.modules.platform.services.notifications import create_notification


class ExampleStatus(Enum):
    ready = "ready"


class StringStatus(str, Enum):
    ready = "ready"


class FakeDB:
    def __init__(self):
        self.added = []
        self.commits = 0
        self.rollbacks = 0

    def add(self, item):
        self.added.append(item)

    def commit(self):
        self.commits += 1

    def refresh(self, _item):
        return None

    def rollback(self):
        self.rollbacks += 1


class FakeSessionContext:
    def __init__(self, db):
        self.db = db

    def __enter__(self):
        return self.db

    def __exit__(self, _exc_type, _exc, _traceback):
        return False


def _job(**overrides):
    values = {
        "id": 11,
        "tenant_id": 10,
        "actor_user_id": None,
        "module_key": "calendar",
        "operation_type": "sync",
        "status": "running",
        "mode": "background",
        "summary": None,
        "result_file_path": None,
        "result_file_name": None,
        "result_media_type": None,
        "error_message": None,
        "progress_percent": 50,
        "progress_message": "Running.",
        "started_at": None,
        "completed_at": None,
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class JsonJobSerializationTests(unittest.TestCase):
    def test_database_operational_failures_are_retried_by_background_jobs(self):
        self.assertIn(OperationalError, data_transfer_jobs.TRANSIENT_JOB_ERRORS)

    def test_nested_supported_values_are_strict_json_and_datetimes_are_utc(self):
        source_datetime = datetime(2026, 8, 5, 18, 30, tzinfo=timezone(timedelta(hours=5, minutes=30)))
        identifier = UUID("12345678-1234-5678-1234-567812345678")

        result = to_json_safe(
            {
                "sync": {"completed_at": source_datetime, "day": date(2026, 8, 5)},
                "provider_id": identifier,
                "status": ExampleStatus.ready,
                "string_status": StringStatus.ready,
                "amount": Decimal("10.50"),
            }
        )

        self.assertEqual(result["sync"]["completed_at"], "2026-08-05T13:00:00+00:00")
        self.assertEqual(result["sync"]["day"], "2026-08-05")
        self.assertEqual(result["provider_id"], str(identifier))
        self.assertEqual(result["status"], "ready")
        self.assertIs(type(result["string_status"]), str)
        self.assertEqual(result["amount"], "10.50")
        json.dumps(result, allow_nan=False)

    def test_unsupported_objects_are_rejected_instead_of_stringified(self):
        with self.assertRaises(JsonSerializationError):
            to_json_safe({"provider": object()})

    def test_completion_serializes_calendar_summary_before_json_assignment(self):
        db = FakeDB()
        job = _job()

        mark_job_completed(
            db,
            job,
            summary={"provider": "google", "nested": {"last_synced_at": datetime.now(timezone.utc)}},
        )

        self.assertEqual(job.status, "completed")
        self.assertIsInstance(job.summary["nested"]["last_synced_at"], str)
        json.dumps(job.summary, allow_nan=False)
        self.assertEqual(db.commits, 1)

    def test_data_transfer_model_serializes_direct_payload_and_summary_assignments(self):
        now = datetime.now(timezone.utc)
        job = DataTransferJob(
            tenant_id=10,
            module_key="calendar",
            operation_type="sync",
            payload={"requested_at": now},
        )

        job.summary = {"completed_at": now}

        self.assertEqual(job.payload["requested_at"], now.isoformat())
        self.assertEqual(job.summary["completed_at"], now.isoformat())

    def test_failure_persistence_and_api_response_hide_technical_error(self):
        db = FakeDB()
        job = _job()
        raw_error = "(sqlalchemy.exc.StatementError) UPDATE data_transfer_jobs SET summary=%(summary)s"

        mark_job_failed(db, job, error_message=raw_error)
        job.completed_at = datetime.now(timezone.utc)
        response = DataTransferJobResponse.model_validate(job)

        self.assertEqual(job.error_message, raw_error)
        self.assertEqual(response.error_message, CALENDAR_SYNC_SAFE_ERROR)
        self.assertNotIn("UPDATE", response.error_message)
        self.assertNotIn("data_transfer_jobs", response.error_message)

    def test_calendar_job_success_persists_datetime_summary(self):
        db = FakeDB()
        job = _job()
        actor = SimpleNamespace(id=7, tenant_id=10)
        summary = {
            "provider": "google",
            "last_synced_at": datetime(2026, 8, 5, 12, 30, tzinfo=timezone.utc),
        }

        with patch.object(calendar_services, "SessionLocal", return_value=FakeSessionContext(db)), \
             patch.object(data_transfer_jobs, "get_data_transfer_job_or_404", return_value=job), \
             patch.object(calendar_services.calendar_repository, "get_sync_job_actor", return_value=actor), \
             patch.object(calendar_services, "sync_current_user_calendar", return_value=summary):
            calendar_services.process_calendar_sync_job(job_id=job.id)

        self.assertEqual(job.status, "completed")
        self.assertEqual(job.summary["last_synced_at"], "2026-08-05T12:30:00+00:00")

    def test_notification_persistence_failure_does_not_reverse_completed_job(self):
        db = FakeDB()
        job = _job(actor_user_id=7)

        with patch.object(data_transfer_jobs, "_notify_job_state", side_effect=RuntimeError("notification insert failed")), \
             self.assertLogs(data_transfer_jobs.logger, level="ERROR") as logs:
            mark_job_completed(db, job, summary={"completed_at": datetime.now(timezone.utc)})

        self.assertEqual(job.status, "completed")
        self.assertEqual(db.commits, 1)
        self.assertEqual(db.rollbacks, 1)
        self.assertTrue(any("notification creation failed" in message for message in logs.output))

    def test_terminal_job_cannot_receive_contradictory_notifications(self):
        db = FakeDB()
        job = _job(actor_user_id=7)

        with patch.object(data_transfer_jobs, "_notify_job_state") as notify:
            mark_job_completed(db, job, summary={"synced": 2})
            mark_job_failed(db, job, error_message="late SQL persistence error")

        self.assertEqual(job.status, "completed")
        self.assertIsNone(job.error_message)
        self.assertEqual(notify.call_count, 1)
        self.assertIn("completed", notify.call_args.kwargs["title"].lower())

    def test_job_commit_failure_does_not_emit_success_notification(self):
        db = FakeDB()
        job = _job(actor_user_id=7)

        def fail_commit():
            raise RuntimeError("database unavailable")

        db.commit = fail_commit
        with patch.object(data_transfer_jobs, "_notify_job_state") as notify, self.assertRaisesRegex(RuntimeError, "database unavailable"):
            mark_job_completed(db, job, summary={"completed_at": datetime.now(timezone.utc)})

        notify.assert_not_called()
        self.assertEqual(db.rollbacks, 1)

    def test_notification_metadata_uses_same_json_safe_boundary(self):
        db = FakeDB()
        synced_at = datetime(2026, 8, 5, 18, 30, tzinfo=timezone(timedelta(hours=5, minutes=30)))

        notification = create_notification(
            db,
            tenant_id=10,
            user_id=7,
            category="data_transfer",
            title="Sync completed",
            message="Calendar sync completed successfully.",
            metadata={"nested": {"last_synced_at": synced_at}},
            commit=False,
        )

        self.assertEqual(notification.payload["nested"]["last_synced_at"], "2026-08-05T13:00:00+00:00")
        json.dumps(notification.payload, allow_nan=False)

    def test_notification_model_serializes_direct_metadata_assignment(self):
        now = datetime.now(timezone.utc)
        notification = UserNotification(
            tenant_id=10,
            user_id=7,
            category="data_transfer",
            title="Sync completed",
            message="Calendar sync completed successfully.",
            payload={"completed_at": now},
        )

        self.assertEqual(notification.payload["completed_at"], now.isoformat())

    def test_generic_job_types_receive_safe_user_messages(self):
        self.assertEqual(
            safe_data_transfer_error(module_key="sales_leads", operation_type="import"),
            "Import could not be completed. Try again.",
        )
        self.assertEqual(
            safe_data_transfer_error(module_key="sales_leads", operation_type="export"),
            "Export could not be completed. Try again.",
        )

    def test_historical_failure_notification_is_sanitized_on_response(self):
        now = datetime.now(timezone.utc)
        notification = SimpleNamespace(
            id=1,
            user_id=7,
            category="data_transfer",
            title="Sync failed",
            message="TypeError SQL UPDATE data_transfer_jobs SET summary=%(summary)s oauth_token=secret",
            status="unread",
            link_url="/dashboard/calendar",
            payload={"module_key": "calendar", "operation_type": "sync"},
            read_at=None,
            created_at=now,
            updated_at=now,
        )

        response = UserNotificationResponse.model_validate(notification)

        self.assertEqual(response.message, CALENDAR_SYNC_SAFE_ERROR)
        self.assertNotIn("SQL", response.message)
        self.assertNotIn("%(summary)s", response.message)
        self.assertNotIn("secret", response.message)


if __name__ == "__main__":
    unittest.main()
