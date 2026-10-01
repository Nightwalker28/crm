"""Manual call logs — 07-telephony.md Phase 1.

A call log is the operator's report of a call Lynk did not place: what it records, on
which records it lands, who may write it, and that every refusal happens before anything
is written. Calls logged before this phase as Call follow-ups stay follow-ups.
"""

import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.routing import APIRoute
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.platform.models import ActivityLog, RecordFollowUp
from app.modules.platform.services import record_activity
from app.modules.sales.models import (
    SalesContact,
    SalesLead,
    SalesOpportunity,
    SalesOpportunityContact,
    SalesOrganization,
    SalesQuote,
)
from app.modules.sales.services import followups
from app.modules.tasks.models import Task
from app.modules.telephony.models import CallLog
from app.modules.telephony.routes import telephony_routes
from app.modules.telephony.schema import CallLogCreateRequest
from app.modules.telephony.services import call_logs
from app.modules.telephony.services.call_logs import log_record_call
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Module, Role, Tenant, User, UserStatus


TENANT = 10
OTHER_TENANT = 20
LEAD = 5
DEAL = 40
QUOTE = 50
ADA = 30  # the deal's primary contact, the quote's contact
GRACE = 31  # an active participant on the deal
LINUS = 32  # on no deal
ZOE = 33  # a participant whose contact is in the recycle bin
RIVAL = 60  # another tenant's contact
NOW = datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc)


def naive(value: datetime) -> datetime:
    """SQLite stores DateTime(timezone=True) without its offset."""
    return value.astimezone(timezone.utc).replace(tzinfo=None)


class _AllowAllPolicy:
    def __init__(self, db, user):
        pass

    def can_view_module(self, module_key):
        return True

    def can_perform_action(self, module_key, action):
        return True


class _Fixture(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.addCleanup(self.db.close)

        clock = patch.object(call_logs, "_utcnow", return_value=NOW)
        clock.start()
        self.addCleanup(clock.stop)

        self.user = User(
            id=1,
            tenant_id=TENANT,
            email="rep@example.com",
            first_name="Rae",
            last_name="Rep",
            role_id=1,
            is_active=UserStatus.active,
        )

        def contact(contact_id, name, **kwargs):
            return SalesContact(
                contact_id=contact_id,
                tenant_id=kwargs.pop("tenant_id", TENANT),
                first_name=name,
                primary_email=f"{name.lower()}@acme.example",
                contact_telephone=kwargs.pop("phone", f"+44 20 7946 00{contact_id}"),
                **kwargs,
            )

        self.db.add_all(
            [
                Tenant(id=TENANT, slug="default", name="Default"),
                Tenant(id=OTHER_TENANT, slug="rival", name="Rival"),
                Module(id=1, name="sales_leads", base_route="sales_leads", is_enabled=1),
                Module(id=2, name="sales_contacts", base_route="sales_contacts", is_enabled=1),
                Module(id=3, name="sales_opportunities", base_route="sales_opportunities", is_enabled=1),
                Module(id=4, name="sales_quotes", base_route="sales_quotes", is_enabled=1),
                Module(id=5, name="tasks", base_route="tasks", is_enabled=1),
                Role(id=1, tenant_id=TENANT, name="Admin", level=100),
                self.user,
                SalesOrganization(org_id=20, tenant_id=TENANT, org_name="Acme"),
                SalesLead(
                    lead_id=LEAD,
                    tenant_id=TENANT,
                    first_name="Ada",
                    last_name="Lovelace",
                    primary_email="ada.lead@example.com",
                    phone=" +44 20 7946 0000 ",
                ),
                SalesLead(lead_id=6, tenant_id=OTHER_TENANT, first_name="Rival", primary_email="rival@example.com"),
                SalesLead(
                    lead_id=7,
                    tenant_id=TENANT,
                    first_name="Binned",
                    primary_email="binned@example.com",
                    deleted_at=NOW - timedelta(days=1),
                ),
                contact(ADA, "Ada"),
                contact(GRACE, "Grace"),
                contact(LINUS, "Linus"),
                contact(ZOE, "Zoe", deleted_at=NOW - timedelta(days=1)),
                contact(RIVAL, "Rival", tenant_id=OTHER_TENANT),
                SalesOpportunity(
                    opportunity_id=DEAL,
                    tenant_id=TENANT,
                    opportunity_name="Acme Pilot",
                    client="Ada",
                    contact_id=ADA,
                    organization_id=20,
                ),
                SalesOpportunityContact(tenant_id=TENANT, opportunity_id=DEAL, contact_id=ADA, role_key="decision_maker", is_primary=True),
                SalesOpportunityContact(tenant_id=TENANT, opportunity_id=DEAL, contact_id=GRACE, role_key="champion", is_primary=False),
                SalesOpportunityContact(tenant_id=TENANT, opportunity_id=DEAL, contact_id=ZOE, role_key="influencer", is_primary=False),
                SalesQuote(
                    quote_id=QUOTE,
                    tenant_id=TENANT,
                    quote_number="Q-500",
                    customer_name="Acme",
                    contact_id=ADA,
                    organization_id=20,
                    opportunity_id=DEAL,
                    status="draft",
                    currency="USD",
                    subtotal_amount=Decimal("100"),
                    discount_amount=Decimal("0"),
                    tax_amount=Decimal("0"),
                    total_amount=Decimal("100"),
                    assigned_to=1,
                ),
            ]
        )
        self.db.commit()

    def log(self, module_key="sales_leads", entity_id=LEAD, **payload):
        payload.setdefault("outcome", "connected")
        request = CallLogCreateRequest(**payload)
        return log_record_call(
            self.db,
            current_user=self.user,
            module_key=module_key,
            entity_id=str(entity_id),
            payload=request.model_dump(),
        )

    def refused(self, status_code, **kwargs):
        with self.assertRaises(HTTPException) as caught:
            self.log(**kwargs)
        self.assertEqual(caught.exception.status_code, status_code)
        self.assert_nothing_written()
        return caught.exception.detail

    def assert_nothing_written(self):
        self.db.expire_all()
        self.assertEqual(self.db.query(CallLog).count(), 0)
        self.assertEqual(self.db.query(Task).count(), 0)
        self.assertEqual(self.db.query(ActivityLog).count(), 0)
        self.assertIsNone(self.db.get(SalesLead, LEAD).last_contacted_at)


class CallLogTests(_Fixture):
    def test_records_what_the_operator_reported_and_nothing_more(self):
        result = self.log(direction="outbound", outcome="no_answer", duration_seconds=0, note="  Rang twice  ")

        call = self.db.query(CallLog).one()
        self.assertEqual(result["id"], call.id)
        self.assertEqual(call.tenant_id, TENANT)
        self.assertEqual(call.actor_user_id, 1)
        self.assertEqual((call.source_module_key, call.source_entity_id), ("sales_leads", str(LEAD)))
        self.assertEqual(call.capture, "manual")
        self.assertEqual((call.direction, call.outcome, call.duration_seconds), ("outbound", "no_answer", 0))
        self.assertEqual(call.note, "Rang twice")
        # The number on file, trimmed; a lead is not a contact, so no one is named.
        self.assertEqual(call.phone_number, "+44 20 7946 0000")
        self.assertIsNone(call.contact_id)
        self.assertEqual(call.occurred_at, naive(NOW))
        self.assertEqual(result["capture"], "manual")

    def test_stamps_the_record_and_audits_the_log(self):
        self.log(direction="inbound", outcome="connected", duration_seconds=240)

        lead = self.db.get(SalesLead, LEAD)
        self.assertEqual(lead.last_contacted_at, naive(NOW))
        self.assertEqual(lead.last_contacted_channel, "call")
        self.assertEqual(lead.last_contacted_by_user_id, 1)
        audit = self.db.query(ActivityLog).one()
        self.assertEqual((audit.module_key, audit.entity_id, audit.action), ("sales_leads", str(LEAD), "call.logged"))
        self.assertEqual(audit.description, "Logged inbound call for Ada Lovelace: Connected")
        self.assertEqual(audit.after_state["capture"], "manual")
        self.assertEqual(audit.after_state["duration_seconds"], 240)

    def test_an_earlier_call_logged_later_does_not_rewind_last_contacted(self):
        lead = self.db.get(SalesLead, LEAD)
        lead.last_contacted_at = NOW - timedelta(hours=1)
        lead.last_contacted_channel = "email"
        self.db.commit()

        self.log(occurred_at=NOW - timedelta(days=1))

        self.db.expire_all()
        lead = self.db.get(SalesLead, LEAD)
        self.assertEqual(lead.last_contacted_channel, "email")
        self.assertEqual(lead.last_contacted_at, naive(NOW - timedelta(hours=1)))
        self.assertEqual(self.db.query(CallLog).one().occurred_at, naive(NOW - timedelta(days=1)))

    def test_a_call_in_the_future_is_refused(self):
        detail = self.refused(422, occurred_at=NOW + timedelta(hours=1))
        self.assertEqual(detail, "A call cannot be logged in the future.")

    def test_a_few_minutes_of_clock_skew_is_not_the_future(self):
        self.log(occurred_at=NOW + timedelta(minutes=2))
        self.assertEqual(self.db.query(CallLog).count(), 1)

    def test_a_contacts_call_is_with_that_contact(self):
        self.log(module_key="sales_contacts", entity_id=GRACE)

        call = self.db.query(CallLog).one()
        self.assertEqual(call.contact_id, GRACE)
        self.assertEqual(call.phone_number, f"+44 20 7946 00{GRACE}")
        self.assertEqual(self.db.get(SalesContact, GRACE).last_contacted_channel, "call")

    def test_a_contacts_call_cannot_name_someone_else(self):
        self.refused(422, module_key="sales_contacts", entity_id=GRACE, contact_id=ADA)

    def test_a_leads_call_names_no_contact(self):
        self.refused(422, contact_id=ADA)

    def test_a_deals_call_may_name_any_person_on_the_deal(self):
        self.log(module_key="sales_opportunities", entity_id=DEAL, contact_id=GRACE)
        self.log(module_key="sales_opportunities", entity_id=DEAL, contact_id=ADA)

        calls = self.db.query(CallLog).order_by(CallLog.id).all()
        self.assertEqual([call.contact_id for call in calls], [GRACE, ADA])
        self.assertEqual(calls[0].phone_number, f"+44 20 7946 00{GRACE}")
        self.assertEqual(self.db.get(SalesOpportunity, DEAL).last_contacted_channel, "call")

    def test_a_deals_call_without_a_person_has_no_number(self):
        self.log(module_key="sales_opportunities", entity_id=DEAL)

        call = self.db.query(CallLog).one()
        self.assertIsNone(call.contact_id)
        self.assertIsNone(call.phone_number)

    def test_a_deals_call_refuses_anyone_not_on_it(self):
        for contact_id in (LINUS, ZOE, RIVAL, 999):
            with self.subTest(contact_id=contact_id):
                detail = self.refused(422, module_key="sales_opportunities", entity_id=DEAL, contact_id=contact_id)
                self.assertEqual(detail, call_logs.UNAVAILABLE_DEAL_CONTACT)

    def test_a_quotes_call_may_name_only_the_quotes_contact(self):
        self.refused(422, module_key="sales_quotes", entity_id=QUOTE, contact_id=GRACE)

        self.log(module_key="sales_quotes", entity_id=QUOTE, contact_id=ADA)
        self.assertEqual(self.db.query(CallLog).one().contact_id, ADA)

    def test_records_that_take_no_calls_are_refused(self):
        self.refused(404, module_key="sales_organizations", entity_id=20)
        self.refused(404, module_key="sales_orders", entity_id=1)

    def test_another_tenants_or_a_binned_record_is_not_found(self):
        self.refused(404, entity_id=6)
        self.refused(404, entity_id=7)
        self.refused(404, entity_id=999)

    def test_logging_needs_edit_on_the_record(self):
        class _ViewOnly(_AllowAllPolicy):
            def can_perform_action(self, module_key, action):
                return action == "view"

        with patch.object(call_logs, "PermissionPolicy", _ViewOnly):
            detail = self.refused(403)
        self.assertEqual(detail, "You cannot log calls on this record.")

    def test_a_disabled_or_unassigned_module_refuses(self):
        class _NoModule(_AllowAllPolicy):
            def can_view_module(self, module_key):
                return False

        with patch.object(call_logs, "PermissionPolicy", _NoModule):
            self.refused(403)

    def test_the_reminder_is_linked_to_the_record_and_committed_with_the_call(self):
        due = NOW + timedelta(days=2)
        with patch.object(followups, "_require_task_create_access") as task_access:
            result = self.log(outcome="left_voicemail", create_follow_up_task=True, follow_up_due_at=due)

        task_access.assert_called_once()
        task = self.db.query(Task).one()
        self.assertEqual(result["follow_up_task_id"], task.id)
        self.assertEqual((task.source_module_key, task.source_entity_id), ("sales_leads", str(LEAD)))
        self.assertEqual(task.title, "Follow up with Ada Lovelace")
        self.assertEqual(self.db.get(SalesLead, LEAD).next_follow_up_at, naive(due))

    def test_no_task_access_refuses_before_anything_is_written(self):
        refusal = HTTPException(status_code=403, detail="No access to tasks")
        with patch.object(followups, "_require_task_create_access", side_effect=refusal):
            self.refused(403, create_follow_up_task=True)


class CallLogContractTests(unittest.TestCase):
    def test_the_request_is_a_report_not_a_dial_request(self):
        for payload in (
            {"outcome": "ringing"},
            {"outcome": "connected", "direction": "sideways"},
            {"outcome": "connected", "duration_seconds": -1},
            {"outcome": "connected", "duration_seconds": 86_401},
            # No provider, and no number: the number is the record's, not the client's.
            {"outcome": "connected", "provider": "twilio"},
            {"outcome": "connected", "phone_number": "+1 555 0100"},
            {"direction": "outbound"},
        ):
            with self.subTest(payload=payload):
                with self.assertRaises(ValidationError):
                    CallLogCreateRequest(**payload)

    def test_the_route_is_registered_as_a_create(self):
        routes = [
            route
            for route in telephony_routes.router.routes
            if isinstance(route, APIRoute) and route.path == "/telephony/records/{module_key}/{entity_id}/calls"
        ]
        self.assertEqual(len(routes), 1)
        self.assertEqual(routes[0].methods, {"POST"})
        self.assertEqual(routes[0].status_code, 201)


class CallActivityTests(_Fixture):
    def setUp(self):
        super().setUp()
        policy = patch.object(record_activity, "PermissionPolicy", _AllowAllPolicy)
        policy.start()
        self.addCleanup(policy.stop)

    def feed(self, module_key, entity_id, types="call"):
        return record_activity.list_record_activity(
            self.db,
            user=self.user,
            module_key=module_key,
            entity_id=entity_id,
            types=types,
        )

    def test_a_logged_call_is_a_call_entry_with_the_reported_outcome(self):
        self.log(direction="inbound", outcome="left_message", duration_seconds=95, note="Call back Friday")

        (item,) = self.feed("sales_leads", LEAD)["items"]
        self.assertEqual(item["type"], "call")
        self.assertEqual(item["title"], "Inbound call")
        self.assertEqual(item["status"], "left_message")
        self.assertEqual(item["direction"], "inbound")
        self.assertEqual(item["summary"], "Call back Friday")
        self.assertEqual(item["actor"]["name"], "Rae Rep")
        self.assertEqual(item["source"]["module_key"], "telephony")
        self.assertEqual(item["meta"]["capture"], "manual")
        self.assertEqual(item["meta"]["duration_seconds"], 95)
        self.assertIsNone(item["meta"]["logged_on_module_key"])

    def test_a_deal_call_lands_on_the_deal_and_on_the_person_named(self):
        self.log(module_key="sales_opportunities", entity_id=DEAL, contact_id=GRACE)

        (on_deal,) = self.feed("sales_opportunities", DEAL)["items"]
        self.assertEqual(on_deal["meta"]["contact_name"], "Grace")
        self.assertEqual(on_deal["meta"]["contact_id"], GRACE)

        (on_grace,) = self.feed("sales_contacts", GRACE)["items"]
        self.assertEqual(on_grace["id"], on_deal["id"])
        self.assertEqual(on_grace["meta"]["logged_on_module_key"], "sales_opportunities")
        self.assertEqual(on_grace["meta"]["logged_on_entity_id"], str(DEAL))
        # On a contact's own Timeline the contact is not named back to itself.
        self.assertIsNone(on_grace["meta"]["contact_name"])

        # Linkage is the named person, never a number or a shared deal.
        self.assertEqual(self.feed("sales_contacts", ADA)["items"], [])

    def test_calls_never_cross_tenants(self):
        self.log(module_key="sales_opportunities", entity_id=DEAL, contact_id=GRACE)
        self.db.add(
            CallLog(
                tenant_id=OTHER_TENANT,
                source_module_key="sales_leads",
                source_entity_id=str(LEAD),
                contact_id=GRACE,
                capture="manual",
                direction="outbound",
                outcome="busy",
                occurred_at=naive(NOW),
            )
        )
        self.db.commit()

        self.assertEqual(len(self.feed("sales_contacts", GRACE)["items"]), 1)
        self.assertEqual(self.feed("sales_leads", LEAD)["items"], [])

    def test_calls_page_with_the_rest_of_the_feed(self):
        for minutes in range(3):
            self.log(occurred_at=NOW - timedelta(minutes=minutes))

        first = record_activity.list_record_activity(
            self.db, user=self.user, module_key="sales_leads", entity_id=LEAD, types="call", limit=2
        )
        second = record_activity.list_record_activity(
            self.db,
            user=self.user,
            module_key="sales_leads",
            entity_id=LEAD,
            types="call",
            limit=2,
            cursor=first["next_cursor"],
        )
        ids = [item["id"] for item in first["items"] + second["items"]]
        self.assertEqual(len(ids), 3)
        self.assertEqual(len(set(ids)), 3)
        self.assertFalse(second["has_more"])

    def test_call_is_offered_only_where_calls_are_logged(self):
        for module_key in ("sales_leads", "sales_contacts", "sales_opportunities", "sales_quotes"):
            self.assertIn("call", [a.type for a in record_activity.ADAPTERS if a.applies(module_key)])
        for module_key in ("sales_organizations", "sales_orders", "support_cases"):
            self.assertNotIn("call", [a.type for a in record_activity.ADAPTERS if a.applies(module_key)])

    def test_call_follow_ups_logged_before_this_phase_stay_follow_ups(self):
        # 07 §15: an old Call follow-up has no outcome, direction or duration, so it is not
        # relabelled as a call.
        self.db.add(
            RecordFollowUp(
                tenant_id=TENANT,
                actor_user_id=1,
                module_key="sales_leads",
                entity_id=str(LEAD),
                channel="call",
                note="Old call",
                occurred_at=naive(NOW - timedelta(days=3)),
            )
        )
        self.db.commit()

        feed = self.feed("sales_leads", LEAD, types="call,follow_up")
        (item,) = feed["items"]
        self.assertEqual(item["type"], "follow_up")
        self.assertEqual(item["title"], "Call follow-up logged")


if __name__ == "__main__":
    unittest.main()
