import json
import re
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from fastapi.routing import APIRoute
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.bootstrap.seed import DEFAULT_MODULES
from app.core.database import Base
from app.modules.platform.models import CrmEvent
from app.modules.platform.routes import webhook_events as webhook_event_routes
from app.modules.platform.schema import WebhookEventTypeListResponse
from app.modules.platform.services.crm_events import CRM_EVENT_TYPES, emit_crm_event, serialize_crm_event
from app.modules.platform.services.webhook_events import (
    FIELD_KINDS,
    RECORD_TYPES,
    WEBHOOK_EVENT_TYPES,
    WEBHOOK_EVENT_TYPES_BY_KEY,
    build_webhook_envelope,
    list_webhook_event_types,
    webhook_event_type_for,
)
from app.modules.user_management import models as user_management_models  # noqa: F401


UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
OCCURRED = datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc)


def recorded(event_type, entity_type, payload, *, entity_id="7", actor_user_id=11, public_id="00000000-0000-4000-8000-000000000001"):
    return CrmEvent(
        id=1,
        tenant_id=10,
        actor_user_id=actor_user_id,
        event_type=event_type,
        entity_type=entity_type,
        entity_id=entity_id,
        payload=payload,
        public_id=public_id,
        created_at=OCCURRED,
    )


class CatalogueTests(unittest.TestCase):
    def test_every_entry_reads_an_event_lynk_actually_defines(self):
        for event_type in WEBHOOK_EVENT_TYPES:
            with self.subTest(event_type.key):
                self.assertIn(event_type.source_event_type, CRM_EVENT_TYPES)
                self.assertIn(event_type.source_entity_type, RECORD_TYPES)
                self.assertGreaterEqual(event_type.version, 1)
                self.assertTrue(event_type.description)

    def test_names_and_sources_are_one_to_one(self):
        keys = [event_type.key for event_type in WEBHOOK_EVENT_TYPES]
        sources = [(event_type.source_event_type, event_type.source_entity_type) for event_type in WEBHOOK_EVENT_TYPES]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertEqual(len(sources), len(set(sources)))

    def test_external_names_follow_the_record_they_describe(self):
        for event_type in WEBHOOK_EVENT_TYPES:
            with self.subTest(event_type.key):
                self.assertEqual(event_type.key.split(".", 1)[0], event_type.record_type)

    def test_each_entry_is_gated_by_a_real_module(self):
        module_names = {module["name"] for module in DEFAULT_MODULES}
        for event_type in WEBHOOK_EVENT_TYPES:
            with self.subTest(event_type.key):
                self.assertIn(event_type.module_key, module_names)

    def test_fields_are_typed_and_never_read_internal_or_display_only_keys(self):
        forbidden_sources = {"href", "actor_name", "actor_user_id", "assigned_to_name", "assigned_by_name", "assignees", "message", "client_account_id", "action"}
        for event_type in WEBHOOK_EVENT_TYPES:
            names = [field.name for field in event_type.fields]
            self.assertEqual(len(names), len(set(names)), event_type.key)
            for field in event_type.fields:
                with self.subTest(event_type.key, field=field.name):
                    self.assertIn(field.kind, FIELD_KINDS)
                    self.assertNotIn(field.source_key, forbidden_sources)
                    self.assertFalse(field.source_key.startswith("_"))

    def test_support_and_contract_events_stay_internal(self):
        sources = {event_type.source_event_type for event_type in WEBHOOK_EVENT_TYPES}
        self.assertFalse({"case.created", "case.status_changed", "contract.status_changed"} & sources)

    def test_the_catalogue_serializes_through_its_response_model(self):
        response = WebhookEventTypeListResponse.model_validate({"results": list_webhook_event_types()})
        self.assertEqual([item.type for item in response.results], [event_type.key for event_type in WEBHOOK_EVENT_TYPES])
        lead_created = response.results[0]
        self.assertEqual(lead_created.version, 1)
        self.assertEqual(lead_created.record_type, "lead")
        self.assertIn(("email", "string"), [(field.name, field.kind) for field in lead_created.fields])


class EnvelopeTests(unittest.TestCase):
    def test_a_lead_created_event_has_the_documented_shape(self):
        envelope = build_webhook_envelope(
            recorded(
                "lead.created",
                "sales_lead",
                {
                    "actor_user_id": 11,
                    "actor_name": "Priya Staff",
                    "lead_id": 7,
                    "lead_name": "Ada Buyer",
                    "primary_email": "ada@example.com",
                    "company": "Acme",
                    "source": "Website",
                    "status": "New",
                    "assigned_to": 11,
                    "score": 42,
                    "score_grade": "B",
                    "href": "/dashboard/sales/leads/7",
                },
            )
        )

        self.assertEqual(
            envelope,
            {
                "id": "00000000-0000-4000-8000-000000000001",
                "type": "lead.created",
                "version": 1,
                "occurred_at": "2026-09-30T12:00:00Z",
                "actor": {"type": "user", "user_id": "11"},
                "record": {"type": "lead", "id": "7"},
                "data": {
                    "name": "Ada Buyer",
                    "email": "ada@example.com",
                    "company": "Acme",
                    "source": "Website",
                    "status": "New",
                    "owner_user_id": "11",
                    "score": 42,
                    "score_grade": "B",
                },
            },
        )
        json.dumps(envelope)

    def test_the_envelope_carries_no_tenant_identity(self):
        envelope = build_webhook_envelope(recorded("lead.created", "sales_lead", {"lead_name": "Ada"}))
        self.assertEqual(set(envelope), {"id", "type", "version", "occurred_at", "actor", "record", "data"})

    def test_only_declared_fields_leave_and_every_one_is_present(self):
        payload = {
            "lead_name": "Ada",
            "href": "/dashboard/sales/leads/7",
            "_automation": {"depth": 1},
            "_automation_dispatch": {"status": "failed", "error_message": "redis down"},
            "api_token": "secret",
        }
        envelope = build_webhook_envelope(recorded("lead.created", "sales_lead", payload))

        declared = [field.name for field in WEBHOOK_EVENT_TYPES_BY_KEY["lead.created"].fields]
        self.assertEqual(list(envelope["data"]), declared)
        self.assertEqual(envelope["data"]["name"], "Ada")
        self.assertIsNone(envelope["data"]["email"])
        serialized = json.dumps(envelope)
        for leaked in ("href", "_automation", "redis down", "secret"):
            self.assertNotIn(leaked, serialized)

    def test_building_does_not_touch_the_stored_payload(self):
        payload = {"lead_name": "Ada", "href": "/x"}
        event = recorded("lead.created", "sales_lead", payload)
        build_webhook_envelope(event)
        self.assertEqual(event.payload, {"lead_name": "Ada", "href": "/x"})

    def test_a_contact_created_event_goes_out_as_contact_not_lead(self):
        event = recorded("lead.created", "sales_contact", {"lead_name": "Ada", "organization_name": "Acme", "status": "New"})
        envelope = build_webhook_envelope(event)

        self.assertEqual(envelope["type"], "contact.created")
        self.assertEqual(envelope["record"], {"type": "contact", "id": "7"})
        self.assertEqual(envelope["data"]["organization_name"], "Acme")
        self.assertNotIn("status", envelope["data"])

    def test_deal_assigned_goes_out_as_opportunity_assigned_with_money_as_a_string(self):
        envelope = build_webhook_envelope(
            recorded("deal.assigned", "sales_opportunity", {"deal_name": "Renewal", "deal_value": 12000.5, "stage": "Proposal", "assigned_to": 4})
        )

        self.assertEqual(envelope["type"], "opportunity.assigned")
        self.assertEqual(envelope["data"]["amount"], "12000.5")
        self.assertEqual(envelope["data"]["stage_label"], "Proposal")
        self.assertEqual(envelope["data"]["owner_user_id"], "4")

    def test_won_and_stage_changed_share_stable_stage_identity(self):
        payload = {
            "deal_name": "Renewal",
            "stage_id": 31,
            "stage_label": "Closed won",
            "stage_semantic_type": "won",
            "previous_stage": "Negotiation",
            "previous_stage_id": 30,
            "previous_stage_semantic_type": "open",
            "field_changes": {"sales_stage": {"from": "Negotiation", "to": "Closed won"}},
        }
        stage_changed = build_webhook_envelope(recorded("opportunity.stage_changed", "sales_opportunity", payload))
        won = build_webhook_envelope(recorded("opportunity.won", "sales_opportunity", payload))

        self.assertEqual(won["type"], "opportunity.won")
        self.assertEqual(won["data"], stage_changed["data"])
        self.assertEqual(won["data"]["stage_id"], "31")
        self.assertEqual(won["data"]["previous_stage_label"], "Negotiation")
        self.assertNotIn("field_changes", won["data"])

    def test_a_portal_quote_response_names_the_portal_and_drops_the_client_message(self):
        envelope = build_webhook_envelope(
            recorded(
                "quote.status_changed",
                "sales_quote",
                {"quote_number": "Q-1", "client_account_id": 5, "previous_status": "sent", "status": "accepted", "message": "Please call my mobile 555-0100"},
                actor_user_id=None,
            )
        )

        self.assertEqual(envelope["actor"], {"type": "client_portal", "user_id": None})
        self.assertEqual(envelope["data"]["status"], "accepted")
        serialized = json.dumps(envelope)
        self.assertNotIn("555-0100", serialized)
        self.assertNotIn("client_account_id", serialized)

    def test_a_scheduled_event_is_a_system_actor(self):
        envelope = build_webhook_envelope(
            recorded("task.due_today", "task", {"task_title": "Call Ada", "due_at": "2026-10-01T09:00:00+02:00"}, actor_user_id=None)
        )

        self.assertEqual(envelope["actor"], {"type": "system", "user_id": None})
        self.assertEqual(envelope["data"]["due_at"], "2026-10-01T07:00:00Z")

    def test_values_that_are_not_their_declared_kind_are_sent_as_null(self):
        lead = build_webhook_envelope(recorded("lead.created", "sales_lead", {"score": "high", "assigned_to": True}))
        participant = build_webhook_envelope(
            recorded("opportunity.participant_added", "sales_opportunity", {"is_primary": "yes", "contact_id": "", "restored": True})
        )

        self.assertIsNone(lead["data"]["score"])
        self.assertIsNone(lead["data"]["owner_user_id"])
        self.assertIsNone(participant["data"]["is_primary"])
        self.assertIsNone(participant["data"]["contact_id"])
        self.assertIs(participant["data"]["restored"], True)

    def test_a_naive_timestamp_is_read_as_utc(self):
        event = recorded("lead.updated", "sales_lead", {"changed_fields": ["status", "company"], "before_status": "New"})
        event.created_at = datetime(2026, 9, 30, 12, 0)
        envelope = build_webhook_envelope(event)

        self.assertEqual(envelope["occurred_at"], "2026-09-30T12:00:00Z")
        self.assertEqual(envelope["data"]["changed_fields"], ["status", "company"])
        self.assertEqual(envelope["data"]["previous_status"], "New")

    def test_events_without_an_external_form_are_not_built(self):
        # Insertion orders were retired with their `invoice.overdue` event (13 F1.2).
        self.assertIsNone(build_webhook_envelope(recorded("invoice.overdue", "finance_insertion_order", {})))
        self.assertIsNone(build_webhook_envelope(recorded("lead.created", "custom_record", {})))
        self.assertIsNone(webhook_event_type_for(recorded("lead.created", "custom_record", {})))

    def test_an_event_recorded_before_webhooks_is_never_built(self):
        self.assertIsNone(build_webhook_envelope(recorded("lead.created", "sales_lead", {}, public_id=None)))


class PublicIdTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        patcher = patch("app.modules.platform.services.crm_events.enqueue_crm_event_automation")
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self):
        self.db.close()

    def emit(self, tenant_id):
        return emit_crm_event(
            self.db,
            tenant_id=tenant_id,
            actor_user_id=None,
            event_type="lead.created",
            entity_type="sales_lead",
            entity_id=1,
            payload={"lead_name": "Ada"},
        )

    def test_every_new_event_gets_its_own_random_public_id(self):
        first = self.emit(10)
        second = self.emit(20)

        self.assertRegex(first.public_id, UUID_PATTERN)
        self.assertNotEqual(first.public_id, second.public_id)

    def test_the_envelope_id_is_the_public_id_not_the_row_id(self):
        event = self.emit(10)
        self.assertEqual(build_webhook_envelope(event)["id"], event.public_id)

    def test_admin_event_history_shows_the_public_id(self):
        event = self.emit(10)
        self.assertEqual(serialize_crm_event(event)["public_id"], event.public_id)


class RouteTests(unittest.TestCase):
    def test_the_catalogue_is_an_admin_only_read(self):
        route = next(
            route
            for route in webhook_event_routes.router.routes
            if isinstance(route, APIRoute) and route.path == "/admin/webhooks/event-types"
        )

        self.assertEqual(route.methods, {"GET"})
        self.assertIn("require_admin", {dependency.call.__name__ for dependency in route.dependant.dependencies})
        self.assertEqual(webhook_event_routes.get_webhook_event_types(admin=object()), {"results": list_webhook_event_types()})


if __name__ == "__main__":
    unittest.main()
