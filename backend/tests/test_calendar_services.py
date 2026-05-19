import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.modules.calendar.services import calendar_services


class FakeDB:
    def __init__(self):
        self.added = []
        self.added_all = []
        self.commits = 0
        self.rollbacks = 0
        self.refreshed = []
        self.fail_add_all = False

    def add(self, item):
        self.added.append(item)

    def add_all(self, items):
        if self.fail_add_all:
            raise RuntimeError("notification insert failed")
        self.added_all.extend(items)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def refresh(self, item):
        self.refreshed.append(item)
        return None


class CalendarGoogleSyncTests(unittest.TestCase):
    def test_google_app_calendar_rejects_invalid_provider_calendar_id(self):
        connection = SimpleNamespace(
            scopes=["https://www.googleapis.com/auth/calendar"],
            provider_calendar_id=None,
            provider_calendar_name=None,
            status="connected",
            last_error=None,
        )
        response = SimpleNamespace(
            ok=True,
            content=b"{}",
            json=lambda: {"id": "../../private", "summary": "CRM"},
        )
        db = FakeDB()

        with patch.object(calendar_services, "_ensure_google_access_token", return_value="token"), \
             patch.object(calendar_services.requests, "post", return_value=response):
            calendar_id = calendar_services._ensure_google_app_calendar(db, connection)

        self.assertIsNone(calendar_id)
        self.assertIsNone(connection.provider_calendar_id)
        self.assertEqual(connection.status, "error")
        self.assertEqual(connection.last_error, "Google returned an invalid calendar identifier.")
        self.assertEqual(db.commits, 1)

    def test_google_app_calendar_uses_existing_provider_calendar_id_without_http(self):
        connection = SimpleNamespace(provider_calendar_id="crm@example.com", scopes=[], status="connected", last_error=None)
        db = FakeDB()

        with patch.object(calendar_services, "_ensure_google_access_token") as token_mock, \
             patch.object(calendar_services.requests, "post") as post_mock:
            calendar_id = calendar_services._ensure_google_app_calendar(db, connection)

        self.assertEqual(calendar_id, "crm@example.com")
        token_mock.assert_not_called()
        post_mock.assert_not_called()

    def test_task_event_dedupe_reuses_canonical_without_requery(self):
        db = FakeDB()
        canonical = SimpleNamespace(id=10)
        duplicate = SimpleNamespace(id=11)
        current_user = SimpleNamespace(id=1, tenant_id=10)

        with patch.object(calendar_services, "_list_duplicate_task_events", return_value=[canonical, duplicate]) as list_mock, \
             patch.object(calendar_services, "delete_calendar_event") as delete_mock:
            event = calendar_services._dedupe_calendar_events_from_task(db, task_id=7, current_user=current_user)

        self.assertIs(event, canonical)
        list_mock.assert_called_once_with(db, task_id=7, current_user=current_user)
        delete_mock.assert_called_once_with(db, event=duplicate)
        self.assertEqual(db.refreshed, [canonical])

    def test_delete_calendar_event_from_task_returns_pre_delete_snapshot(self):
        db = FakeDB()
        event = SimpleNamespace(id=10)
        current_user = SimpleNamespace(id=1, tenant_id=10)
        snapshot = {"id": 10, "title": "Task event"}

        with patch.object(calendar_services, "_list_duplicate_task_events", return_value=[event]) as list_mock, \
             patch.object(calendar_services, "serialize_calendar_event", return_value=snapshot) as serialize_mock, \
             patch.object(calendar_services, "delete_calendar_event") as delete_mock:
            result = calendar_services.delete_calendar_event_from_task(db, task_id=7, current_user=current_user)

        self.assertEqual(result, snapshot)
        list_mock.assert_called_once_with(db, task_id=7, current_user=current_user)
        serialize_mock.assert_called_once_with(event, current_user=current_user)
        delete_mock.assert_called_once_with(db, event=event)

    def test_calendar_invite_response_rejects_owner_and_team_only_participant(self):
        db = FakeDB()
        current_user = SimpleNamespace(id=1, tenant_id=10)
        owner_event = SimpleNamespace(id=10, owner_user_id=1, participants=[])

        with self.assertRaises(HTTPException) as owner_exc:
            calendar_services.respond_to_calendar_invite(
                db,
                event=owner_event,
                current_user=current_user,
                response_status="accepted",
            )
        self.assertEqual(owner_exc.exception.status_code, 400)

        team_event = SimpleNamespace(
            id=11,
            owner_user_id=2,
            participants=[
                SimpleNamespace(participant_type="team", team_id=5, user_id=None, is_owner=False),
            ],
        )
        with self.assertRaises(HTTPException) as team_exc:
            calendar_services.respond_to_calendar_invite(
                db,
                event=team_event,
                current_user=current_user,
                response_status="accepted",
            )
        self.assertEqual(team_exc.exception.status_code, 403)

    def test_calendar_invite_response_updates_current_user_participant(self):
        db = FakeDB()
        current_user = SimpleNamespace(id=1, tenant_id=10)
        participant = SimpleNamespace(participant_type="user", user_id=1, is_owner=False, response_status="pending", responded_at=None)
        event = SimpleNamespace(id=12, owner_user_id=2, participants=[participant])

        with patch.object(calendar_services, "_sync_google_participant_event") as sync_mock, \
             patch.object(calendar_services, "get_calendar_event_or_404") as get_mock:
            result = calendar_services.respond_to_calendar_invite(
                db,
                event=event,
                current_user=current_user,
                response_status="accepted",
            )

        self.assertIs(result, event)
        self.assertEqual(participant.response_status, "accepted")
        self.assertIsNotNone(participant.responded_at)
        self.assertEqual(db.added, [participant])
        self.assertEqual(db.commits, 1)
        sync_mock.assert_called_once_with(db, event=event, participant=participant)
        get_mock.assert_not_called()

    def test_calendar_participant_notification_failure_is_non_fatal(self):
        db = FakeDB()
        db.fail_add_all = True
        event = SimpleNamespace(
            id=12,
            tenant_id=10,
            title="Planning",
            start_at=calendar_services._utcnow(),
            source_module_key="tasks",
            source_entity_id="7",
        )
        participant = SimpleNamespace(participant_type="user", user_id=1, team_id=None, is_owner=False)

        with patch.object(calendar_services.logger, "exception") as exception_mock:
            calendar_services._notify_new_participants(
                db,
                event=event,
                actor_name="Ava",
                participants=[participant],
            )

        self.assertEqual(db.rollbacks, 1)
        exception_mock.assert_called_once()
        self.assertEqual(exception_mock.call_args.kwargs["extra"]["tenant_id"], 10)
        self.assertEqual(exception_mock.call_args.kwargs["extra"]["event_id"], 12)

    def test_calendar_external_sync_enqueue_failure_does_not_sync_inline(self):
        db = FakeDB()
        event = SimpleNamespace(id=12, tenant_id=10)

        with patch("builtins.__import__", side_effect=ImportError("celery missing")), \
             patch.object(calendar_services, "_sync_external_events_for_event") as sync_mock, \
             patch.object(calendar_services.logger, "warning") as warning_mock:
            calendar_services._enqueue_external_events_for_event(db, event)

        sync_mock.assert_not_called()
        warning_mock.assert_called_once()
        self.assertEqual(warning_mock.call_args.kwargs["extra"]["event_id"], 12)

    def test_calendar_full_sync_enqueue_creates_job_and_dispatches_worker(self):
        db = FakeDB()
        current_user = SimpleNamespace(id=1, tenant_id=10, last_login_provider="google")
        connection = SimpleNamespace(status="connected")
        job = SimpleNamespace(id=55, status="queued")

        with patch.object(calendar_services, "_google_connection_for_user", return_value=connection), \
             patch("app.modules.platform.services.data_transfer_jobs.create_data_transfer_job", return_value=job) as create_job_mock, \
             patch("app.tasks.calendar_tasks.process_calendar_full_sync_job_task.delay") as delay_mock:
            result = calendar_services.enqueue_current_user_calendar_sync(db, current_user=current_user)

        self.assertIs(result, job)
        create_job_mock.assert_called_once_with(
            db,
            tenant_id=10,
            actor_user_id=1,
            module_key="calendar",
            operation_type="sync",
            payload={"provider": "google"},
        )
        delay_mock.assert_called_once_with(55)


if __name__ == "__main__":
    unittest.main()
