import unittest
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.realtime import collect_realtime_events, encode_sse_event
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.platform.models import DataTransferJob, UserNotification
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus


class RealtimeTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default"),
                Tenant(id=99, slug="other", name="Other"),
                User(id=1, tenant_id=10, email="owner@example.com", first_name="Owner", last_name="User", is_active=UserStatus.active),
                User(id=2, tenant_id=99, email="other@example.com", first_name="Other", last_name="User", is_active=UserStatus.active),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_encode_sse_event_formats_named_event(self):
        raw = encode_sse_event(event="heartbeat", data={"connected": True}, event_id="abc")

        self.assertIn("id: abc\n", raw)
        self.assertIn("event: heartbeat\n", raw)
        self.assertIn('data: {"connected":true}\n', raw)
        self.assertTrue(raw.endswith("\n\n"))

    def test_collect_realtime_events_scopes_to_current_user_and_tenant(self):
        marker = datetime(2026, 1, 1, tzinfo=timezone.utc)
        later = marker + timedelta(minutes=1)
        self.db.add_all(
            [
                UserNotification(
                    id=1,
                    tenant_id=10,
                    user_id=1,
                    category="task",
                    title="Mine",
                    message="Visible",
                    status="unread",
                    created_at=later,
                    updated_at=later,
                ),
                UserNotification(
                    id=2,
                    tenant_id=99,
                    user_id=2,
                    category="task",
                    title="Other",
                    message="Hidden",
                    status="unread",
                    created_at=later,
                    updated_at=later,
                ),
                DataTransferJob(
                    id=10,
                    tenant_id=10,
                    actor_user_id=1,
                    module_key="sales_contacts",
                    operation_type="import",
                    status="running",
                    mode="background",
                    progress_percent=50,
                    progress_message="Halfway",
                    created_at=marker,
                    updated_at=later,
                ),
                DataTransferJob(
                    id=99,
                    tenant_id=99,
                    actor_user_id=2,
                    module_key="sales_contacts",
                    operation_type="import",
                    status="running",
                    mode="background",
                    progress_percent=50,
                    created_at=marker,
                    updated_at=later,
                ),
            ]
        )
        self.db.commit()
        markers = {
            "notification_created_at": marker,
            "notification_updated_at": marker,
            "job_updated_at": marker,
        }

        events = collect_realtime_events(self.db, tenant_id=10, user_id=1, markers=markers)

        event_names = [event[0] for event in events]
        self.assertEqual(event_names, ["notification.created", "job.updated"])
        payloads = [event[1] for event in events]
        self.assertEqual(payloads[0]["title"], "Mine")
        self.assertEqual(payloads[0]["unread_count"], 1)
        self.assertEqual(payloads[1]["id"], 10)
        self.assertEqual(markers["notification_created_at"], later)
        self.assertEqual(markers["job_updated_at"], later)


if __name__ == "__main__":
    unittest.main()
