"""Tenant-managed picklists (13b Phase 1)."""

import unittest
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.platform.models import AutomationRule, Picklist, PicklistValue
from app.modules.platform.services import picklists
from app.modules.platform.services.picklists import PicklistResolver
from app.modules.sales.models import SalesContact, SalesLead, SalesOrganization
from app.modules.sales.services import leads_services
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserSavedView, UserStatus


class PicklistTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default"),
                Tenant(id=20, slug="other", name="Other"),
                User(id=1, tenant_id=10, email="owner@example.com", first_name="Owner", is_active=UserStatus.active),
                User(id=2, tenant_id=20, email="other@example.com", first_name="Other", is_active=UserStatus.active),
            ]
        )
        self.db.commit()
        self.user = SimpleNamespace(id=1, tenant_id=10, team_id=None)

    def tearDown(self):
        self.db.close()

    def _list(self, key: str, tenant_id: int = 10) -> Picklist:
        return picklists.get_picklist(self.db, tenant_id, key)

    # --- seeding and resolving ---------------------------------------------------------

    def test_system_lists_are_seeded_once_per_tenant(self):
        first = picklists.ensure_picklist(self.db, 10, "lead_status")
        again = picklists.ensure_picklist(self.db, 10, "lead_status")
        other = picklists.ensure_picklist(self.db, 20, "lead_status")
        self.assertEqual(first.id, again.id)
        self.assertNotEqual(first.id, other.id)
        self.assertEqual([value.key for value in first.values], ["new", "contacted", "qualified", "unqualified", "converted"])
        self.assertEqual({value.meaning for value in first.values}, {"open", "working", "qualified", "unqualified", "converted"})
        country = picklists.ensure_picklist(self.db, 10, "country")
        self.assertTrue(country.is_locked)
        self.assertIn("LK", {value.key for value in country.values})

    def test_resolver_matches_key_label_and_country_spelling(self):
        resolver = PicklistResolver(self.db, 10)
        self.assertEqual(resolver.resolve("lead_source", "referral"), "referral")
        self.assertEqual(resolver.resolve("lead_source", "  Social   MEDIA "), "social_media")
        self.assertEqual(resolver.resolve("country", "Sri Lanka"), "LK")
        self.assertEqual(resolver.resolve("country", "usa"), "US")
        self.assertIsNone(resolver.resolve("lead_source", "   "))

    def test_unknown_value_is_refused_on_its_field_unless_creation_is_allowed(self):
        with self.assertRaises(HTTPException) as caught:
            PicklistResolver(self.db, 10).resolve("industry", "Space mining", field_key="industry", field_label="Industry")
        self.assertEqual(caught.exception.status_code, 422)
        self.assertEqual(caught.exception.detail[0]["loc"], ["body", "industry"])
        creating = PicklistResolver(self.db, 10, allow_create=True)
        key = creating.resolve("industry", "Space mining")
        self.assertEqual(key, "space_mining")
        self.assertEqual(creating.created, [("industry", "space_mining")])
        with self.assertRaises(HTTPException):
            PicklistResolver(self.db, 10, allow_create=True).resolve("country", "Atlantis")

    def test_inactive_value_stays_on_its_record_but_cannot_be_chosen_again(self):
        industry = self._list("industry")
        picklists.update_value(self.db, industry, "retail", {"is_active": False}, actor_user_id=1)
        resolver = PicklistResolver(self.db, 10)
        self.assertEqual(resolver.resolve("industry", "retail", current="retail"), "retail")
        with self.assertRaises(HTTPException):
            resolver.resolve("industry", "retail", current="healthcare")

    # --- administration ---------------------------------------------------------------

    def test_rename_keeps_the_key(self):
        source = self._list("lead_source")
        picklists.update_value(self.db, source, "website", {"label": "Web form"}, actor_user_id=1)
        self.assertEqual(PicklistResolver(self.db, 10).resolve("lead_source", "Web form"), "website")

    def test_locked_list_only_switches_values(self):
        country = self._list("country")
        with self.assertRaises(HTTPException):
            picklists.add_value(self.db, 10, country, label="Atlantis", actor_user_id=1)
        with self.assertRaises(HTTPException):
            picklists.update_value(self.db, country, "LK", {"label": "Ceylon"}, actor_user_id=1)
        picklists.update_value(self.db, country, "LK", {"is_default": True}, actor_user_id=1)
        picklists.update_value(self.db, country, "AQ", {"is_active": False}, actor_user_id=1)
        self.assertEqual(PicklistResolver(self.db, 10).default_key("country"), "LK")

    def test_meanings_keep_their_invariants(self):
        status = self._list("lead_status")
        with self.assertRaises(HTTPException):
            picklists.update_value(self.db, status, "converted", {"is_active": False}, actor_user_id=1)
        with self.assertRaises(HTTPException):
            picklists.add_value(self.db, 10, status, label="Nurturing", actor_user_id=1)  # no meaning
        added = picklists.add_value(self.db, 10, status, label="Nurturing", meaning="working", actor_user_id=1)
        self.assertEqual(added.key, "nurturing")
        with self.assertRaises(HTTPException):
            picklists.update_value(self.db, status, "qualified", {"is_default": True}, actor_user_id=1)
        picklists.update_value(self.db, status, "nurturing", {"is_default": True}, actor_user_id=1)
        self.assertEqual(PicklistResolver(self.db, 10).default_key("lead_status"), "nurturing")

    def test_reorder_needs_every_value_once(self):
        unit = self._list("unit")
        picklists.add_value(self.db, 10, unit, label="Box", actor_user_id=1)
        with self.assertRaises(HTTPException):
            picklists.reorder_values(self.db, unit, ["box"], actor_user_id=1)
        picklists.reorder_values(self.db, unit, ["box", "unit"], actor_user_id=1)
        self.assertEqual([value.key for value in self._list("unit").values], ["box", "unit"])

    def test_merge_rewrites_records_views_and_rules_then_deactivates(self):
        self.db.add_all(
            [
                SalesLead(tenant_id=10, primary_email="a@example.com", status="new", source="event"),
                SalesLead(tenant_id=10, primary_email="b@example.com", status="new", source="referral"),
                SalesLead(tenant_id=20, primary_email="c@example.com", status="new", source="event"),
                UserSavedView(
                    id=1, user_id=1, module_key="sales_leads", name="Events",
                    config={"filters": {"all_conditions": [{"field": "source", "operator": "in", "values": ["event", "referral"]}]}},
                ),
                AutomationRule(
                    tenant_id=10, name="Event leads", trigger_event="lead.created", enabled=True,
                    conditions_json=[{"field": "payload.source", "operator": "equals", "value": "event"}], actions_json=[],
                ),
            ]
        )
        self.db.commit()
        moved = picklists.merge_values(self.db, self._list("lead_source"), from_key="event", into_key="referral", actor_user_id=1)
        self.db.commit()
        self.assertEqual(moved, {"records": 1, "views": 1, "rules": 1})
        sources = {lead.primary_email: lead.source for lead in self.db.query(SalesLead).all()}
        self.assertEqual(sources, {"a@example.com": "referral", "b@example.com": "referral", "c@example.com": "event"})
        view = self.db.query(UserSavedView).one()
        self.assertEqual(view.config["filters"]["all_conditions"][0]["values"], ["referral"])
        rule = self.db.query(AutomationRule).one()
        self.assertEqual(rule.conditions_json[0]["value"], "referral")
        event = next(value for value in self._list("lead_source").values if value.key == "event")
        self.assertFalse(event.is_active)

    def test_merge_refuses_a_different_meaning(self):
        with self.assertRaises(HTTPException):
            picklists.merge_values(self.db, self._list("lead_status"), from_key="unqualified", into_key="qualified", actor_user_id=1)

    def test_unmatched_values_are_listed_and_resolved(self):
        self.db.add_all(
            [
                SalesOrganization(tenant_id=10, org_name="A", industry="Fintech"),
                SalesOrganization(tenant_id=10, org_name="B", industry="Fintech"),
                SalesOrganization(tenant_id=10, org_name="C", industry="retail"),
                SalesContact(tenant_id=10, primary_email="x@example.com", country="Narnia"),
            ]
        )
        self.db.commit()
        industry = self._list("industry")
        self.assertEqual(picklists.unmatched_values(self.db, industry), [{"value": "Fintech", "count": 2, "fields": ["Industry"]}])
        result = picklists.resolve_unmatched(self.db, industry, raw="Fintech", into_key=None, actor_user_id=1)
        self.assertEqual(result, {"records": 2, "key": "fintech"})
        self.assertEqual(picklists.unmatched_values(self.db, self._list("industry")), [])
        country = self._list("country")
        with self.assertRaises(HTTPException):
            picklists.resolve_unmatched(self.db, country, raw="Narnia", into_key=None, actor_user_id=1)
        picklists.resolve_unmatched(self.db, country, raw="Narnia", into_key="GB", actor_user_id=1)
        self.assertEqual(self.db.query(SalesContact).one().country, "GB")

    def test_lists_are_tenant_scoped(self):
        picklists.add_value(self.db, 10, self._list("region"), label="Western", actor_user_id=1)
        self.assertEqual([value.key for value in self._list("region", tenant_id=20).values], [])
        with self.assertRaises(HTTPException):
            PicklistResolver(self.db, 20).resolve("region", "western")

    # --- lead status by meaning -----------------------------------------------------------

    def test_new_lead_takes_the_default_status_and_scoring_reads_the_meaning(self):
        status = self._list("lead_status")
        picklists.add_value(self.db, 10, status, label="Hot prospect", meaning="qualified", actor_user_id=1)
        self.db.commit()
        lead = leads_services.create_sales_lead(
            self.db, {"primary_email": "new@example.com", "source": "Website"}, self.user
        )
        self.assertEqual(lead.status, "new")
        self.assertEqual(lead.source, "website")
        updated = leads_services.update_sales_lead(self.db, lead, {"status": "Hot prospect"})
        self.assertEqual(updated.status, "hot_prospect")
        self.assertIn("qualified", {factor["key"] for factor in updated.score_record.factors_json})

    def test_conversion_uses_the_converted_meaning(self):
        status = self._list("lead_status")
        picklists.add_value(self.db, 10, status, label="Won over", meaning="converted", actor_user_id=1)
        picklists.update_value(self.db, status, "converted", {"is_active": False}, actor_user_id=1)
        self.db.commit()
        lead = SalesLead(tenant_id=10, primary_email="convert@example.com", first_name="Ada", status="new")
        self.db.add(lead)
        self.db.commit()
        leads_services.convert_sales_lead(self.db, lead, {"create_account": False, "create_contact": True}, current_user=self.user)
        self.db.commit()
        self.assertEqual(lead.status, "won_over")
        with self.assertRaises(HTTPException):
            leads_services.convert_sales_lead(self.db, lead, {"create_contact": True}, current_user=self.user)


if __name__ == "__main__":
    unittest.main()
