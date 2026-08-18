import unittest
from unittest import mock
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.calendar.models import CalendarEvent
from app.modules.mail.models import MailMessage, MailRecordAssociation
from app.modules.platform.models import ActivityLog, RecordComment, RecordFollowUp
from app.modules.platform.services import record_activity
from app.modules.platform.services.record_activity import (
    ACTIVITY_TYPES,
    decode_cursor,
    encode_cursor,
    list_record_activity,
    parse_types,
)
from app.modules.sales.models import SalesContact, SalesLead
from app.modules.support.models import SupportCase, SupportCaseComment
from app.modules.tasks.models import Task
from app.modules.user_management.models import Module, Role, User, UserStatus
from app.modules.whatsapp.models import WhatsAppInteraction

# Imported for their side effect on Base.metadata so create_all can resolve
# every foreign key the projection touches.
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.user_management import models as user_management_models  # noqa: F401


TENANT = 10
OTHER_TENANT = 20
BASE_TIME = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)


def at(minutes: int) -> datetime:
    """Naive UTC timestamp; SQLite stores DateTime(timezone=True) without offset."""
    return (BASE_TIME + timedelta(minutes=minutes)).replace(tzinfo=None)


class _AllowAllPolicy:
    def __init__(self, db, user):
        self.user = user

    def can_view_module(self, module_key: str) -> bool:
        return module_key not in getattr(self.user, "denied_modules", set())

    def can_perform_action(self, module_key: str, action: str) -> bool:
        return module_key not in getattr(self.user, "denied_modules", set())


class RecordActivityProjectionTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()

        self._policy_patch = mock.patch.object(
            record_activity, "PermissionPolicy", _AllowAllPolicy
        )
        self._policy_patch.start()
        self.addCleanup(self._policy_patch.stop)

        self.db.add_all(
            [
                Module(id=1, name="sales_leads", base_route="sales_leads", is_enabled=1),
                Role(id=1, tenant_id=TENANT, name="Admin", level=100),
                User(
                    id=1,
                    tenant_id=TENANT,
                    email="rep@example.com",
                    first_name="Rae",
                    last_name="Rep",
                    role_id=1,
                    is_active=UserStatus.active,
                ),
            ]
        )
        for tenant_id in (TENANT, OTHER_TENANT):
            # Same lead_id in both tenants so isolation failures are visible.
            self.db.add(
                SalesLead(
                    lead_id=100 if tenant_id == TENANT else 101,
                    tenant_id=tenant_id,
                    first_name="Ada",
                    last_name="Lovelace",
                    primary_email=f"ada{tenant_id}@example.com",
                )
            )
        self.db.commit()

        self.user = SimpleNamespace(id=1, tenant_id=TENANT, denied_modules=set())

    def tearDown(self):
        self.db.close()

    def _seed_one_of_each(self, *, tenant_id=TENANT, entity_id="100", id_base=1):
        # Several of these models declare a plain BigInteger primary key, which
        # SQLite will not autoincrement, so ids are explicit here.
        self.db.add_all(
            [
                RecordFollowUp(
                    id=id_base,
                    tenant_id=tenant_id,
                    actor_user_id=1,
                    module_key="sales_leads",
                    entity_id=entity_id,
                    channel="call",
                    note="Left a voicemail.",
                    occurred_at=at(10),
                ),
                RecordComment(
                    id=id_base,
                    tenant_id=tenant_id,
                    actor_user_id=1,
                    module_key="sales_leads",
                    entity_id=entity_id,
                    body="Budget confirmed.",
                    created_at=at(20),
                ),
                Task(
                    id=id_base,
                    tenant_id=tenant_id,
                    title="Send pricing",
                    status="todo",
                    priority="medium",
                    source_module_key="sales_leads",
                    source_entity_id=entity_id,
                    created_by_user_id=1,
                    created_at=at(30),
                ),
                CalendarEvent(
                    id=id_base,
                    tenant_id=tenant_id,
                    owner_user_id=1,
                    title="Discovery call",
                    start_at=at(40),
                    end_at=at(70),
                    source_module_key="sales_leads",
                    source_entity_id=entity_id,
                ),
                MailMessage(
                    id=id_base,
                    tenant_id=tenant_id,
                    owner_user_id=1,
                    direction="outbound",
                    folder="sent",
                    subject="Proposal",
                    snippet="Attached is the proposal.",
                    sent_at=at(50),
                    source_module_key="sales_leads",
                    source_entity_id=entity_id,
                    created_at=at(50),
                ),
            ]
        )
        # Mail reaches the feed through the association rows the mail domain
        # writes, not through the mirrored source columns.
        self.db.add(
            MailRecordAssociation(
                tenant_id=tenant_id,
                message_id=id_base,
                module_key="sales_leads",
                entity_id=entity_id,
                association_type="primary",
            )
        )
        self.db.commit()

    def _list(self, **kwargs):
        return list_record_activity(
            self.db,
            user=self.user,
            module_key="sales_leads",
            entity_id="100",
            **kwargs,
        )

    # -- normalization ----------------------------------------------------- #

    def test_each_source_normalizes_into_the_shared_envelope(self):
        self._seed_one_of_each()
        result = self._list()

        by_type = {item["type"]: item for item in result["items"]}
        self.assertEqual(
            set(by_type), {"follow_up", "note", "task", "meeting", "email"}
        )
        for item in result["items"]:
            self.assertEqual(item["record"], {"module_key": "sales_leads", "entity_id": "100"})
            self.assertEqual(item["id"], f"{item['type']}:{item['source']['record_id']}")
            self.assertTrue(item["occurred_at"].endswith("+00:00"))
            self.assertTrue(item["title"])

        self.assertEqual(by_type["follow_up"]["meta"]["channel"], "call")
        self.assertEqual(by_type["follow_up"]["summary"], "Left a voicemail.")
        self.assertEqual(by_type["note"]["summary"], "Budget confirmed.")
        self.assertEqual(by_type["task"]["status"], "todo")
        self.assertEqual(by_type["email"]["direction"], "outbound")
        self.assertEqual(by_type["meeting"]["source"]["module_key"], "calendar")
        self.assertEqual(by_type["follow_up"]["actor"]["name"], "Rae Rep")

    def test_email_projection_omits_body_and_provider_identifiers(self):
        self.db.add(
            MailMessage(
                id=1,
                tenant_id=TENANT,
                owner_user_id=1,
                direction="inbound",
                folder="inbox",
                subject="Re: Proposal",
                snippet="Looks good",
                body_text="full private body",
                provider_message_id="secret-provider-id",
                sent_at=at(5),
                source_module_key="sales_leads",
                source_entity_id="100",
                created_at=at(5),
            )
        )
        self.db.add(
            MailRecordAssociation(
                tenant_id=TENANT,
                message_id=1,
                module_key="sales_leads",
                entity_id="100",
                association_type="primary",
            )
        )
        self.db.commit()

        serialized = repr(self._list()["items"])
        self.assertNotIn("full private body", serialized)
        self.assertNotIn("secret-provider-id", serialized)

    def test_whatsapp_reports_external_link_mode_without_claiming_delivery(self):
        self.db.add(
            SalesContact(
                contact_id=5,
                tenant_id=TENANT,
                first_name="Ada",
                primary_email="ada@example.com",
            )
        )
        self.db.commit()
        self.db.add(
            WhatsAppInteraction(
                id=1,
                tenant_id=TENANT,
                actor_user_id=1,
                contact_id=5,
                phone_number="94771234567",
                message_body="Hello from Lynk",
                whatsapp_url="https://web.whatsapp.com/send?phone=94771234567",
                source_module_key="sales_leads",
                source_entity_id="100",
                sent_at=at(60),
            )
        )
        self.db.commit()

        items = self._list()["items"]
        whatsapp = next(item for item in items if item["type"] == "whatsapp")
        self.assertEqual(whatsapp["status"], "external_link")
        self.assertEqual(whatsapp["direction"], "outbound")
        self.assertNotIn("web.whatsapp.com", repr(whatsapp))

    # -- ordering, cursors, pagination ------------------------------------- #

    def test_items_are_ordered_newest_first_across_sources(self):
        self._seed_one_of_each()
        occurred = [item["occurred_at"] for item in self._list()["items"]]
        self.assertEqual(occurred, sorted(occurred, reverse=True))

    def test_same_timestamp_events_get_a_deterministic_tie_break(self):
        for index in range(1, 4):
            self.db.add(
                RecordComment(
                    id=index,
                    tenant_id=TENANT,
                    actor_user_id=1,
                    module_key="sales_leads",
                    entity_id="100",
                    body="tie",
                    created_at=at(10),
                )
            )
        self.db.add(
            Task(
                id=1,
                tenant_id=TENANT,
                title="tie task",
                status="todo",
                priority="medium",
                source_module_key="sales_leads",
                source_entity_id="100",
                created_by_user_id=1,
                created_at=at(10),
            )
        )
        self.db.commit()

        first = [item["id"] for item in self._list()["items"]]
        second = [item["id"] for item in self._list()["items"]]
        self.assertEqual(first, second)
        # note sorts before task, and note ids descend.
        self.assertEqual(first, ["note:3", "note:2", "note:1", "task:1"])

    def test_cursor_paging_walks_every_item_exactly_once(self):
        self._seed_one_of_each()
        for index in range(6):
            self.db.add(
                RecordComment(
                    id=10 + index,
                    tenant_id=TENANT,
                    actor_user_id=1,
                    module_key="sales_leads",
                    entity_id="100",
                    body=f"note {index}",
                    created_at=at(100 + index),
                )
            )
        self.db.commit()

        seen = []
        cursor = None
        for _ in range(20):
            page = self._list(limit=2, cursor=cursor)
            seen.extend(item["id"] for item in page["items"])
            cursor = page["next_cursor"]
            if not cursor:
                break

        self.assertIsNone(cursor)
        self.assertEqual(len(seen), 11)
        self.assertEqual(len(set(seen)), 11)
        self.assertEqual(seen, [item["id"] for item in self._list(limit=100)["items"]])

    def test_cursor_survives_a_tie_at_the_page_boundary(self):
        for index in range(1, 5):
            self.db.add(
                RecordComment(
                    id=index,
                    tenant_id=TENANT,
                    actor_user_id=1,
                    module_key="sales_leads",
                    entity_id="100",
                    body="tie",
                    created_at=at(10),
                )
            )
        self.db.commit()

        first = self._list(limit=2)
        second = self._list(limit=2, cursor=first["next_cursor"])
        ids = [item["id"] for item in first["items"] + second["items"]]
        self.assertEqual(ids, ["note:4", "note:3", "note:2", "note:1"])

    def test_cursor_round_trips_and_rejects_tampering(self):
        item = record_activity.ActivityItem(
            type="note",
            source_id=42,
            source_module_key="sales_leads",
            occurred_at=BASE_TIME,
            title="Note added",
        )
        self.assertEqual(decode_cursor(encode_cursor(item)), (BASE_TIME, "note", 42))
        with self.assertRaises(HTTPException) as ctx:
            decode_cursor("not-a-cursor!!")
        self.assertEqual(ctx.exception.status_code, 400)

    def test_last_page_reports_no_more_and_no_cursor(self):
        self._seed_one_of_each()
        page = self._list(limit=100)
        self.assertFalse(page["has_more"])
        self.assertIsNone(page["next_cursor"])

    # -- filters ------------------------------------------------------------ #

    def test_type_filter_restricts_the_feed(self):
        self._seed_one_of_each()
        page = self._list(types="note,task")
        self.assertEqual({item["type"] for item in page["items"]}, {"note", "task"})

    def test_unknown_type_filter_is_rejected(self):
        with self.assertRaises(HTTPException) as ctx:
            parse_types("note,telepathy")
        self.assertEqual(ctx.exception.status_code, 400)

    def test_empty_filter_defaults_to_every_type(self):
        self.assertEqual(parse_types(None), ACTIVITY_TYPES)
        self.assertEqual(parse_types("  "), ACTIVITY_TYPES)

    def test_filter_with_no_matches_returns_an_empty_page(self):
        self._seed_one_of_each()
        page = self._list(types="whatsapp")
        self.assertEqual(page["items"], [])
        self.assertFalse(page["has_more"])

    # -- permissions --------------------------------------------------------- #

    def test_source_module_denial_drops_that_source_entirely(self):
        self._seed_one_of_each()
        self.user.denied_modules = {"mail", "tasks"}

        page = self._list()
        types = {item["type"] for item in page["items"]}
        self.assertNotIn("email", types)
        self.assertNotIn("task", types)
        self.assertEqual(set(page["omitted_types"]), {"email", "task"})
        # Record-scoped sources still resolve.
        self.assertIn("note", types)
        self.assertIn("follow_up", types)

    def test_another_users_mailbox_stays_private_on_a_shared_record(self):
        # Colleague links their own mail to the same lead. Record access is not
        # mailbox access, so it must not appear in this viewer's feed.
        self.db.add(
            User(
                id=2,
                tenant_id=TENANT,
                email="colleague@example.com",
                first_name="Sam",
                role_id=1,
                is_active=UserStatus.active,
            )
        )
        self.db.add(
            MailMessage(
                id=900,
                tenant_id=TENANT,
                owner_user_id=2,
                direction="inbound",
                folder="inbox",
                subject="Private negotiation",
                sent_at=at(60),
                created_at=at(60),
            )
        )
        self.db.add(
            MailRecordAssociation(
                tenant_id=TENANT,
                message_id=900,
                module_key="sales_leads",
                entity_id="100",
                association_type="primary",
                created_by_user_id=2,
            )
        )
        self.db.commit()

        serialized = repr(self._list()["items"])
        self.assertNotIn("Private negotiation", serialized)

    def test_a_related_association_reaches_the_feed_of_the_second_record(self):
        # One message, two deliberate links: the feed must honour both, not
        # only the primary mirrored onto the message.
        self._seed_one_of_each()
        self.db.add(
            SalesLead(
                lead_id=200,
                tenant_id=TENANT,
                first_name="Grace",
                last_name="Hopper",
                primary_email="grace@example.com",
            )
        )
        self.db.add(
            MailRecordAssociation(
                tenant_id=TENANT,
                message_id=1,
                module_key="sales_leads",
                entity_id="200",
                association_type="related",
            )
        )
        self.db.commit()

        page = list_record_activity(
            self.db, user=self.user, module_key="sales_leads", entity_id="200"
        )
        emails = [item for item in page["items"] if item["type"] == "email"]
        self.assertEqual(len(emails), 1)
        self.assertEqual(emails[0]["meta"]["association_type"], "related")

    def test_record_module_denial_blocks_the_whole_feed(self):
        self.user.denied_modules = {"sales_leads"}
        with self.assertRaises(HTTPException) as ctx:
            self._list()
        self.assertEqual(ctx.exception.status_code, 403)

    def test_unsupported_record_module_is_rejected(self):
        with self.assertRaises(HTTPException) as ctx:
            list_record_activity(
                self.db, user=self.user, module_key="not_a_module", entity_id="1"
            )
        self.assertEqual(ctx.exception.status_code, 400)

    def test_missing_record_is_not_found(self):
        with self.assertRaises(HTTPException) as ctx:
            list_record_activity(
                self.db, user=self.user, module_key="sales_leads", entity_id="9999"
            )
        self.assertEqual(ctx.exception.status_code, 404)

    def test_limit_bounds_are_enforced(self):
        for bad_limit in (0, record_activity.MAX_LIMIT + 1):
            with self.assertRaises(HTTPException) as ctx:
                self._list(limit=bad_limit)
            self.assertEqual(ctx.exception.status_code, 400)

    # -- tenant isolation ----------------------------------------------------- #

    def test_another_tenant_activity_on_the_same_entity_id_is_invisible(self):
        # Matching entity_id "100" in both tenants, deliberately.
        self._seed_one_of_each(tenant_id=OTHER_TENANT, entity_id="100", id_base=1)
        self.assertEqual(self._list()["items"], [])

        self._seed_one_of_each(tenant_id=TENANT, entity_id="100", id_base=2)
        page = self._list(limit=100)
        self.assertEqual(len(page["items"]), 5)

    def test_a_record_from_another_tenant_is_not_found(self):
        self.user.tenant_id = OTHER_TENANT
        with self.assertRaises(HTTPException) as ctx:
            self._list()
        self.assertEqual(ctx.exception.status_code, 404)

    # -- soft deletes ---------------------------------------------------------- #

    def test_soft_deleted_sources_leave_the_feed(self):
        self._seed_one_of_each()
        self.db.query(Task).update({Task.deleted_at: at(80)})
        self.db.query(CalendarEvent).update({CalendarEvent.deleted_at: at(80)})
        self.db.query(MailMessage).update({MailMessage.deleted_at: at(80)})
        self.db.commit()

        types = {item["type"] for item in self._list()["items"]}
        self.assertEqual(types, {"follow_up", "note"})

    # -- audit separation -------------------------------------------------------- #

    def test_audit_log_rows_never_enter_the_relationship_feed(self):
        self.db.add(
            ActivityLog(
                id=1,
                tenant_id=TENANT,
                actor_user_id=1,
                module_key="sales_leads",
                entity_type="sales_lead",
                entity_id="100",
                action="update",
                description="Changed status",
                created_at=at(15),
            )
        )
        self.db.commit()
        self.assertEqual(self._list()["items"], [])


class SupportCaseReplyAdapterTests(unittest.TestCase):
    """The case conversation reaches the feed through the support domain's own FK.

    `design.md` §4.7 puts one composer at the top of one Timeline, and a support case was
    the page carrying two comment systems at once. The reply thread is linked by
    ``case_id`` rather than the generic module_key/entity_id pair, so this adapter has to
    stay inert for every other record type — which is most of what these tests check.
    """

    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()

        self._policy_patch = mock.patch.object(
            record_activity, "PermissionPolicy", _AllowAllPolicy
        )
        self._policy_patch.start()
        self.addCleanup(self._policy_patch.stop)

        self.db.add_all(
            [
                Module(id=1, name="support_cases", base_route="support_cases", is_enabled=1),
                Role(id=1, tenant_id=TENANT, name="Admin", level=100),
                User(
                    id=1,
                    tenant_id=TENANT,
                    email="agent@example.com",
                    first_name="Sam",
                    last_name="Agent",
                    role_id=1,
                    is_active=UserStatus.active,
                ),
            ]
        )
        for tenant_id in (TENANT, OTHER_TENANT):
            self.db.add(
                SupportCase(
                    id=7 if tenant_id == TENANT else 8,
                    tenant_id=tenant_id,
                    case_number=f"CASE-{tenant_id}",
                    subject="Cannot log in",
                    status="open",
                    priority="medium",
                )
            )
        self.db.commit()
        self.user = SimpleNamespace(id=1, tenant_id=TENANT, denied_modules=set())

    def tearDown(self):
        self.db.close()

    def _reply(self, comment_id, *, tenant_id=TENANT, case_id=7, is_internal=False, body="Reset link sent.", minutes=10):
        self.db.add(
            SupportCaseComment(
                id=comment_id,
                tenant_id=tenant_id,
                case_id=case_id,
                author_id=1,
                body=body,
                is_internal=is_internal,
                created_at=at(minutes),
            )
        )
        self.db.commit()

    def _list(self, module_key="support_cases", entity_id="7", **kwargs):
        return list_record_activity(
            self.db,
            user=self.user,
            module_key=module_key,
            entity_id=entity_id,
            **kwargs,
        )

    def test_a_customer_reply_reaches_the_feed(self):
        self._reply(1)

        items = self._list()["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["type"], "case_reply")
        self.assertEqual(items[0]["title"], "Reply sent to customer")
        self.assertEqual(items[0]["summary"], "Reset link sent.")
        self.assertEqual(items[0]["actor"], {"user_id": 1, "name": "Sam Agent"})
        self.assertIs(items[0]["meta"]["is_internal"], False)

    def test_an_internal_note_is_marked_rather_than_hidden(self):
        self._reply(1, is_internal=True, body="Escalating to tier two.")

        item = self._list()["items"][0]
        self.assertEqual(item["title"], "Internal note added")
        self.assertIs(item["meta"]["is_internal"], True)
        # Direction is what the feed paints as outbound contact; an internal note is not.
        self.assertIsNone(item["direction"])

    def test_another_tenants_reply_on_the_same_case_id_is_invisible(self):
        self._reply(1, tenant_id=OTHER_TENANT, case_id=7, body="Other tenant reply.")

        self.assertEqual(self._list()["items"], [])

    def test_a_reply_on_another_case_stays_there(self):
        self._reply(1, case_id=8, body="Different case.")

        self.assertEqual(self._list()["items"], [])

    def test_the_adapter_is_inert_for_a_record_that_is_not_a_case(self):
        # A lead's entity_id can collide with a case id; linkage is the FK, not the number.
        self.db.add(
            SalesLead(lead_id=7, tenant_id=TENANT, first_name="Ada", last_name="Lovelace", primary_email="ada@example.com")
        )
        self.db.add(Module(id=2, name="sales_leads", base_route="sales_leads", is_enabled=1))
        self.db.commit()
        self._reply(1)

        self.assertEqual(self._list(module_key="sales_leads", entity_id="7")["items"], [])

    def test_a_lead_is_never_offered_a_replies_filter(self):
        # `available_types` is what the UI builds its filter strip from. A source that can
        # never apply to this record type is not an empty source — offering it puts a
        # filter on screen that cannot ever match, which is what the browser pass caught.
        self.db.add(
            SalesLead(lead_id=7, tenant_id=TENANT, first_name="Ada", last_name="Lovelace", primary_email="ada@example.com")
        )
        self.db.add(Module(id=2, name="sales_leads", base_route="sales_leads", is_enabled=1))
        self.db.commit()

        lead_types = self._list(module_key="sales_leads", entity_id="7")["available_types"]
        case_types = self._list()["available_types"]

        self.assertNotIn("case_reply", lead_types)
        self.assertIn("case_reply", case_types)
        # Everything not module-specific is offered on both.
        self.assertIn("note", lead_types)
        self.assertIn("note", case_types)

    def test_replies_are_a_filterable_type_like_every_other_source(self):
        self._reply(1, minutes=10)
        self._reply(2, is_internal=True, minutes=20)

        self.assertIn("case_reply", ACTIVITY_TYPES)
        items = self._list(types="case_reply")["items"]
        self.assertEqual([item["id"] for item in items], ["case_reply:2", "case_reply:1"])


class RecordFollowUpSourceTests(unittest.TestCase):
    """The follow-up domain owns its own table rather than reading audit rows."""

    def test_logging_a_lead_follow_up_writes_a_source_row(self):
        from app.modules.sales.services import followups

        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        db = sessionmaker(bind=engine)()
        self.addCleanup(db.close)

        lead = SalesLead(
            lead_id=100,
            tenant_id=TENANT,
            first_name="Ada",
            last_name="Lovelace",
            primary_email="ada@example.com",
        )
        db.add(lead)
        db.commit()

        current_user = SimpleNamespace(id=1, tenant_id=TENANT)
        contacted_at = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
        with (
            mock.patch.object(followups, "_utcnow", return_value=contacted_at),
            mock.patch.object(followups, "log_activity"),
        ):
            followups.log_lead_follow_up(
                db,
                lead=lead,
                payload={
                    "channel": "call",
                    "note": "  Spoke briefly.  ",
                    "create_follow_up_task": False,
                    "follow_up_due_at": None,
                },
                current_user=current_user,
            )

        rows = db.query(RecordFollowUp).all()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].module_key, "sales_leads")
        self.assertEqual(rows[0].entity_id, "100")
        self.assertEqual(rows[0].channel, "call")
        self.assertEqual(rows[0].note, "Spoke briefly.")
        self.assertEqual(rows[0].actor_user_id, 1)
        self.assertIsNone(rows[0].follow_up_task_id)


if __name__ == "__main__":
    unittest.main()
