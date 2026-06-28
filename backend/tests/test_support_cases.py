import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.sales.models import SalesContact, SalesOpportunity, SalesOrder, SalesOrganization, SalesQuote
from app.modules.support.models import SupportCase
from app.modules.support.services import cases_services
from app.modules.support.services.cases_services import (
    add_case_comment,
    add_client_support_case_comment,
    create_client_support_case,
    create_support_case,
    get_case_or_404,
    get_client_support_case_or_404,
    list_client_support_cases,
    list_support_cases,
    serialize_client_support_case,
    update_client_support_case_status,
    update_support_case,
)
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus


class SupportCaseTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.user = SimpleNamespace(id=1, tenant_id=10)
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default"),
                Tenant(id=99, slug="other", name="Other"),
                User(id=1, tenant_id=10, email="owner@example.com", first_name="Owner", last_name="User", is_active=UserStatus.active),
                User(id=2, tenant_id=10, email="agent@example.com", first_name="Agent", last_name="User", is_active=UserStatus.active),
                User(id=3, tenant_id=99, email="other@example.com", first_name="Other", last_name="User", is_active=UserStatus.active),
                SalesOrganization(org_id=20, tenant_id=10, org_name="Acme", primary_email="hello@acme.test"),
                SalesOrganization(org_id=99, tenant_id=99, org_name="Other", primary_email="hello@other.test"),
                SalesContact(contact_id=30, tenant_id=10, first_name="Ada", primary_email="ada@acme.test", assigned_to=1, organization_id=20),
                SalesContact(contact_id=31, tenant_id=10, first_name="Babbage", primary_email="bab@example.test", assigned_to=1),
                SalesOpportunity(opportunity_id=40, tenant_id=10, opportunity_name="Acme Pilot", client="Ada", contact_id=30, organization_id=20),
                SalesQuote(quote_id=50, tenant_id=10, quote_number="Q-500", customer_name="Acme", status="accepted", currency="USD"),
                SalesOrder(id=60, tenant_id=10, order_number="SO-60", status="confirmed", currency="USD"),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_create_case_links_customer_records_and_events(self):
        item = create_support_case(
            self.db,
            {
                "subject": "Customer needs help",
                "description": "Cannot access order",
                "category": "technical",
                "priority": "high",
                "contact_id": 30,
                "organization_id": 20,
                "opportunity_id": 40,
                "quote_id": 50,
                "order_id": 60,
                "assigned_to_id": 2,
            },
            self.user,
        )

        self.assertEqual(item.tenant_id, 10)
        self.assertTrue(item.case_number.startswith("CASE-"))
        self.assertEqual(item.status, "new")
        self.assertEqual(item.category, "technical")
        self.assertEqual(item.priority, "high")
        self.assertEqual(item.contact_id, 30)
        self.assertEqual(len(item.events), 1)
        self.assertEqual(item.events[0].event_type, "created")

    def test_create_case_retries_generated_number_collision(self):
        self.db.add(
            SupportCase(
                tenant_id=10,
                case_number="CASE-DUP",
                subject="Existing case",
                status="new",
                priority="medium",
            )
        )
        self.db.commit()

        with patch.object(
            cases_services,
            "_generate_case_number",
            side_effect=["CASE-DUP", "CASE-NEXT"],
        ):
            item = create_support_case(self.db, {"subject": "Retry me"}, self.user)

        self.assertEqual(item.case_number, "CASE-NEXT")
        self.assertEqual(self.db.query(SupportCase).filter(SupportCase.tenant_id == 10).count(), 2)
        self.assertEqual(item.events[0].event_type, "created")

    def test_create_case_rejects_cross_tenant_link(self):
        with self.assertRaises(HTTPException) as exc:
            create_support_case(
                self.db,
                {"subject": "Bad link", "organization_id": 99},
                self.user,
            )

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Organization not found")

    def test_update_status_sets_resolution_timestamps(self):
        item = create_support_case(self.db, {"subject": "Resolve me"}, self.user)

        updated = update_support_case(self.db, item, {"status": "resolved"}, self.user)

        self.assertEqual(updated.status, "resolved")
        self.assertIsNotNone(updated.resolved_at)
        self.assertEqual(updated.events[-1].event_type, "status_changed")

    def test_service_owned_lifecycle_fields_are_ignored_on_create_and_update(self):
        supplied = datetime(2026, 1, 1, tzinfo=timezone.utc)
        item = create_support_case(
            self.db,
            {
                "subject": "Lifecycle ownership",
                "sla_due_at": supplied,
                "first_response_at": supplied,
                "resolved_at": supplied,
                "closed_at": supplied,
            },
            self.user,
        )

        self.assertIsNone(item.sla_due_at)
        self.assertIsNone(item.first_response_at)
        self.assertIsNone(item.resolved_at)
        self.assertIsNone(item.closed_at)

        updated = update_support_case(
            self.db,
            item,
            {
                "priority": "high",
                "sla_due_at": supplied,
                "first_response_at": supplied,
                "resolved_at": supplied,
                "closed_at": supplied,
            },
            self.user,
        )

        self.assertEqual(updated.priority, "high")
        self.assertIsNone(updated.sla_due_at)
        self.assertIsNone(updated.first_response_at)
        self.assertIsNone(updated.resolved_at)
        self.assertIsNone(updated.closed_at)

    def test_partial_update_does_not_revalidate_unchanged_linked_records(self):
        item = create_support_case(self.db, {"subject": "Linked update", "contact_id": 30}, self.user)

        with patch.object(cases_services, "_linked_exists", side_effect=AssertionError("unchanged links were revalidated")):
            updated = update_support_case(self.db, item, {"priority": "urgent"}, self.user)

        self.assertEqual(updated.priority, "urgent")
        self.assertEqual(updated.contact_id, 30)

    def test_category_length_is_enforced_at_service_boundary(self):
        with self.assertRaises(HTTPException) as exc:
            create_support_case(self.db, {"subject": "Bad category", "category": "x" * 81}, self.user)

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Category must be 80 characters or fewer")

    def test_comment_sets_first_response_once(self):
        item = create_support_case(self.db, {"subject": "Needs response"}, self.user)

        comment = add_case_comment(self.db, item, {"body": "We are checking this."}, self.user)
        reloaded = get_case_or_404(self.db, tenant_id=10, case_id=item.id)

        self.assertEqual(comment.body, "We are checking this.")
        self.assertIsNotNone(reloaded.first_response_at)
        self.assertEqual(len(reloaded.comments), 1)

    def test_comment_rolls_back_on_integrity_failure(self):
        item = create_support_case(self.db, {"subject": "Needs response"}, self.user)
        failure = IntegrityError("INSERT", {}, Exception("comment failed"))

        with patch.object(self.db, "commit", side_effect=failure):
            with self.assertRaises(HTTPException) as exc:
                add_case_comment(self.db, item, {"body": "This should roll back"}, self.user)

        self.assertEqual(exc.exception.status_code, 409)
        self.assertEqual(exc.exception.detail, "Support case comment could not be created")
        self.assertEqual(get_case_or_404(self.db, tenant_id=10, case_id=item.id).comments, [])

    def test_status_update_rolls_back_on_integrity_failure(self):
        item = create_support_case(self.db, {"subject": "Resolve me"}, self.user)
        failure = IntegrityError("UPDATE", {}, Exception("status failed"))

        with patch.object(self.db, "commit", side_effect=failure):
            with self.assertRaises(HTTPException) as exc:
                update_support_case(self.db, item, {"status": "resolved"}, self.user)

        self.assertEqual(exc.exception.status_code, 409)
        self.assertEqual(exc.exception.detail, "Support case could not be updated")
        reloaded = get_case_or_404(self.db, tenant_id=10, case_id=item.id)
        self.assertEqual(reloaded.status, "new")
        self.assertIsNone(reloaded.resolved_at)

    def test_get_case_scopes_by_tenant(self):
        item = create_support_case(self.db, {"subject": "Tenant scoped"}, self.user)

        with self.assertRaises(HTTPException) as exc:
            get_case_or_404(self.db, tenant_id=99, case_id=item.id)

        self.assertEqual(exc.exception.status_code, 404)
        self.assertEqual(self.db.query(SupportCase).filter(SupportCase.tenant_id == 10).count(), 1)

    def test_list_cases_sorts_before_pagination(self):
        create_support_case(self.db, {"subject": "Small issue", "priority": "low"}, self.user)
        create_support_case(self.db, {"subject": "Major issue", "priority": "urgent"}, self.user)
        create_support_case(self.db, {"subject": "Regular issue", "priority": "medium"}, self.user)

        cases, total_count = list_support_cases(
            self.db,
            tenant_id=10,
            pagination=SimpleNamespace(offset=0, limit=1),
            sort_by="subject",
            sort_direction="asc",
        )

        self.assertEqual(total_count, 3)
        self.assertEqual([case.subject for case in cases], ["Major issue"])

    def test_support_search_treats_like_wildcards_as_literal_text(self):
        create_support_case(self.db, {"subject": "Invoice is 100% blocked"}, self.user)
        create_support_case(self.db, {"subject": "Invoice is 1000 blocked"}, self.user)
        create_support_case(self.db, {"subject": "Alpha_Beta error"}, self.user)
        create_support_case(self.db, {"subject": "AlphaXBeta error"}, self.user)

        percent_cases, percent_total = list_support_cases(
            self.db,
            tenant_id=10,
            pagination=SimpleNamespace(offset=0, limit=10),
            search="100%",
        )
        underscore_cases, underscore_total = list_support_cases(
            self.db,
            tenant_id=10,
            pagination=SimpleNamespace(offset=0, limit=10),
            search="alpha_",
        )

        self.assertEqual(percent_total, 1)
        self.assertEqual([case.subject for case in percent_cases], ["Invoice is 100% blocked"])
        self.assertEqual(underscore_total, 1)
        self.assertEqual([case.subject for case in underscore_cases], ["Alpha_Beta error"])

    def test_text_contains_filter_treats_like_wildcards_as_literal_text_and_caps_value(self):
        create_support_case(self.db, {"subject": "Filter value has 100% match"}, self.user)
        create_support_case(self.db, {"subject": "Filter value has 1000 match"}, self.user)

        cases, total_count = list_support_cases(
            self.db,
            tenant_id=10,
            pagination=SimpleNamespace(offset=0, limit=10),
            all_filter_conditions=[{"field": "subject", "operator": "contains", "value": "100%"}],
        )

        self.assertEqual(total_count, 1)
        self.assertEqual([case.subject for case in cases], ["Filter value has 100% match"])
        with self.assertRaises(ValueError):
            list_support_cases(
                self.db,
                tenant_id=10,
                pagination=SimpleNamespace(offset=0, limit=10),
                all_filter_conditions=[{"field": "subject", "operator": "contains", "value": "x" * 257}],
            )

    def test_client_support_case_is_scoped_and_hides_internal_comments(self):
        first = create_client_support_case(
            self.db,
            tenant_id=10,
            contact_id=30,
            organization_id=20,
            payload={"subject": "Portal help", "description": "Need help", "category": "technical", "priority": "high"},
        )
        second = create_client_support_case(
            self.db,
            tenant_id=10,
            contact_id=31,
            organization_id=None,
            payload={"subject": "Other portal help", "category": "billing", "priority": "low"},
        )
        add_client_support_case_comment(self.db, case=first, payload={"body": "Client reply"})
        add_case_comment(self.db, first, {"body": "Public team reply", "is_internal": False}, self.user)
        add_case_comment(self.db, first, {"body": "Internal note", "is_internal": True}, self.user)

        cases = list_client_support_cases(self.db, tenant_id=10, contact_id=30, organization_id=20)
        serialized = serialize_client_support_case(get_client_support_case_or_404(self.db, tenant_id=10, contact_id=30, organization_id=20, case_id=first.id))
        detail = get_case_or_404(self.db, tenant_id=10, case_id=first.id)

        self.assertEqual([case.id for case in cases], [first.id])
        self.assertEqual(serialized["category"], "technical")
        self.assertEqual([comment["body"] for comment in serialized["comments"]], ["Client reply", "Public team reply"])
        self.assertEqual([comment["author_display_name"] for comment in serialized["comments"]], ["Client", "Owner User"])
        self.assertEqual([comment.author_name for comment in detail.comments], [None, "Owner User", "Owner User"])
        with self.assertRaises(HTTPException) as exc:
            get_client_support_case_or_404(self.db, tenant_id=10, contact_id=30, organization_id=20, case_id=second.id)
        self.assertEqual(exc.exception.status_code, 404)

    def test_support_case_responses_include_assignee_display_name(self):
        item = create_support_case(self.db, {"subject": "Assigned case", "assigned_to_id": 2}, self.user)

        detail = get_case_or_404(self.db, tenant_id=10, case_id=item.id)
        cases, _ = list_support_cases(self.db, tenant_id=10, pagination=SimpleNamespace(offset=0, limit=10))

        self.assertEqual(detail.assigned_to_name, "Agent User")
        self.assertEqual(next(case.assigned_to_name for case in cases if case.id == item.id), "Agent User")

    def test_client_quick_questions_are_source_scoped(self):
        ticket = create_client_support_case(
            self.db,
            tenant_id=10,
            contact_id=30,
            organization_id=20,
            payload={"subject": "Formal ticket", "category": "technical"},
        )
        question = create_client_support_case(
            self.db,
            tenant_id=10,
            contact_id=30,
            organization_id=20,
            payload={"subject": "Quick question", "description": "Can you confirm this?", "category": "question"},
            source="CLIENT_PORTAL_MESSAGE",
            event_type="client_message_created",
        )

        tickets = list_client_support_cases(self.db, tenant_id=10, contact_id=30, organization_id=20)
        messages = list_client_support_cases(self.db, tenant_id=10, contact_id=30, organization_id=20, source="client_portal_message")

        self.assertEqual([case.id for case in tickets], [ticket.id])
        self.assertEqual([case.id for case in messages], [question.id])
        self.assertEqual(question.source, "client_portal_message")
        self.assertEqual(
            get_client_support_case_or_404(
                self.db,
                tenant_id=10,
                contact_id=30,
                organization_id=20,
                case_id=question.id,
                source="CLIENT_PORTAL_MESSAGE",
            ).id,
            question.id,
        )
        with self.assertRaises(HTTPException) as exc:
            get_client_support_case_or_404(self.db, tenant_id=10, contact_id=30, organization_id=20, case_id=ticket.id, source="client_portal_message")
        self.assertEqual(exc.exception.status_code, 404)

    def test_client_create_retries_generated_number_collision(self):
        self.db.add(
            SupportCase(
                tenant_id=10,
                case_number="CASE-CLIENT-DUP",
                subject="Existing client case",
                status="new",
                priority="medium",
                source="client_portal",
                contact_id=30,
                organization_id=20,
            )
        )
        self.db.commit()

        with patch.object(
            cases_services,
            "_generate_case_number",
            side_effect=["CASE-CLIENT-DUP", "CASE-CLIENT-NEXT"],
        ):
            item = create_client_support_case(
                self.db,
                tenant_id=10,
                contact_id=30,
                organization_id=20,
                payload={"subject": "Retry portal case"},
            )

        self.assertEqual(item.case_number, "CASE-CLIENT-NEXT")
        self.assertEqual(item.source, "client_portal")

    def test_client_can_close_and_reopen_own_case(self):
        item = create_client_support_case(
            self.db,
            tenant_id=10,
            contact_id=30,
            organization_id=20,
            payload={"subject": "Close me", "category": "general"},
        )

        closed = update_client_support_case_status(self.db, case=item, action="close")
        self.assertEqual(closed.status, "closed")
        self.assertIsNotNone(closed.closed_at)

        reopened = update_client_support_case_status(self.db, case=closed, action="reopen")
        self.assertEqual(reopened.status, "open")
        self.assertIsNone(reopened.closed_at)


if __name__ == "__main__":
    unittest.main()
