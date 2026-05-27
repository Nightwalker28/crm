import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.platform.models import AutomationRuleDeadLetter, AutomationRuleRun
from app.modules.platform.services.automation_rules import create_automation_rule
from app.modules.platform.services.crm_events import emit_crm_event
from app.modules.tasks.models import Task
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus


class AutomationRuleTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default"),
                Tenant(id=99, slug="other", name="Other"),
                User(
                    id=1,
                    tenant_id=10,
                    email="owner@example.com",
                    first_name="Owner",
                    last_name="User",
                    is_active=UserStatus.active,
                ),
                User(
                    id=2,
                    tenant_id=99,
                    email="other@example.com",
                    first_name="Other",
                    last_name="User",
                    is_active=UserStatus.active,
                ),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_enabled_rule_runs_from_supported_crm_event_and_creates_task(self):
        create_automation_rule(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={
                "name": "Lead follow-up",
                "trigger_event": "lead.created",
                "conditions_json": [{"field": "payload.source", "operator": "equals", "value": "Referral"}],
                "actions_json": [
                    {
                        "type": "create_task",
                        "title": "Call {{payload.lead_name}}",
                        "priority": "high",
                        "assignee_user_id": "actor",
                    }
                ],
            },
        )

        emit_crm_event(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            event_type="lead.created",
            entity_type="sales_lead",
            entity_id=123,
            payload={"lead_name": "Ada", "source": "Referral"},
        )

        runs = self.db.query(AutomationRuleRun).filter(AutomationRuleRun.tenant_id == 10).all()
        tasks = self.db.query(Task).filter(Task.tenant_id == 10).all()
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0].status, "succeeded")
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0].title, "Call Ada")
        self.assertEqual(tasks[0].priority, "high")

    def test_disabled_rule_does_not_fire(self):
        create_automation_rule(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={
                "name": "Disabled",
                "enabled": False,
                "trigger_event": "lead.created",
                "actions_json": [{"type": "create_task", "title": "Should not run"}],
            },
        )

        emit_crm_event(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            event_type="lead.created",
            entity_type="sales_lead",
            entity_id=123,
            payload={"lead_name": "Ada"},
        )

        self.assertEqual(self.db.query(AutomationRuleRun).count(), 0)
        self.assertEqual(self.db.query(Task).count(), 0)

    def test_failed_action_records_run_and_dead_letter_without_breaking_event(self):
        create_automation_rule(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={
                "name": "Notify missing user",
                "trigger_event": "lead.created",
                "actions_json": [{"type": "send_notification", "user_id": 404, "title": "Missing", "message": "No user"}],
            },
        )

        event = emit_crm_event(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            event_type="lead.created",
            entity_type="sales_lead",
            entity_id=123,
            payload={"lead_name": "Ada"},
        )

        run = self.db.query(AutomationRuleRun).one()
        dead_letter = self.db.query(AutomationRuleDeadLetter).one()
        self.assertEqual(event.event_type, "lead.created")
        self.assertEqual(run.status, "failed")
        self.assertIn("Notification user not found", run.error_message)
        self.assertEqual(dead_letter.run_id, run.id)

    def test_rules_are_tenant_scoped(self):
        create_automation_rule(
            self.db,
            tenant_id=99,
            actor_user_id=2,
            payload={
                "name": "Other tenant rule",
                "trigger_event": "lead.created",
                "actions_json": [{"type": "create_task", "title": "Other tenant task"}],
            },
        )

        emit_crm_event(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            event_type="lead.created",
            entity_type="sales_lead",
            entity_id=123,
            payload={},
        )

        self.assertEqual(self.db.query(AutomationRuleRun).count(), 0)
        self.assertEqual(self.db.query(Task).count(), 0)


if __name__ == "__main__":
    unittest.main()
