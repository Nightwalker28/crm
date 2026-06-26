import unittest
from datetime import timedelta
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

    def test_microsoft_event_payload_uses_graph_shape(self):
        event = SimpleNamespace(
            title="Planning",
            description="Roadmap",
            meeting_url="https://teams.microsoft.com/l/meetup-join/example",
            location="Remote",
            start_at=calendar_services._utcnow(),
            end_at=calendar_services._utcnow(),
            is_all_day=False,
        )

        payload = calendar_services._microsoft_event_payload(event)

        self.assertEqual(payload["subject"], "Planning")
        self.assertEqual(payload["location"]["displayName"], "Remote")
        self.assertEqual(payload["start"]["timeZone"], "UTC")
        self.assertIn("teams.microsoft.com", payload["body"]["content"])

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
        participant = SimpleNamespace(
            participant_type="user",
            user_id=1,
            user=SimpleNamespace(last_login_provider="google"),
            is_owner=False,
            response_status="pending",
            responded_at=None,
            external_provider=None,
        )
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

    def test_calendar_update_rejects_invalid_partial_dates_before_mutating_event(self):
        db = FakeDB()
        start_at = calendar_services._utcnow()
        original_end_at = start_at + timedelta(hours=1)
        event = SimpleNamespace(
            id=12,
            tenant_id=10,
            owner_user_id=1,
            title="Planning",
            description=None,
            start_at=start_at,
            end_at=original_end_at,
            is_all_day=False,
            location=None,
            meeting_url=None,
            participants=[],
        )
        current_user = SimpleNamespace(id=1, tenant_id=10)

        with self.assertRaises(HTTPException) as exc:
            calendar_services.update_calendar_event(
                db,
                event=event,
                payload={"end_at": start_at - timedelta(minutes=5)},
                current_user=current_user,
            )

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(event.end_at, original_end_at)
        self.assertEqual(db.added, [])
        self.assertEqual(db.commits, 0)

    def test_calendar_provider_switch_removes_previous_external_event_before_sync(self):
        db = FakeDB()
        participant = SimpleNamespace(
            user=SimpleNamespace(last_login_provider="microsoft"),
            external_provider="google",
            external_event_id="google-event",
        )
        event = SimpleNamespace(id=12)

        with patch.object(calendar_services, "_delete_participant_event") as delete_mock, \
             patch.object(calendar_services, "_sync_microsoft_participant_event") as microsoft_sync_mock:
            calendar_services._sync_participant_event(db, event=event, participant=participant)

        delete_mock.assert_called_once_with(db, participant)
        self.assertIsNone(participant.external_provider)
        self.assertIsNone(participant.external_event_id)
        microsoft_sync_mock.assert_called_once_with(db, event=event, participant=participant)

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

    def test_calendar_connection_diagnostics_treat_expired_access_token_as_refreshable(self):
        current_user = SimpleNamespace(last_login_provider="google")
        last_synced_at = calendar_services._utcnow() - timedelta(hours=2)
        connection = SimpleNamespace(
            provider="google",
            status="connected",
            account_email="ava@example.com",
            provider_calendar_id="crm@example.com",
            provider_calendar_name="CRM",
            access_token="encrypted-access",
            refresh_token="encrypted-refresh",
            token_expires_at=calendar_services._utcnow() - timedelta(minutes=5),
            scopes=["calendar.events"],
            last_synced_at=last_synced_at,
            last_error=None,
        )

        serialized = calendar_services._serialize_connection(connection, current_user=current_user)

        self.assertTrue(serialized["sync_enabled_for_current_session"])
        self.assertEqual(serialized["health_status"], "healthy")
        self.assertEqual(serialized["credential_state"], "refresh_available")
        self.assertFalse(serialized["reconnect_required"])
        self.assertEqual(serialized["last_successful_sync_at"], last_synced_at)
        self.assertEqual(serialized["scopes"], ["calendar.events"])

    def test_calendar_connection_diagnostics_require_reconnect_without_refresh_token(self):
        current_user = SimpleNamespace(last_login_provider="microsoft")
        connection = SimpleNamespace(
            provider="microsoft",
            status="connected",
            account_email="ava@example.com",
            provider_calendar_id=None,
            provider_calendar_name=None,
            access_token="encrypted-access",
            refresh_token=None,
            token_expires_at=calendar_services._utcnow() - timedelta(minutes=5),
            scopes=None,
            last_synced_at=None,
            last_error="Missing Microsoft refresh token for calendar sync.",
        )

        serialized = calendar_services._serialize_connection(connection, current_user=current_user)

        self.assertFalse(serialized["sync_enabled_for_current_session"])
        self.assertEqual(serialized["health_status"], "reconnect_required")
        self.assertEqual(serialized["credential_state"], "reconnect_required")
        self.assertTrue(serialized["reconnect_required"])
        self.assertEqual(serialized["last_failure_reason"], "Missing Microsoft refresh token for calendar sync.")

    def test_calendar_context_includes_recent_sync_jobs_for_current_user(self):
        db = FakeDB()
        current_user = SimpleNamespace(id=1, tenant_id=10)
        user = SimpleNamespace(id=1, email="ava@example.com", team_id=None, first_name="Ava", last_name="Khan")
        job = SimpleNamespace(id=99, status="completed")

        with patch.object(calendar_services.calendar_repository, "list_context_users", return_value=[user]), \
             patch.object(calendar_services.calendar_repository, "list_context_teams", return_value=[]), \
             patch.object(calendar_services.calendar_repository, "list_user_calendar_connections", return_value=[]), \
             patch.object(calendar_services.calendar_repository, "list_recent_calendar_sync_jobs", return_value=[job]) as jobs_mock, \
             patch.object(calendar_services.calendar_repository, "pending_invite_count", return_value=0):
            context = calendar_services.build_calendar_context(db, tenant_id=10, current_user=current_user)

        self.assertEqual(context["recent_sync_jobs"], [job])
        jobs_mock.assert_called_once_with(db, tenant_id=10, actor_user_id=1)


if __name__ == "__main__":
    unittest.main()
