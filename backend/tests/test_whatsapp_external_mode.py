"""External (click-to-chat) WhatsApp — 06-whatsapp-business.md Phase 1.

The regression suite for the mode that must survive every later provider phase: the
contact click flow end to end, the truthfulness of what it records, and the mode and
capability contract the UI resolves its WhatsApp action from.
"""

import unittest
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from fastapi import HTTPException
from fastapi.routing import APIRoute
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.platform.models import ActivityLog, MessageTemplate
from app.modules.sales.models import SalesContact
from app.modules.sales.services import followups
from app.modules.tasks.models import Task, TaskAssignee
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import CompanyProfile, Module, Role, User, UserStatus
from app.modules.whatsapp.models import WhatsAppInteraction
from app.modules.whatsapp.routes import whatsapp_routes
from app.modules.whatsapp.services import whatsapp_services
from app.modules.whatsapp.services.whatsapp_services import (
    ASK_EACH_TIME,
    DEFAULT_POLICY,
    EXTERNAL_LINK,
    META_CLOUD_API,
    WhatsAppPolicy,
    record_contact_whatsapp_click,
    resolve_whatsapp_capabilities,
)


TENANT = 10
OTHER_TENANT = 20


class _Fixture(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.addCleanup(self.db.close)

        self.user = User(
            id=1,
            tenant_id=TENANT,
            email="rep@example.com",
            first_name="Rae",
            last_name="Rep",
            role_id=1,
            is_active=UserStatus.active,
        )
        self.db.add_all(
            [
                Module(id=1, name="sales_contacts", base_route="sales_contacts", is_enabled=1),
                Module(id=2, name="tasks", base_route="tasks", is_enabled=1),
                Role(id=1, tenant_id=TENANT, name="Admin", level=100),
                self.user,
                CompanyProfile(id=1, tenant_id=TENANT, name="Acme", country="Sri Lanka"),
                # A national-format number: only the company country makes it dialable.
                SalesContact(
                    contact_id=7,
                    tenant_id=TENANT,
                    first_name="Amaan",
                    last_name="Perera",
                    primary_email="amaan@example.com",
                    contact_telephone="077 123 4567",
                ),
                SalesContact(
                    contact_id=8,
                    tenant_id=TENANT,
                    first_name="No",
                    last_name="Phone",
                    primary_email="nophone@example.com",
                ),
                SalesContact(
                    contact_id=9,
                    tenant_id=OTHER_TENANT,
                    first_name="Other",
                    primary_email="other@example.com",
                    contact_telephone="+94 77 000 0000",
                ),
                MessageTemplate(
                    id=1,
                    tenant_id=TENANT,
                    template_key="follow_up",
                    name="Follow-up",
                    channel="whatsapp",
                    module_key="sales_contacts",
                    body="Hi {{first_name}}, following up.",
                    is_system=True,
                    is_active=True,
                ),
                MessageTemplate(
                    id=2,
                    tenant_id=TENANT,
                    template_key="mail_follow_up",
                    name="Mail follow-up",
                    channel="email",
                    module_key="sales_contacts",
                    body="Hi {{first_name}}.",
                    is_active=True,
                ),
                MessageTemplate(
                    id=3,
                    tenant_id=OTHER_TENANT,
                    template_key="follow_up",
                    name="Theirs",
                    channel="whatsapp",
                    module_key="sales_contacts",
                    body="Not yours.",
                    is_active=True,
                ),
            ]
        )
        self.db.commit()

    def click(self, **kwargs):
        kwargs.setdefault("contact_id", 7)
        return record_contact_whatsapp_click(self.db, current_user=self.user, **kwargs)

    def assert_nothing_written(self):
        self.db.expire_all()
        self.assertEqual(self.db.query(WhatsAppInteraction).count(), 0)
        self.assertEqual(self.db.query(Task).count(), 0)
        self.assertEqual(self.db.query(ActivityLog).count(), 0)
        self.assertIsNone(self.db.get(SalesContact, 7).whatsapp_last_contacted_at)


class ExternalClickFlowTests(_Fixture):
    def test_prepares_the_chat_and_records_it_as_prepared(self):
        result = self.click()

        self.assertEqual(result["mode"], EXTERNAL_LINK)
        self.assertEqual(result["status"], "prepared")
        self.assertEqual(result["phone_number"], "94771234567")
        self.assertEqual(result["message_body"], "Hi Amaan, following up.")
        self.assertEqual(result["template_id"], 1)
        url = urlparse(result["whatsapp_url"])
        self.assertEqual((url.scheme, url.netloc, url.path), ("https", "web.whatsapp.com", "/send"))
        self.assertEqual(parse_qs(url.query), {"phone": ["94771234567"], "text": ["Hi Amaan, following up."]})
        self.assertIsNone(result["follow_up_task"])

        interaction = self.db.query(WhatsAppInteraction).one()
        self.assertEqual(interaction.id, result["interaction_id"])
        self.assertEqual(interaction.tenant_id, TENANT)
        self.assertEqual(interaction.actor_user_id, 1)
        self.assertEqual((interaction.source_module_key, interaction.source_entity_id), ("sales_contacts", "7"))
        self.assertEqual(interaction.whatsapp_url, result["whatsapp_url"])
        self.assertIsNone(interaction.follow_up_task_id)
        self.assertIsNotNone(self.db.get(SalesContact, 7).whatsapp_last_contacted_at)

        audit = self.db.query(ActivityLog).one()
        self.assertEqual((audit.module_key, audit.entity_id, audit.action), ("sales_contacts", "7", "whatsapp_click"))
        self.assertEqual(audit.description, "Prepared WhatsApp message for Amaan Perera")
        self.assertEqual(audit.after_state["mode"], EXTERNAL_LINK)
        self.assertEqual(audit.after_state["status"], "prepared")
        self.assertEqual(audit.after_state["interaction_id"], interaction.id)

    def test_claims_no_provider_outcome(self):
        result = self.click()
        audit = self.db.query(ActivityLog).one()

        for claim in ("sent", "delivered", "read", "failed"):
            self.assertNotEqual(result["status"], claim)
            self.assertNotIn(f"{claim}_at", result)
            self.assertNotIn(f"{claim}_at", audit.after_state)
        self.assertNotIn("provider_message_id", result)

    def test_the_contacts_own_country_wins_over_the_company_country(self):
        contact = self.db.get(SalesContact, 7)
        contact.country = "+44"
        contact.contact_telephone = "07700 900123"
        self.db.commit()

        self.assertEqual(self.click()["phone_number"], "447700900123")

    def test_an_explicit_template_and_variables_are_rendered(self):
        template = self.db.get(MessageTemplate, 1)
        template.body = "Hi {{first_name}}, quote {{quote_number}} is ready."
        self.db.commit()

        result = self.click(template_id=1, variables={"quote_number": "Q-42"})

        self.assertEqual(result["message_body"], "Hi Amaan, quote Q-42 is ready.")

    def test_the_reminder_is_linked_to_the_contact_and_commits_with_the_interaction(self):
        with patch.object(followups, "_require_task_create_access") as task_access:
            result = self.click(create_follow_up_task_flag=True)

        task_access.assert_called_once()
        task = self.db.query(Task).one()
        self.assertEqual(result["follow_up_task"]["id"], task.id)
        self.assertEqual(task.tenant_id, TENANT)
        self.assertEqual(task.title, "Follow up on WhatsApp with Amaan Perera")
        self.assertEqual(task.description, "Follow up after WhatsApp outreach to Amaan Perera.")
        # Linked, so the reminder shows on the contact's Tasks like every other follow-up.
        self.assertEqual((task.source_module_key, task.source_entity_id), ("sales_contacts", "7"))
        assignee = self.db.query(TaskAssignee).filter(TaskAssignee.task_id == task.id).one()
        self.assertEqual(assignee.user_id, 1)
        self.assertEqual(self.db.query(WhatsAppInteraction).one().follow_up_task_id, task.id)
        actions = {row.action for row in self.db.query(ActivityLog).all()}
        self.assertLessEqual({"whatsapp_click", "task.follow_up_created"}, actions)

    def test_a_custom_reminder_title_is_kept(self):
        with patch.object(followups, "_require_task_create_access"):
            self.click(create_follow_up_task_flag=True, follow_up_title="  Ask about the PO  ")

        self.assertEqual(self.db.query(Task).one().title, "Ask about the PO")

    def test_no_task_access_refuses_before_anything_is_written(self):
        refusal = HTTPException(status_code=403, detail="No access to tasks")
        with patch.object(followups, "_require_task_create_access", side_effect=refusal):
            with self.assertRaises(HTTPException) as caught:
                self.click(create_follow_up_task_flag=True)

        self.assertEqual(caught.exception.status_code, 403)
        self.assert_nothing_written()

    def test_a_contact_without_a_phone_is_refused(self):
        with self.assertRaises(HTTPException) as caught:
            self.click(contact_id=8)

        self.assertEqual((caught.exception.status_code, caught.exception.detail), (400, "Contact has no phone number"))
        self.db.expire_all()
        self.assertEqual(self.db.query(WhatsAppInteraction).count(), 0)
        self.assertEqual(self.db.query(ActivityLog).count(), 0)

    def test_a_national_number_with_no_country_anywhere_is_refused(self):
        self.db.get(CompanyProfile, 1).country = None
        self.db.commit()

        with self.assertRaises(HTTPException) as caught:
            self.click()

        self.assertEqual(caught.exception.detail, "Contact phone number needs a country code for WhatsApp")
        self.assert_nothing_written()

    def test_another_tenants_contact_is_not_found(self):
        with self.assertRaises(HTTPException) as caught:
            self.click(contact_id=9)

        self.assertEqual(caught.exception.status_code, 404)
        self.assertEqual(self.db.query(WhatsAppInteraction).count(), 0)

    def test_a_recycle_binned_contact_is_not_found(self):
        from datetime import datetime, timezone

        self.db.get(SalesContact, 7).deleted_at = datetime(2026, 9, 1, tzinfo=timezone.utc)
        self.db.commit()

        with self.assertRaises(HTTPException) as caught:
            self.click()

        self.assertEqual(caught.exception.status_code, 404)

    def test_another_tenants_template_is_not_found(self):
        with self.assertRaises(HTTPException) as caught:
            self.click(template_id=3)

        self.assertEqual((caught.exception.status_code, caught.exception.detail), (404, "Message template not found"))
        self.assert_nothing_written()

    def test_a_template_for_another_channel_is_refused(self):
        with self.assertRaises(HTTPException) as caught:
            self.click(template_id=2)

        self.assertEqual((caught.exception.status_code, caught.exception.detail), (400, "Template is not a WhatsApp template"))
        self.assert_nothing_written()

    def test_no_active_whatsapp_template_is_refused(self):
        self.db.get(MessageTemplate, 1).is_active = False
        self.db.commit()

        with self.assertRaises(HTTPException) as caught:
            self.click()

        self.assertEqual(caught.exception.status_code, 404)
        self.assert_nothing_written()

    def test_a_policy_without_external_mode_refuses_the_click(self):
        no_external = WhatsAppPolicy(enabled_modes=(META_CLOUD_API,), default_mode=META_CLOUD_API)
        with patch.object(whatsapp_services, "get_tenant_whatsapp_policy", return_value=no_external):
            with self.assertRaises(HTTPException) as caught:
                self.click()

        self.assertEqual(caught.exception.status_code, 403)
        self.assert_nothing_written()


class CapabilityResolutionTests(_Fixture):
    def modes(self, resolved):
        return {item["mode"]: item for item in resolved["modes"]}

    def test_every_tenant_resolves_to_external_only_by_default(self):
        for tenant_id in (TENANT, OTHER_TENANT):
            resolved = whatsapp_services.get_whatsapp_capabilities(
                self.db, current_user=SimpleNamespace(id=1, tenant_id=tenant_id)
            )
            self.assertEqual(resolved["default_mode"], EXTERNAL_LINK)
            self.assertEqual(resolved["effective_mode"], EXTERNAL_LINK)
            external = self.modes(resolved)[EXTERNAL_LINK]
            self.assertTrue(external["enabled"] and external["available"])
            self.assertIsNone(external["unavailable_reason"])
            meta = self.modes(resolved)[META_CLOUD_API]
            self.assertFalse(meta["enabled"] or meta["available"])

    def test_external_mode_promises_nothing_it_cannot_know(self):
        external = self.modes(resolve_whatsapp_capabilities(DEFAULT_POLICY, meta_configured=False))[EXTERNAL_LINK]

        self.assertEqual(
            (external["sends_from_crm"], external["tracks_delivery"], external["receives_inbound"]),
            (False, False, False),
        )

    def test_an_enabled_but_unconnected_provider_is_not_configured(self):
        policy = WhatsAppPolicy(enabled_modes=(EXTERNAL_LINK, META_CLOUD_API), default_mode=META_CLOUD_API)
        resolved = resolve_whatsapp_capabilities(policy, meta_configured=False)

        self.assertEqual(self.modes(resolved)[META_CLOUD_API]["unavailable_reason"], "not_configured")
        # The default points at a provider that cannot be used, so the action falls back
        # to the allowed mode that can, rather than disappearing.
        self.assertEqual(resolved["effective_mode"], EXTERNAL_LINK)

    def test_a_connected_provider_does_not_become_the_default_by_itself(self):
        policy = WhatsAppPolicy(enabled_modes=(EXTERNAL_LINK, META_CLOUD_API), default_mode=EXTERNAL_LINK)

        self.assertEqual(resolve_whatsapp_capabilities(policy, meta_configured=True)["effective_mode"], EXTERNAL_LINK)

    def test_ask_each_time_needs_two_usable_modes(self):
        both = WhatsAppPolicy(enabled_modes=(EXTERNAL_LINK, META_CLOUD_API), default_mode=ASK_EACH_TIME)

        self.assertEqual(resolve_whatsapp_capabilities(both, meta_configured=True)["effective_mode"], ASK_EACH_TIME)
        self.assertEqual(resolve_whatsapp_capabilities(both, meta_configured=False)["effective_mode"], EXTERNAL_LINK)

    def test_a_mode_the_policy_disabled_is_never_chosen(self):
        meta_only = WhatsAppPolicy(enabled_modes=(META_CLOUD_API,), default_mode=META_CLOUD_API)
        resolved = resolve_whatsapp_capabilities(meta_only, meta_configured=False)

        self.assertEqual(self.modes(resolved)[EXTERNAL_LINK]["unavailable_reason"], "disabled_by_policy")
        self.assertIsNone(resolved["effective_mode"])

        misconfigured = WhatsAppPolicy(enabled_modes=(META_CLOUD_API,), default_mode=EXTERNAL_LINK)
        self.assertEqual(
            resolve_whatsapp_capabilities(misconfigured, meta_configured=True)["effective_mode"], META_CLOUD_API
        )


class RouteTests(unittest.TestCase):
    def route(self, path):
        return next(
            route
            for route in whatsapp_routes.router.routes
            if isinstance(route, APIRoute) and route.path == path
        )

    def checkers(self, route):
        found = {}
        for dependency in route.dependant.dependencies:
            name = dependency.call.__qualname__
            if name.startswith(("require_action_access.", "require_module_access.")):
                found[name] = {cell.cell_contents for cell in dependency.call.__closure__ or ()}
        return found

    def test_the_click_needs_edit_on_contacts_like_the_follow_up_log(self):
        checkers = self.checkers(self.route("/whatsapp/contacts/{contact_id}/click"))

        self.assertEqual(checkers["require_module_access.<locals>.checker"], {"sales_contacts"})
        self.assertEqual(checkers["require_action_access.<locals>.checker"], {"sales_contacts", "edit"})

    def test_capabilities_are_workspace_policy_behind_sign_in(self):
        route = self.route("/whatsapp/capabilities")

        self.assertEqual(route.methods, {"GET"})
        self.assertEqual(self.checkers(route), {})
        self.assertIn("require_user", {dependency.call.__name__ for dependency in route.dependant.dependencies})


if __name__ == "__main__":
    unittest.main()
