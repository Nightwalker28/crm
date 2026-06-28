import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.pagination import create_pagination
from app.modules.platform.models import CrmEvent, CrmEventDelivery, NotificationChannel
from app.modules.platform.services.crm_events import (
    CRM_EVENT_TYPES,
    SLACK_ALERT_EVENT_TYPES,
    emit_crm_event,
    format_event_message,
    list_crm_events,
    process_crm_event_delivery,
    serialize_crm_event,
)
from app.modules.user_management import models as user_management_models  # noqa: F401


class CrmEventHistoryTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()

    def tearDown(self):
        self.db.close()

    def test_list_crm_events_is_tenant_scoped_and_includes_deliveries(self):
        event = CrmEvent(
            id=1,
            tenant_id=10,
            actor_user_id=None,
            event_type="lead.created",
            entity_type="sales_contact",
            entity_id="7",
            payload={"lead_name": "Acme Buyer"},
        )
        other_tenant_event = CrmEvent(
            id=2,
            tenant_id=99,
            actor_user_id=None,
            event_type="lead.created",
            entity_type="sales_contact",
            entity_id="8",
            payload={},
        )
        channel = NotificationChannel(
            id=1,
            tenant_id=10,
            provider="slack",
            webhook_url="https://hooks.slack.example/test",
            channel_name="#sales",
            is_active=True,
        )
        delivery = CrmEventDelivery(
            id=1,
            tenant_id=10,
            event_id=1,
            channel_id=1,
            provider="slack",
            status="delivered",
        )
        self.db.add_all([event, other_tenant_event, channel, delivery])
        self.db.commit()

        events, deliveries_by_event_id, total = list_crm_events(
            self.db,
            tenant_id=10,
            pagination=create_pagination(page=1, page_size=10),
        )

        self.assertEqual(total, 1)
        self.assertEqual([item.id for item in events], [1])
        serialized = serialize_crm_event(events[0], deliveries_by_event_id[1])
        self.assertEqual(serialized["payload"], {"lead_name": "Acme Buyer"})
        self.assertEqual(serialized["deliveries"][0]["channel_name"], "#sales")

    def test_list_crm_events_can_filter_by_delivery_status(self):
        self.db.add_all(
            [
                CrmEvent(id=1, tenant_id=10, event_type="lead.created", entity_type="sales_contact", entity_id="7"),
                CrmEvent(id=2, tenant_id=10, event_type="deal.assigned", entity_type="sales_opportunity", entity_id="12"),
                NotificationChannel(id=1, tenant_id=10, provider="slack", webhook_url="https://hooks.slack.example/test", is_active=True),
                CrmEventDelivery(id=1, tenant_id=10, event_id=1, channel_id=1, provider="slack", status="delivered"),
                CrmEventDelivery(id=2, tenant_id=10, event_id=2, channel_id=1, provider="slack", status="failed", error_message="bad webhook"),
            ]
        )
        self.db.commit()

        events, deliveries_by_event_id, total = list_crm_events(
            self.db,
            tenant_id=10,
            pagination=create_pagination(page=1, page_size=10),
            delivery_status="failed",
        )

        self.assertEqual(total, 1)
        self.assertEqual(events[0].event_type, "deal.assigned")
        self.assertEqual(deliveries_by_event_id[events[0].id][0].error_message, "bad webhook")

    def test_unknown_event_message_uses_safe_fallback_fields(self):
        message = format_event_message(
            "custom.secret_event",
            {
                "entity_type": "client_page",
                "entity_id": "42",
                "action": "view",
                "customer_email": "buyer@example.com",
                "api_key": "secret-token",
                "webhook_url": "https://hooks.example/private",
            },
        )

        self.assertIn("custom.secret_event", message)
        self.assertIn("Entity Type: client_page", message)
        self.assertIn("Entity ID: 42", message)
        self.assertIn("Action: view", message)
        self.assertNotIn("buyer@example.com", message)
        self.assertNotIn("secret-token", message)
        self.assertNotIn("hooks.example", message)

    def test_task_alert_event_types_are_canonical(self):
        self.assertIn("task.due_today", CRM_EVENT_TYPES)
        self.assertIn("task.assigned", CRM_EVENT_TYPES)
        self.assertTrue({"task.due_today", "task.assigned"}.issubset(SLACK_ALERT_EVENT_TYPES))

    def test_alert_event_types_are_persisted_event_types(self):
        self.assertTrue(SLACK_ALERT_EVENT_TYPES.issubset(CRM_EVENT_TYPES))

    def test_emit_crm_event_persists_pending_deliveries_and_enqueues_worker(self):
        self.db.add_all(
            [
                NotificationChannel(id=1, tenant_id=10, provider="slack", webhook_url="https://hooks.slack.example/test", is_active=True),
                NotificationChannel(id=2, tenant_id=10, provider="teams", webhook_url="https://hooks.teams.example/test", is_active=True),
            ]
        )
        self.db.commit()

        with patch("app.modules.platform.services.crm_events.enqueue_crm_event_automation"), \
             patch("app.modules.platform.services.crm_events.enqueue_crm_event_delivery") as enqueue_delivery, \
             patch("app.modules.platform.services.crm_events.send_channel_message") as send_message:
            event = emit_crm_event(
                self.db,
                tenant_id=10,
                actor_user_id=None,
                event_type="lead.created",
                entity_type="sales_lead",
                entity_id=7,
                payload={"lead_name": "Ada"},
            )

        send_message.assert_not_called()
        deliveries = self.db.query(CrmEventDelivery).filter(CrmEventDelivery.event_id == event.id).order_by(CrmEventDelivery.id.asc()).all()
        self.assertEqual([delivery.provider for delivery in deliveries], ["slack", "teams"])
        self.assertEqual([delivery.status for delivery in deliveries], ["pending", "pending"])
        self.assertEqual([call.args[0] for call in enqueue_delivery.call_args_list], [delivery.id for delivery in deliveries])

    def test_crm_event_delivery_worker_marks_successful_delivery(self):
        self.db.add_all(
            [
                CrmEvent(id=1, tenant_id=10, event_type="lead.created", entity_type="sales_lead", entity_id="7", payload={"lead_name": "Ada"}),
                NotificationChannel(id=1, tenant_id=10, provider="slack", webhook_url="https://hooks.slack.example/test", is_active=True),
                CrmEventDelivery(id=1, tenant_id=10, event_id=1, channel_id=1, provider="slack", status="pending"),
            ]
        )
        self.db.commit()

        with patch("app.modules.platform.services.crm_events.send_channel_message") as send_message:
            delivery = process_crm_event_delivery(self.db, delivery_id=1)

        send_message.assert_called_once()
        self.assertEqual(delivery.status, "delivered")
        self.assertIsNotNone(delivery.delivered_at)

    def test_delivery_enqueue_failure_is_observable(self):
        self.db.add(NotificationChannel(id=1, tenant_id=10, provider="slack", webhook_url="https://hooks.slack.example/test", is_active=True))
        self.db.commit()

        with patch("app.modules.platform.services.crm_events.enqueue_crm_event_automation"), \
             patch("app.modules.platform.services.crm_events.enqueue_crm_event_delivery", side_effect=RuntimeError("broker offline")):
            event = emit_crm_event(
                self.db,
                tenant_id=10,
                actor_user_id=None,
                event_type="lead.created",
                entity_type="sales_lead",
                entity_id=7,
                payload={"lead_name": "Ada"},
            )

        delivery = self.db.query(CrmEventDelivery).filter(CrmEventDelivery.event_id == event.id).one()
        self.assertEqual(delivery.status, "failed")
        self.assertIn("Delivery could not be queued", delivery.error_message)

    def test_automation_enqueue_failure_is_persisted_on_event_payload(self):
        with patch("app.modules.platform.services.crm_events.enqueue_crm_event_automation", side_effect=RuntimeError("broker offline")):
            event = emit_crm_event(
                self.db,
                tenant_id=10,
                actor_user_id=None,
                event_type="case.created",
                entity_type="support_case",
                entity_id=7,
                payload={"subject": "Broken login"},
            )

        self.assertEqual(event.payload["_automation_dispatch"]["status"], "failed")
        self.assertIn("broker offline", event.payload["_automation_dispatch"]["error_message"])


if __name__ == "__main__":
    unittest.main()
