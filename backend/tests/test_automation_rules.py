import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.documents import models as documents_models  # noqa: F401
from app.modules.platform.models import AutomationRuleDeadLetter, AutomationRuleRun, CrmEvent
from app.modules.platform.services.automation_registry import actions_for_trigger, grouped_trigger_registry
from app.modules.platform.services.automation_rules import create_automation_rule, list_automation_rule_runs, preview_automation_rule, process_crm_event_automations, update_automation_rule
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

    def _emit_and_process(self, db=None, **kwargs):
        db = db or self.db
        with patch("app.modules.platform.services.crm_events.enqueue_crm_event_automation"):
            event = emit_crm_event(db, **kwargs)
        process_crm_event_automations(db, event_id=event.id)
        return event

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

        self._emit_and_process(
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
        self.assertEqual(runs[0].trigger_event_key, "lead.created")
        self.assertEqual(runs[0].source_module_key, "sales_lead")
        self.assertEqual(runs[0].source_record_id, "123")
        self.assertEqual(runs[0].step_results_json[0]["status"], "success")
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

        self._emit_and_process(
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

        event = self._emit_and_process(
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

    def test_rule_module_key_defaults_from_trigger(self):
        rule = create_automation_rule(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={
                "name": "Quote follow-up",
                "trigger_event": "quote.created",
                "actions_json": [{"type": "create_task", "title": "Review quote"}],
            },
        )

        self.assertEqual(rule.module_key, "sales_quotes")
        self.assertEqual(rule.condition_mode, "all")

    def test_any_condition_mode_runs_when_one_condition_matches(self):
        create_automation_rule(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={
                "name": "Any source",
                "trigger_event": "lead.created",
                "condition_mode": "any",
                "conditions_json": [
                    {"field": "payload.source", "operator": "equals", "value": "Website"},
                    {"field": "payload.status", "operator": "equals", "value": "qualified"},
                ],
                "actions_json": [{"type": "create_task", "title": "Prioritize {{payload.lead_name}}"}],
            },
        )

        self._emit_and_process(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            event_type="lead.created",
            entity_type="sales_lead",
            entity_id=123,
            payload={"lead_name": "Ada", "source": "Referral", "status": "qualified"},
        )

        self.assertEqual(self.db.query(AutomationRuleRun).count(), 1)
        self.assertEqual(self.db.query(Task).one().title, "Prioritize Ada")

    def test_condition_field_must_belong_to_trigger_module(self):
        with self.assertRaises(HTTPException) as context:
            create_automation_rule(
                self.db,
                tenant_id=10,
                actor_user_id=1,
                payload={
                    "name": "Bad condition",
                    "trigger_event": "lead.created",
                    "conditions_json": [{"field": "payload.grand_total", "operator": "gt", "value": 100}],
                    "actions_json": [{"type": "create_task", "title": "Should not save"}],
                },
            )

        self.assertEqual(context.exception.status_code, 400)
        self.assertIn("Unsupported condition field", context.exception.detail)

    def test_condition_operator_must_match_field_type(self):
        with self.assertRaises(HTTPException) as context:
            create_automation_rule(
                self.db,
                tenant_id=10,
                actor_user_id=1,
                payload={
                    "name": "Bad operator",
                    "trigger_event": "lead.created",
                    "conditions_json": [{"field": "payload.first_name", "operator": "gt", "value": "Ada"}],
                    "actions_json": [{"type": "create_task", "title": "Should not save"}],
                },
            )

        self.assertEqual(context.exception.status_code, 400)
        self.assertEqual(context.exception.detail, "Unsupported condition operator for field")

    def test_action_registry_filters_actions_by_trigger_module(self):
        lead_actions = {action.key for action in actions_for_trigger("lead.created")}
        quote_actions = {action.key for action in actions_for_trigger("quote.created")}

        self.assertIn("create_task", lead_actions)
        self.assertIn("recalculate_lead_score", lead_actions)
        self.assertIn("create_task", quote_actions)
        self.assertNotIn("recalculate_lead_score", quote_actions)

    def test_action_must_be_available_for_trigger_module(self):
        with self.assertRaises(HTTPException) as context:
            create_automation_rule(
                self.db,
                tenant_id=10,
                actor_user_id=1,
                payload={
                    "name": "Bad action",
                    "trigger_event": "quote.created",
                    "actions_json": [{"type": "recalculate_lead_score"}],
                },
            )

        self.assertEqual(context.exception.status_code, 400)
        self.assertEqual(context.exception.detail, "Automation action is not available for this trigger")

    def test_action_required_fields_are_validated(self):
        with self.assertRaises(HTTPException) as context:
            create_automation_rule(
                self.db,
                tenant_id=10,
                actor_user_id=1,
                payload={
                    "name": "Missing title",
                    "trigger_event": "lead.created",
                    "actions_json": [{"type": "create_task", "priority": "medium"}],
                },
            )

        self.assertEqual(context.exception.status_code, 400)
        self.assertEqual(context.exception.detail, "Action field is required: title")

    def test_disabled_draft_can_save_without_actions(self):
        rule = create_automation_rule(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={
                "name": "Draft",
                "enabled": False,
                "trigger_event": "lead.created",
                "actions_json": [],
            },
        )

        self.assertFalse(rule.enabled)
        self.assertEqual(rule.actions_json, [])

    def test_disabled_draft_must_be_valid_before_enabling(self):
        rule = create_automation_rule(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={
                "name": "Draft",
                "enabled": False,
                "trigger_event": "lead.created",
                "actions_json": [],
            },
        )

        with self.assertRaises(HTTPException) as context:
            update_automation_rule(self.db, rule=rule, actor_user_id=1, payload={"enabled": True})

        self.assertEqual(context.exception.status_code, 400)
        self.assertEqual(context.exception.detail, "actions_json must include at least one action")

    def test_preview_validates_rule_without_saving(self):
        preview = preview_automation_rule(
            {
                "name": "Preview",
                "trigger_event": "lead.created",
                "condition_mode": "all",
                "conditions_json": [{"field": "source", "operator": "equals", "value": "Referral"}],
                "actions_json": [{"type": "create_task", "title": "Call {{payload.lead_name}}"}],
            }
        )

        self.assertTrue(preview["valid"])
        self.assertTrue(preview["can_enable"])
        self.assertEqual(preview["module_key"], "sales_leads")
        self.assertEqual(preview["condition_count"], 1)
        self.assertEqual(preview["actions"][0]["label"], "Create task")
        self.assertEqual(self.db.query(AutomationRuleRun).count(), 0)

    def test_preview_returns_warning_for_disabled_empty_draft(self):
        preview = preview_automation_rule(
            {
                "name": "Preview draft",
                "enabled": False,
                "trigger_event": "lead.created",
                "actions_json": [],
            }
        )

        self.assertTrue(preview["valid"])
        self.assertFalse(preview["can_enable"])
        self.assertIn("Draft is disabled and has no actions yet.", preview["warnings"])

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

        self._emit_and_process(
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

    def test_run_history_can_filter_by_rule_module(self):
        create_automation_rule(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={
                "name": "Lead task",
                "trigger_event": "lead.created",
                "actions_json": [{"type": "create_task", "title": "Lead task"}],
            },
        )
        create_automation_rule(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={
                "name": "Quote task",
                "trigger_event": "quote.created",
                "actions_json": [{"type": "create_task", "title": "Quote task"}],
            },
        )

        self._emit_and_process(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            event_type="lead.created",
            entity_type="sales_lead",
            entity_id=123,
            payload={},
        )
        self._emit_and_process(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            event_type="quote.created",
            entity_type="sales_quote",
            entity_id=456,
            payload={},
        )

        lead_runs = list_automation_rule_runs(self.db, tenant_id=10, module_key="sales_leads")
        quote_runs = list_automation_rule_runs(self.db, tenant_id=10, module_key="sales_quotes")

        self.assertEqual(len(lead_runs), 1)
        self.assertEqual(lead_runs[0].trigger_event_key, "lead.created")
        self.assertEqual(len(quote_runs), 1)
        self.assertEqual(quote_runs[0].trigger_event_key, "quote.created")

    def test_emit_crm_event_enqueues_automation_processing(self):
        with patch("app.modules.platform.services.crm_events.enqueue_crm_event_automation") as enqueue:
            event = emit_crm_event(
                self.db,
                tenant_id=10,
                actor_user_id=1,
                event_type="lead.created",
                entity_type="sales_lead",
                entity_id=123,
                payload={},
            )

        enqueue.assert_called_once_with(event.id)
        self.assertEqual(self.db.query(AutomationRuleRun).count(), 0)

    def test_processing_same_event_twice_is_idempotent(self):
        create_automation_rule(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={
                "name": "Lead task",
                "trigger_event": "lead.created",
                "actions_json": [{"type": "create_task", "title": "Lead task"}],
            },
        )
        with patch("app.modules.platform.services.crm_events.enqueue_crm_event_automation"):
            event = emit_crm_event(
                self.db,
                tenant_id=10,
                actor_user_id=1,
                event_type="lead.created",
                entity_type="sales_lead",
                entity_id=123,
                payload={},
            )

        first_runs = process_crm_event_automations(self.db, event_id=event.id)
        second_runs = process_crm_event_automations(self.db, event_id=event.id)

        self.assertEqual(len(first_runs), 1)
        self.assertEqual(len(second_runs), 1)
        self.assertEqual(first_runs[0].id, second_runs[0].id)
        self.assertEqual(self.db.query(AutomationRuleRun).count(), 1)
        self.assertEqual(self.db.query(Task).count(), 1)

    def test_loop_depth_guard_records_skipped_run(self):
        create_automation_rule(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={
                "name": "Lead task",
                "trigger_event": "lead.created",
                "actions_json": [{"type": "create_task", "title": "Lead task"}],
            },
        )
        event = CrmEvent(
            tenant_id=10,
            actor_user_id=1,
            event_type="lead.created",
            entity_type="sales_lead",
            entity_id="123",
            payload={"_automation": {"depth": 3}},
        )
        self.db.add(event)
        self.db.commit()
        self.db.refresh(event)

        runs = process_crm_event_automations(self.db, event_id=event.id)

        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0].status, "skipped")
        self.assertIn("max automation depth", runs[0].error_message)
        self.assertEqual(self.db.query(Task).count(), 0)

    def test_trigger_registry_groups_supported_triggers_by_module(self):
        registry = grouped_trigger_registry()
        modules = {group["module_key"] for group in registry}
        sales_lead_triggers = next(group["triggers"] for group in registry if group["module_key"] == "sales_leads")

        self.assertIn("sales_leads", modules)
        self.assertIn("support_cases", modules)
        self.assertIn("documents", modules)
        self.assertIn("lead.created", {trigger["key"] for trigger in sales_lead_triggers})


if __name__ == "__main__":
    unittest.main()
