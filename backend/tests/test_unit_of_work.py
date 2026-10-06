"""One commit per business action (13-final-fixes.md FQ.1, 13a E5)."""

import tempfile
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.unit_of_work import in_unit_of_work, on_commit, unit_of_work
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.platform.models import ActivityLog, CrmEvent
from app.modules.platform.services.crm_events import emit_crm_event, safe_emit_crm_event
from app.modules.sales.models import SalesContact, SalesLead, SalesOpportunity, SalesOrganization
from app.modules.sales.routes import leads_routes
from app.modules.sales.schema import LeadConversionRequest
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus


class _Fixture(unittest.TestCase):
    def setUp(self):
        # A file, not `:memory:`: an in-memory database shares one connection, so a second
        # session would see uncommitted rows and could not tell a flush from a commit.
        self.directory = tempfile.TemporaryDirectory()
        engine = create_engine(f"sqlite:///{self.directory.name}/uow.db")
        self.engine = engine
        Base.metadata.create_all(engine)
        self.Session = sessionmaker(bind=engine)
        self.db = self.Session()
        self.db.add_all([
            Tenant(id=10, slug="default", name="Default"),
            User(id=1, tenant_id=10, email="owner@example.com", first_name="Owner", last_name="User", is_active=UserStatus.active),
        ])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        self.directory.cleanup()

    def other_session_count(self, model) -> int:
        """What another connection would see: only what has really been committed."""
        with self.Session() as other:
            return other.query(model).count()


class UnitOfWorkTests(_Fixture):
    def test_a_commit_inside_is_a_flush_and_the_block_commits_once(self):
        with unit_of_work(self.db):
            self.assertTrue(in_unit_of_work(self.db))
            self.db.add(SalesOrganization(org_id=1, tenant_id=10, org_name="Acme"))
            self.db.commit()  # a service's own commit
            self.db.add(SalesOrganization(org_id=2, tenant_id=10, org_name="Globex"))
            self.db.commit()
            # Flushed, so visible here, but not committed: another connection sees nothing yet.
            self.assertEqual(self.db.query(SalesOrganization).count(), 2)
            self.assertEqual(self.other_session_count(SalesOrganization), 0)
        self.assertFalse(in_unit_of_work(self.db))
        self.assertNotIn("commit", self.db.__dict__)
        self.assertEqual(self.other_session_count(SalesOrganization), 2)

    def test_an_error_anywhere_rolls_back_every_step(self):
        with self.assertRaises(RuntimeError):
            with unit_of_work(self.db):
                self.db.add(SalesOrganization(org_id=1, tenant_id=10, org_name="Acme"))
                self.db.commit()
                raise RuntimeError("the third step failed")
        self.assertEqual(self.db.query(SalesOrganization).count(), 0)
        self.assertNotIn("commit", self.db.__dict__)

    def test_nested_blocks_join_the_outermost(self):
        with self.assertRaises(RuntimeError):
            with unit_of_work(self.db):
                with unit_of_work(self.db):
                    self.db.add(SalesOrganization(org_id=1, tenant_id=10, org_name="Acme"))
                # The inner block ended, but nothing is committed until the outer one does.
                raise RuntimeError("later failure")
        self.assertEqual(self.db.query(SalesOrganization).count(), 0)

    def test_on_commit_runs_after_the_commit_and_never_after_a_rollback(self):
        ran = []
        with unit_of_work(self.db):
            self.db.add(SalesOrganization(org_id=1, tenant_id=10, org_name="Acme"))
            on_commit(self.db, lambda: ran.append("committed"))
            self.assertEqual(ran, [])
        self.assertEqual(ran, ["committed"])

        with self.assertRaises(RuntimeError):
            with unit_of_work(self.db):
                on_commit(self.db, lambda: ran.append("rolled back"))
                raise RuntimeError("no")
        self.db.commit()
        self.assertEqual(ran, ["committed"])

    def test_events_are_queued_only_once_the_action_commits(self):
        with patch("app.modules.platform.services.crm_events.enqueue_crm_event_automation") as enqueue:
            with unit_of_work(self.db):
                event = emit_crm_event(self.db, tenant_id=10, actor_user_id=1, event_type="lead.created", entity_type="sales_lead",
                                       entity_id=1, payload={})
                enqueue.assert_not_called()
            enqueue.assert_called_once_with(event.id)

            with self.assertRaises(RuntimeError):
                with unit_of_work(self.db):
                    emit_crm_event(self.db, tenant_id=10, actor_user_id=1, event_type="lead.created", entity_type="sales_lead",
                                   entity_id=2, payload={})
                    raise RuntimeError("the action failed")
            self.assertEqual(enqueue.call_count, 1)
        self.assertEqual(self.db.query(CrmEvent).count(), 1)

    def test_a_failed_event_does_not_undo_the_action(self):
        with patch("app.modules.platform.services.crm_events.stage_crm_event", side_effect=RuntimeError("bad payload")):
            with unit_of_work(self.db):
                self.db.add(SalesOrganization(org_id=1, tenant_id=10, org_name="Acme"))
                self.db.flush()
                self.assertIsNone(safe_emit_crm_event(self.db, tenant_id=10, actor_user_id=1, event_type="lead.created",
                                                      entity_type="sales_lead", entity_id=1, payload={}))
        self.assertEqual(self.other_session_count(SalesOrganization), 1)


class LeadConversionIsOneTransactionTests(_Fixture):
    def setUp(self):
        super().setUp()
        self.db.add(SalesLead(lead_id=100, tenant_id=10, first_name="Ada", last_name="Lovelace", company="Analytical Engines",
                              primary_email="ada@example.com", status="qualified", assigned_to=1))
        self.db.commit()
        self.user = self.db.get(User, 1)

    def convert(self):
        return leads_routes.convert_lead(100, LeadConversionRequest(create_deal=True, deal_name="Engines"), db=self.db,
                                         current_user=self.user, require_module=None, require_permission=None)

    def test_a_failure_after_the_records_are_made_leaves_nothing_behind(self):
        with patch.object(leads_routes, "_require_conversion_target_permissions"), \
             patch.object(leads_routes, "_log_conversion_targets", side_effect=RuntimeError("timeline write failed")):
            with self.assertRaises(RuntimeError):
                self.convert()
        self.db.expire_all()
        self.assertEqual(self.db.get(SalesLead, 100).status, "qualified")
        for model in (SalesOrganization, SalesContact, SalesOpportunity, ActivityLog, CrmEvent):
            self.assertEqual(self.other_session_count(model), 0, model.__name__)

    def test_a_conversion_commits_its_records_timeline_and_event_together(self):
        with patch.object(leads_routes, "_require_conversion_target_permissions"), \
             patch("app.modules.platform.services.crm_events.enqueue_crm_event_automation") as enqueue:
            result = self.convert()
        self.assertTrue(result.created_account and result.created_contact and result.created_deal)
        self.assertEqual(self.other_session_count(SalesOrganization), 1)
        self.assertEqual(self.other_session_count(SalesOpportunity), 1)
        # At least the lead's own row and one per record the conversion made.
        self.assertGreaterEqual(self.other_session_count(ActivityLog), 4)
        self.assertEqual(self.other_session_count(CrmEvent), 1)
        enqueue.assert_called_once()


if __name__ == "__main__":
    unittest.main()
