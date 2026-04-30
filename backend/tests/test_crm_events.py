import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.pagination import create_pagination
from app.modules.platform.models import CrmEvent, CrmEventDelivery, NotificationChannel
from app.modules.platform.services.crm_events import list_crm_events, serialize_crm_event
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


if __name__ == "__main__":
    unittest.main()
