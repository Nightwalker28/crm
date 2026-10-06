"""Automation rules fire on what the builder offers, and read the record they fired on.

Covers the automation fix of 2026-10-01: record snapshots under the payload, triggers
derived from general events, the record-owner target, module keys on notes and tasks,
date comparisons, unavailable triggers, templates, module gating and the overdue scan.
"""

import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine, inspect as sa_inspect
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.documents import models as documents_models  # noqa: F401
from app.modules.platform.models import AutomationRuleRun, CrmEvent, RecordComment, UserNotification
from app.modules.platform.services import automation_records
from app.modules.platform.services.automation_registry import (
    AUTOMATION_CONDITION_FIELDS,
    AUTOMATION_TEMPLATES,
    AUTOMATION_TRIGGERS,
    derived_trigger_keys,
    grouped_trigger_registry,
)
from app.modules.platform.services.automation_rules import (
    create_automation_rule,
    list_automation_templates,
    preview_automation_rule,
    process_crm_event_automations,
    serialize_condition_fields_for_tenant,
)
from app.modules.platform.services.crm_events import emit_crm_event, field_changes
from app.modules.sales.models import SalesLead, SalesPipeline, SalesPipelineStage, SalesQuote
from app.modules.tasks.models import Task, TaskAssignee
from app.modules.tasks.services import tasks_services
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Module, Tenant, TenantModuleConfig, User, UserStatus


class AutomationTriggerTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default"),
                Tenant(id=99, slug="other", name="Other"),
                User(id=1, tenant_id=10, email="admin@example.com", first_name="Admin", is_active=UserStatus.active),
                User(id=2, tenant_id=10, email="rep@example.com", first_name="Rep", is_active=UserStatus.active),
                User(id=3, tenant_id=99, email="other@example.com", first_name="Other", is_active=UserStatus.active),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def _rule(self, trigger, actions, conditions=None, **extra):
        return create_automation_rule(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={"name": f"Rule on {trigger}", "trigger_event": trigger, "actions_json": actions, "conditions_json": conditions or [], **extra},
        )

    def _emit(self, event_type, entity_type, entity_id, payload=None, actor_user_id=1, tenant_id=10):
        with patch("app.modules.platform.services.crm_events.enqueue_crm_event_automation"):
            event = emit_crm_event(
                self.db,
                tenant_id=tenant_id,
                actor_user_id=actor_user_id,
                event_type=event_type,
                entity_type=entity_type,
                entity_id=entity_id,
                payload=payload or {},
            )
        return process_crm_event_automations(self.db, event_id=event.id)

    def _lead(self, **values):
        fields = {"lead_id": 500, "first_name": "Ada", "last_name": "Lovelace", "primary_email": "ada@example.test", "status": "new", **values}
        lead = SalesLead(tenant_id=10, **fields)
        self.db.add(lead)
        self.db.commit()
        return lead

    # -- the record, not just the payload -------------------------------------------------

    def test_conditions_and_templates_read_fields_the_payload_left_out(self):
        self._lead(assigned_to=2, source="Referral")
        self._rule(
            "lead.created",
            [{"type": "create_task", "title": "Call {{payload.first_name}} {{payload.last_name}}", "assignee_user_id": "owner"}],
            [{"field": "payload.first_name", "operator": "equals", "value": "ada"}],
        )

        # The route's payload has no first_name or last_name; the record does.
        runs = self._emit("lead.created", "sales_lead", 500, {"primary_email": "ada@example.test"})

        self.assertEqual([run.status for run in runs], ["succeeded"])
        task = self.db.query(Task).one()
        self.assertEqual(task.title, "Call Ada Lovelace")
        self.assertEqual(self.db.query(TaskAssignee).one().user_id, 2)

    def test_payload_captured_at_event_time_wins_over_the_record(self):
        self._lead(status="qualified")
        self._rule("lead.created", [{"type": "add_record_note", "body": "was {{payload.status}}"}], [{"field": "payload.status", "operator": "equals", "value": "new"}])

        runs = self._emit("lead.created", "sales_lead", 500, {"status": "new"})

        self.assertEqual(len(runs), 1)
        self.assertEqual(self.db.query(RecordComment).one().body, "was new")

    def test_snapshot_is_tenant_scoped(self):
        self._lead()
        self.assertEqual(automation_records.load_record_snapshot(self.db, tenant_id=99, entity_type="sales_lead", entity_id=500), {})
        snapshot = automation_records.load_record_snapshot(self.db, tenant_id=10, entity_type="sales_lead", entity_id=500)
        self.assertEqual(snapshot["first_name"], "Ada")
        self.assertEqual(snapshot["record_label"], "Ada Lovelace")
        self.assertEqual(snapshot["record_url"], "/dashboard/sales/leads/500")
        self.assertNotIn("tenant_id", snapshot)

    def test_every_condition_field_is_readable_from_its_record(self):
        extras = {"sales_leads": {"score", "score_grade", "status_meaning"}, "sales_opportunities": {"stage_semantic_type"}}
        sources = {source.module_key: source for source in automation_records.AUTOMATION_RECORD_SOURCES.values()}
        for field in AUTOMATION_CONDITION_FIELDS:
            source = sources.get(field.module_key)
            if source is None:
                continue  # support is out of scope and reads the payload only
            columns = {column.key for column in sa_inspect(source.model).columns}
            with self.subTest(module=field.module_key, field=field.key):
                self.assertIn(field.key, columns | extras.get(field.module_key, set()))

    # -- notes and tasks land on the record ---------------------------------------------

    def test_notes_and_tasks_use_the_module_key_so_the_record_shows_them(self):
        self._lead()
        self._rule("lead.created", [{"type": "add_record_note", "body": "Hello"}, {"type": "create_task", "title": "Follow up"}])

        self._emit("lead.created", "sales_lead", 500)

        self.assertEqual(self.db.query(RecordComment).one().module_key, "sales_leads")
        task = self.db.query(Task).one()
        self.assertEqual(task.source_module_key, "sales_leads")
        self.assertEqual(task.source_label, "Ada Lovelace")

    def test_notification_links_the_record_when_no_link_is_given(self):
        self._lead(assigned_to=2)
        self._rule("lead.created", [{"type": "send_notification", "user_id": "owner", "title": "New: {{payload.record_label}}", "message": "Look"}])

        self._emit("lead.created", "sales_lead", 500)

        notification = self.db.query(UserNotification).one()
        self.assertEqual(notification.user_id, 2)
        self.assertEqual(notification.title, "New: Ada Lovelace")
        self.assertEqual(notification.link_url, "/dashboard/sales/leads/500")

    def test_notifying_the_owner_of_an_unowned_record_fails_with_a_readable_reason(self):
        self._lead()
        self._rule("lead.created", [{"type": "send_notification", "user_id": "owner", "title": "t", "message": "m"}])

        runs = self._emit("lead.created", "sales_lead", 500)

        self.assertEqual(runs[0].status, "failed")
        self.assertEqual(runs[0].error_message, "The record has no owner to notify")

    # -- derived triggers ------------------------------------------------------------------

    def test_quote_status_change_fires_only_the_matching_specific_trigger(self):
        self.db.add(SalesQuote(quote_id=804, tenant_id=10, quote_number="Q-804", title="Pilot", customer_name="Acme", status="accepted", currency="USD", total_amount="10", assigned_to=2))
        self.db.commit()
        accepted = self._rule("quote.accepted", [{"type": "add_record_note", "body": "accepted"}])
        self._rule("quote.rejected", [{"type": "add_record_note", "body": "rejected"}])
        general = self._rule("quote.status_changed", [{"type": "add_record_note", "body": "changed"}])

        runs = self._emit("quote.status_changed", "sales_quote", 804, {"status": "accepted", "field_changes": {"status": {"from": "sent", "to": "accepted"}}})

        self.assertEqual(sorted(run.rule_id for run in runs), sorted([accepted.id, general.id]))
        self.assertEqual({run.trigger_event_key for run in runs}, {"quote.accepted", "quote.status_changed"})
        self.assertEqual(sorted(comment.body for comment in self.db.query(RecordComment).all()), ["accepted", "changed"])

    def test_lead_update_derives_status_changed_and_changed_to_matches(self):
        self._lead(status="qualified")
        self._rule("lead.status_changed", [{"type": "add_record_note", "body": "qualified"}], [{"field": "payload.status", "operator": "changed_to", "value": "qualified"}])

        runs = self._emit("lead.updated", "sales_lead", 500, {"status": "qualified", "field_changes": {"status": {"from": "new", "to": "qualified"}}})
        self.assertEqual([run.status for run in runs], ["succeeded"])

        # An update that did not change the status derives nothing.
        runs = self._emit("lead.updated", "sales_lead", 500, {"status": "qualified", "field_changes": {"company": {"from": None, "to": "Acme"}}})
        self.assertEqual(runs, [])

    def test_lead_assigned_fires_on_create_with_an_owner_and_on_reassignment(self):
        self.assertEqual(derived_trigger_keys("lead.created", {"assigned_to": 2}), ["lead.assigned"])
        self.assertEqual(derived_trigger_keys("lead.created", {"assigned_to": None}), [])
        self.assertEqual(derived_trigger_keys("lead.updated", {"field_changes": {"assigned_to": {"from": 1, "to": 2}}}), ["lead.assigned"])
        self.assertEqual(derived_trigger_keys("lead.updated", {"field_changes": {"assigned_to": {"from": 2, "to": None}}}), [])
        self.assertEqual(derived_trigger_keys("order.status_changed", {"field_changes": {"status": {"from": "confirmed", "to": "fulfilled"}}}), ["order.completed"])

    def test_field_changes_reports_only_real_changes(self):
        before = {"status": "new", "company": "Acme", "score": 1}
        after = {"status": "qualified", "company": "Acme", "score": 1}
        self.assertEqual(field_changes(before, after), {"status": {"from": "new", "to": "qualified"}})
        self.assertEqual(field_changes(before, after, keys={"company"}), {})

    # -- comparisons -----------------------------------------------------------------------

    def test_date_conditions_compare_as_dates(self):
        lead = self._lead()
        lead.created_time = datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc)
        self.db.commit()
        self._rule("lead.created", [{"type": "add_record_note", "body": "recent"}], [{"field": "payload.created_time", "operator": "gte", "value": "2026-09-01"}])
        self._rule("lead.created", [{"type": "add_record_note", "body": "old"}], [{"field": "payload.created_time", "operator": "lt", "value": "2026-09-01"}])

        self._emit("lead.created", "sales_lead", 500)

        self.assertEqual([comment.body for comment in self.db.query(RecordComment).all()], ["recent"])

    def test_numbers_compare_numerically_and_text_ignores_case(self):
        self.db.add(SalesQuote(quote_id=804, tenant_id=10, quote_number="Q-804", title="Pilot", customer_name="Acme Ltd", status="draft", currency="USD", total_amount="1000.00"))
        self.db.commit()
        self._rule(
            "quote.created",
            [{"type": "add_record_note", "body": "big"}],
            [{"field": "payload.total_amount", "operator": "equals", "value": "1000"}, {"field": "payload.customer_name", "operator": "equals", "value": "ACME LTD"}],
        )

        runs = self._emit("quote.created", "sales_quote", 804)

        self.assertEqual(len(runs), 1)

    # -- what the builder offers -------------------------------------------------------------

    def test_triggers_nothing_emits_are_not_offered_and_cannot_be_enabled(self):
        offered = {trigger["key"] for group in grouped_trigger_registry() for trigger in group["triggers"]}
        self.assertNotIn("booking.cancelled", offered)
        self.assertIn("booking.created", offered)
        self.assertIn("quote.accepted", offered)

        with self.assertRaises(HTTPException) as raised:
            self._rule("booking.cancelled", [{"type": "create_task", "title": "x"}])
        self.assertEqual(raised.exception.status_code, 400)

        draft = self._rule("booking.cancelled", [], enabled=False)
        self.assertFalse(draft.enabled)
        preview = preview_automation_rule({"name": "x", "trigger_event": "booking.cancelled", "actions_json": [{"type": "create_task", "title": "x"}]})
        self.assertFalse(preview["can_enable"])

    def test_every_template_is_a_valid_enabled_rule(self):
        self.assertEqual(len(list_automation_templates()), len(AUTOMATION_TEMPLATES))
        for template in list_automation_templates():
            with self.subTest(template=template["key"]):
                rule = create_automation_rule(
                    self.db,
                    tenant_id=10,
                    actor_user_id=1,
                    payload={
                        "name": template["name"],
                        "trigger_event": template["trigger_event"],
                        "condition_mode": template["condition_mode"],
                        "conditions_json": template["conditions_json"],
                        "actions_json": template["actions_json"],
                    },
                )
                self.assertTrue(rule.enabled)

    def test_every_trigger_offered_names_a_module_with_a_record(self):
        sources = {source.module_key for source in automation_records.AUTOMATION_RECORD_SOURCES.values()}
        for trigger in AUTOMATION_TRIGGERS:
            if trigger.available:
                self.assertIn(trigger.module_key, sources, trigger.key)

    def test_stage_condition_lists_the_tenants_own_stages(self):
        pipeline = SalesPipeline(id=1, tenant_id=10, module_key="sales_opportunities", name="Default", is_default=True, is_active=True)
        self.db.add(pipeline)
        self.db.flush()
        self.db.add_all(
            [
                SalesPipelineStage(id=1, tenant_id=10, pipeline_id=1, key="discovery", label="Discovery", position=1, semantic_type="open", probability=10, is_active=True),
                SalesPipelineStage(id=2, tenant_id=10, pipeline_id=1, key="signed", label="Signed", position=2, semantic_type="won", probability=100, is_active=True),
            ]
        )
        self.db.commit()
        fields = [field for field in AUTOMATION_CONDITION_FIELDS if field.module_key == "sales_opportunities"]

        stage = next(item for item in serialize_condition_fields_for_tenant(self.db, tenant_id=10, fields=fields) if item["payload_key"] == "sales_stage")
        self.assertEqual(stage["options"], [{"value": "discovery", "label": "Discovery"}, {"value": "signed", "label": "Signed"}])

        other = next(item for item in serialize_condition_fields_for_tenant(self.db, tenant_id=99, fields=fields) if item["payload_key"] == "sales_stage")
        self.assertEqual(len(other["options"]), 6)  # no pipeline: the seeded keys

    # -- gating and scheduling ---------------------------------------------------------------

    def test_rule_is_skipped_while_its_module_is_disabled_for_the_tenant(self):
        self._lead()
        self.db.add(Module(id=1, name="sales_leads", is_enabled=1))
        self.db.add(TenantModuleConfig(id=1, tenant_id=10, module_id=1, is_enabled=0))
        self.db.commit()
        self._rule("lead.created", [{"type": "add_record_note", "body": "x"}])

        runs = self._emit("lead.created", "sales_lead", 500)

        self.assertEqual([run.status for run in runs], ["skipped"])
        self.assertEqual(self.db.query(RecordComment).count(), 0)

    def test_overdue_scan_announces_each_deadline_once(self):
        now = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
        task = Task(id=40, tenant_id=10, title="Send contract", status="todo", priority="high", due_at=now - timedelta(hours=2))
        done = Task(id=41, tenant_id=10, title="Done", status="completed", priority="low", due_at=now - timedelta(hours=2))
        ancient = Task(id=42, tenant_id=10, title="Ancient", status="todo", priority="low", due_at=now - timedelta(days=30))
        self.db.add_all([task, done, ancient])
        self.db.commit()

        with patch("app.modules.platform.services.crm_events.enqueue_crm_event_automation"):
            first = tasks_services.scan_overdue_tasks(self.db, now=now)
        self.assertEqual(first["events_created"], 1)
        # The event row's clock is the database's, not the scan's; pin it to the scan time.
        announced = self.db.query(CrmEvent).filter(CrmEvent.event_type == "task.overdue").one()
        announced.created_at = now
        self.db.commit()
        with patch("app.modules.platform.services.crm_events.enqueue_crm_event_automation"):
            again = tasks_services.scan_overdue_tasks(self.db, now=now + timedelta(hours=1))
        self.assertEqual(again["events_created"], 0)

        # Rescheduled, and late again: a new deadline, announced again.
        task.due_at = now + timedelta(hours=3)
        self.db.commit()
        with patch("app.modules.platform.services.crm_events.enqueue_crm_event_automation"):
            later = tasks_services.scan_overdue_tasks(self.db, now=now + timedelta(hours=5))
        self.assertEqual(later["events_created"], 1)

    def test_run_records_the_rules_trigger_for_derived_events(self):
        self._lead(assigned_to=2)
        self._rule("lead.assigned", [{"type": "add_record_note", "body": "assigned"}])

        runs = self._emit("lead.created", "sales_lead", 500, {"assigned_to": 2})

        self.assertEqual(runs[0].trigger_event_key, "lead.assigned")
        self.assertEqual(self.db.query(AutomationRuleRun).count(), 1)


if __name__ == "__main__":
    unittest.main()
