import unittest
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.pagination import Pagination
from app.modules.platform.models import ActivityLog
from app.modules.platform.services.activity_logs import (
    COALESCE_WINDOW,
    list_activity_logs,
    log_activity,
)
from app.modules.user_management import models as user_management_models  # noqa: F401


class ActivityLogTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()

    def tearDown(self):
        self.db.close()

    def test_entity_id_is_normalized_at_model_and_service_boundary(self):
        entry = log_activity(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            module_key="sales_contacts",
            entity_type="sales_contact",
            entity_id=7,
            action="updated",
        )

        direct = ActivityLog(
            tenant_id=10,
            actor_user_id=None,
            module_key="sales_contacts",
            entity_type="sales_contact",
            entity_id=8,
            action="created",
        )
        self.db.add(direct)
        self.db.commit()

        items, total = list_activity_logs(
            self.db,
            tenant_id=10,
            pagination=Pagination(page=1, page_size=10, offset=0, limit=10),
            entity_id=7,
        )

        self.assertEqual(entry.entity_id, "7")
        self.assertEqual(direct.entity_id, "8")
        self.assertEqual(total, 1)
        self.assertEqual(items[0].entity_id, "7")


class ActivityLogCoalescingTests(unittest.TestCase):
    """R1's autosave turns one workflow action into repeated writes of one field.

    The rendered record history is what pays for that, so consecutive single-field edits
    by the same actor inside the window become one entry. Everything else is left alone —
    these tests are as much about what does *not* merge.
    """

    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()

    def tearDown(self):
        self.db.close()

    def _state(self, **overrides):
        state = {"id": 3, "name": "Acme", "stage": "new", "owner_id": 5, "updated_at": "2026-08-18T09:00:00Z"}
        state.update(overrides)
        return state

    def _log(self, before, after, *, actor_user_id=1, action="update", entity_id=3):
        return log_activity(
            self.db,
            tenant_id=10,
            actor_user_id=actor_user_id,
            module_key="sales_opportunities",
            entity_type="opportunity",
            entity_id=entity_id,
            action=action,
            description="Updated deal",
            before_state=before,
            after_state=after,
        )

    def _entries(self):
        return self.db.query(ActivityLog).order_by(ActivityLog.id).all()

    def test_repeated_edits_of_one_field_become_one_entry(self):
        self._log(self._state(stage="new"), self._state(stage="qualified"))
        self._log(self._state(stage="qualified"), self._state(stage="proposal"))
        merged = self._log(self._state(stage="proposal"), self._state(stage="negotiation"))

        entries = self._entries()
        self.assertEqual(len(entries), 1)
        self.assertIsNotNone(merged)
        # The window's original starting value, and where the field actually ended up.
        self.assertEqual(entries[0].before_state["stage"], "new")
        self.assertEqual(entries[0].after_state["stage"], "negotiation")

    def test_a_field_returning_to_its_starting_value_leaves_no_entry(self):
        self._log(self._state(stage="new"), self._state(stage="qualified"))
        collapsed = self._log(self._state(stage="qualified"), self._state(stage="new"))

        self.assertIsNone(collapsed)
        self.assertEqual(self._entries(), [])

    def test_a_volatile_timestamp_alone_is_not_a_changed_field(self):
        # Whole-record snapshots move `updated_at` on every write. If that counted, no
        # edit would ever look like a single-field change and nothing would coalesce.
        self._log(self._state(stage="new"), self._state(stage="qualified", updated_at="2026-08-18T09:01:00Z"))
        self._log(
            self._state(stage="qualified", updated_at="2026-08-18T09:01:00Z"),
            self._state(stage="proposal", updated_at="2026-08-18T09:02:00Z"),
        )

        entries = self._entries()
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].before_state["stage"], "new")
        self.assertEqual(entries[0].after_state["stage"], "proposal")

    def test_a_different_field_starts_its_own_entry(self):
        self._log(self._state(stage="new"), self._state(stage="qualified"))
        self._log(self._state(stage="qualified"), self._state(stage="qualified", owner_id=9))

        entries = self._entries()
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0].after_state["stage"], "qualified")
        self.assertEqual(entries[1].after_state["owner_id"], 9)

    def test_a_second_actor_does_not_merge_into_the_first(self):
        self._log(self._state(stage="new"), self._state(stage="qualified"), actor_user_id=1)
        self._log(self._state(stage="qualified"), self._state(stage="proposal"), actor_user_id=2)

        self.assertEqual(len(self._entries()), 2)

    def test_a_multi_field_write_is_never_coalesced(self):
        self._log(self._state(stage="new"), self._state(stage="qualified"))
        self._log(self._state(stage="qualified"), self._state(stage="proposal", owner_id=9))

        self.assertEqual(len(self._entries()), 2)

    def test_a_create_is_never_coalesced(self):
        # No before-state, so there is no changed field to key on, twice over.
        self._log(None, self._state(), action="create")
        self._log(None, self._state(name="Acme two"), action="create")

        self.assertEqual(len(self._entries()), 2)

    def test_another_tenants_entry_is_never_a_predecessor(self):
        log_activity(
            self.db,
            tenant_id=11,
            actor_user_id=1,
            module_key="sales_opportunities",
            entity_type="opportunity",
            entity_id=3,
            action="update",
            before_state=self._state(stage="new"),
            after_state=self._state(stage="qualified"),
        )
        self._log(self._state(stage="qualified"), self._state(stage="proposal"))

        entries = self._entries()
        self.assertEqual(len(entries), 2)
        self.assertEqual({entry.tenant_id for entry in entries}, {10, 11})

    def test_a_different_record_starts_its_own_entry(self):
        self._log(self._state(stage="new"), self._state(stage="qualified"), entity_id=3)
        self._log(self._state(stage="qualified"), self._state(stage="proposal"), entity_id=4)

        self.assertEqual(len(self._entries()), 2)

    def test_an_entry_older_than_the_window_is_not_extended(self):
        first = self._log(self._state(stage="new"), self._state(stage="qualified"))
        first.created_at = datetime.now(timezone.utc) - COALESCE_WINDOW - timedelta(seconds=1)
        self.db.commit()

        self._log(self._state(stage="qualified"), self._state(stage="proposal"))

        entries = self._entries()
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[1].before_state["stage"], "qualified")


if __name__ == "__main__":
    unittest.main()
