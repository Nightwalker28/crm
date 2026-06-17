import unittest
from datetime import date, datetime, time, timezone
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.calendar.models import CalendarEvent, MeetingBooking, MeetingBookingType
from app.modules.calendar.services import booking_services
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.platform.models import ActivityLog, UserNotification
from app.modules.sales.models import SalesContact, SalesLead
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus


class CalendarBookingServiceTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.current_user = SimpleNamespace(id=1, tenant_id=10)
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default"),
                Tenant(id=99, slug="other", name="Other"),
                User(id=1, tenant_id=10, email="owner@example.com", first_name="Ada", is_active=UserStatus.active),
                User(id=2, tenant_id=99, email="other@example.com", first_name="Other", is_active=UserStatus.active),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def _create_booking_type(self):
        return booking_services.create_booking_type(
            self.db,
            self.current_user,
            payload={
                "name": "Discovery Call",
                "slug": "discovery-call",
                "owner_id": 1,
                "duration_minutes": 30,
                "timezone": "UTC",
                "enabled": True,
                "availability": [{"weekday": 0, "start_time": time(9, 0), "end_time": time(10, 0), "sort_order": 0}],
                "questions": [{"label": "Company", "field_type": "text", "required": True, "sort_order": 0}],
            },
        )

    def test_booking_type_validates_owner_tenant(self):
        with self.assertRaises(Exception) as exc:
            booking_services.create_booking_type(
                self.db,
                self.current_user,
                payload={
                    "name": "Other Owner",
                    "slug": "other-owner",
                    "owner_id": 2,
                    "duration_minutes": 30,
                    "timezone": "UTC",
                    "availability": [],
                    "questions": [],
                },
            )

        self.assertIn("Booking owner not found", str(exc.exception))

    def test_public_slots_respect_existing_calendar_events(self):
        self._create_booking_type()
        self.db.add(
            CalendarEvent(
                tenant_id=10,
                owner_user_id=1,
                title="Busy",
                start_at=datetime(2099, 6, 1, 9, 0, tzinfo=timezone.utc),
                end_at=datetime(2099, 6, 1, 9, 30, tzinfo=timezone.utc),
            )
        )
        self.db.commit()

        slots = booking_services.available_slots(
            self.db,
            slug="discovery-call",
            start_date=date(2099, 6, 1),
            end_date=date(2099, 6, 1),
        )

        self.assertEqual([slot["start_at"].hour for slot in slots], [9])
        self.assertEqual(slots[0]["start_at"].minute, 30)

    def test_public_booking_creates_calendar_event_and_prevents_duplicate(self):
        booking_type = self._create_booking_type()
        booking_type_id = booking_type["id"]

        booking = booking_services.submit_public_booking(
            self.db,
            slug="discovery-call",
            payload={
                "start_at": datetime(2099, 6, 1, 9, 0, tzinfo=timezone.utc),
                "guest_name": "Grace Hopper",
                "guest_email": "grace@example.com",
                "guest_note": "Need CRM help",
                "answers": {"1": "Acme"},
            },
        )

        self.assertEqual(booking.booking_type_id, booking_type_id)
        self.assertIsNotNone(booking.calendar_event_id)
        event = self.db.query(CalendarEvent).filter(CalendarEvent.id == booking.calendar_event_id).one()
        lead = self.db.query(SalesLead).filter(SalesLead.primary_email == "grace@example.com").one()
        self.assertEqual(event.source_module_key, "sales_leads")
        self.assertEqual(event.source_entity_id, str(lead.lead_id))
        self.assertEqual(event.source_label, "Grace Hopper")
        self.assertEqual(lead.company, "Acme")
        self.assertEqual(lead.assigned_to, 1)
        self.assertEqual(booking.crm_source_module_key, "sales_leads")
        self.assertEqual(self.db.query(MeetingBooking).count(), 1)
        self.assertEqual(self.db.query(ActivityLog).filter(ActivityLog.action == "calendar_booking.created").count(), 1)
        self.assertEqual(self.db.query(UserNotification).filter(UserNotification.category == "calendar").count(), 1)

        with self.assertRaises(Exception) as exc:
            booking_services.submit_public_booking(
                self.db,
                slug="discovery-call",
                payload={
                    "start_at": datetime(2099, 6, 1, 9, 0, tzinfo=timezone.utc),
                    "guest_name": "Second Guest",
                    "guest_email": "second@example.com",
                    "answers": {"1": "Beta"},
                },
            )

        self.assertIn("Selected slot is no longer available", str(exc.exception))
        self.assertEqual(self.db.query(MeetingBookingType).count(), 1)

    def test_public_booking_links_existing_contact_by_guest_email(self):
        self.db.add(
            SalesContact(
                contact_id=55,
                tenant_id=10,
                first_name="Grace",
                last_name="Hopper",
                primary_email="Grace@Example.com",
                assigned_to=1,
            )
        )
        self.db.commit()
        self._create_booking_type()

        booking = booking_services.submit_public_booking(
            self.db,
            slug="discovery-call",
            payload={
                "start_at": datetime(2099, 6, 1, 9, 0, tzinfo=timezone.utc),
                "guest_name": "Grace Hopper",
                "guest_email": "grace@example.com",
                "answers": {"1": "Acme"},
            },
        )

        event = self.db.query(CalendarEvent).filter(CalendarEvent.id == booking.calendar_event_id).one()
        self.assertEqual(event.source_module_key, "sales_contacts")
        self.assertEqual(event.source_entity_id, "55")
        self.assertEqual(event.source_label, "Grace Hopper")
        self.assertEqual(self.db.query(SalesLead).count(), 0)

    def test_public_booking_submit_rate_limit_counts_slug_and_host(self):
        store = {}

        def fake_get(key):
            return store.get(key)

        def fake_set(key, value, *, ttl_seconds):
            store[key] = value

        with patch.object(booking_services.settings, "PUBLIC_BOOKING_SUBMIT_LIMIT", 2), \
             patch.object(booking_services, "cache_get_json", side_effect=fake_get), \
             patch.object(booking_services, "cache_set_json", side_effect=fake_set):
            booking_services.check_public_booking_rate_limit(slug="discovery-call", client_host="203.0.113.10")
            booking_services.record_public_booking_attempt(slug="discovery-call", client_host="203.0.113.10")
            booking_services.check_public_booking_rate_limit(slug="discovery-call", client_host="203.0.113.10")
            booking_services.record_public_booking_attempt(slug="discovery-call", client_host="203.0.113.10")

            with self.assertRaises(Exception) as exc:
                booking_services.check_public_booking_rate_limit(slug="discovery-call", client_host="203.0.113.10")

        self.assertIn("Too many booking attempts", str(exc.exception))
        self.assertEqual(len(store), 1)
        self.assertNotIn("discovery-call", next(iter(store.keys())))

    def test_client_bookings_are_scoped_by_tenant_and_guest_email(self):
        booking_type = self._create_booking_type()
        booking_type_id = booking_type["id"]
        self.db.add_all(
            [
                MeetingBooking(
                    id=201,
                    tenant_id=10,
                    booking_type_id=booking_type_id,
                    guest_name="Grace Hopper",
                    guest_email="grace@example.com",
                    start_at=datetime(2099, 6, 1, 9, 0, tzinfo=timezone.utc),
                    end_at=datetime(2099, 6, 1, 9, 30, tzinfo=timezone.utc),
                    timezone="UTC",
                    status="confirmed",
                    booked_date=date(2099, 6, 1),
                ),
                MeetingBooking(
                    id=202,
                    tenant_id=10,
                    booking_type_id=booking_type_id,
                    guest_name="Other Guest",
                    guest_email="other@example.com",
                    start_at=datetime(2099, 6, 1, 10, 0, tzinfo=timezone.utc),
                    end_at=datetime(2099, 6, 1, 10, 30, tzinfo=timezone.utc),
                    timezone="UTC",
                    status="confirmed",
                    booked_date=date(2099, 6, 1),
                ),
                MeetingBooking(
                    id=203,
                    tenant_id=99,
                    booking_type_id=booking_type_id,
                    guest_name="Grace Other Tenant",
                    guest_email="grace@example.com",
                    start_at=datetime(2099, 6, 1, 11, 0, tzinfo=timezone.utc),
                    end_at=datetime(2099, 6, 1, 11, 30, tzinfo=timezone.utc),
                    timezone="UTC",
                    status="confirmed",
                    booked_date=date(2099, 6, 1),
                ),
            ]
        )
        self.db.commit()

        bookings = booking_services.list_client_bookings(self.db, tenant_id=10, email=" Grace@Example.com ")

        self.assertEqual([booking.id for booking in bookings], [201])
        self.assertEqual(booking_services.get_client_booking_or_404(self.db, tenant_id=10, email="grace@example.com", booking_id=201).id, 201)
        with self.assertRaises(Exception) as exc:
            booking_services.get_client_booking_or_404(self.db, tenant_id=10, email="grace@example.com", booking_id=202)
        self.assertIn("Booking not found", str(exc.exception))


if __name__ == "__main__":
    unittest.main()
