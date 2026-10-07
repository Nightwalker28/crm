"""Dependent picklists and country → state (13b Phase 4 slice 4b, F3.6)."""

import unittest
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.subdivisions import has_subdivisions, resolve_subdivision
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.platform.models import PicklistDependency
from app.modules.platform.services import picklist_dependencies, picklists
from app.modules.platform.services.picklists import PicklistResolver, normalize_address_states
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus


MODULE = "sales_opportunities"


class SubdivisionTests(unittest.TestCase):
    def test_codes_names_and_spellings_resolve_to_the_bundled_name(self):
        self.assertEqual(resolve_subdivision("US", "ca"), "California")
        self.assertEqual(resolve_subdivision("us", "US-NY"), "New York")
        self.assertEqual(resolve_subdivision("LK", "western province"), "Western Province")
        self.assertEqual(resolve_subdivision("GB", "Wales"), "Wales")  # "[Cymru GB-CYM]" stripped
        self.assertEqual(resolve_subdivision("IN", "Arunachal Pradesh"), "Arunāchal Pradesh")  # accents folded
        self.assertIsNone(resolve_subdivision("US", "Ontario"))
        self.assertFalse(has_subdivisions(None))

    def test_state_is_checked_against_its_country(self):
        data = {"billing_country": "US", "billing_state": "ny"}
        normalize_address_states("sales_organizations", data)
        self.assertEqual(data["billing_state"], "New York")

        with self.assertRaises(HTTPException) as caught:
            normalize_address_states("sales_organizations", {"billing_country": "US", "billing_state": "Ontario"})
        self.assertEqual(caught.exception.detail[0]["loc"], ["body", "billing_state"])

        # A country with no list, or no country, keeps free text.
        free = {"shipping_country": "AQ", "shipping_state": "Ross Dependency"}
        normalize_address_states("sales_organizations", free)
        self.assertEqual(free["shipping_state"], "Ross Dependency")
        self.assertEqual(normalize_address_states("sales_contacts", {"mailing_state": "Anywhere"})["mailing_state"], "Anywhere")

    def test_changing_the_country_under_a_state_it_lacks_is_refused(self):
        account = SimpleNamespace(billing_country="US", billing_state="California")
        with self.assertRaises(HTTPException):
            normalize_address_states("sales_organizations", {"billing_country": "LK"}, existing=account)
        cleared = normalize_address_states("sales_organizations", {"billing_country": "LK", "billing_state": ""}, existing=account)
        self.assertIsNone(cleared["billing_state"])
        # Unrelated writes do not re-check a stored state.
        self.assertEqual(normalize_address_states("sales_organizations", {"industry": "x"}, existing=account), {"industry": "x"})

    def test_contact_mailing_state_uses_the_contact_country(self):
        data = {"country": "AU", "mailing_state": "nsw"}
        normalize_address_states("sales_contacts", data)
        self.assertEqual(data["mailing_state"], "New South Wales")


class PicklistDependencyTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default"),
                Tenant(id=20, slug="other", name="Other"),
                User(id=1, tenant_id=10, email="owner@example.com", first_name="Owner", is_active=UserStatus.active),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def _save(self, value_map, *, dependent="lost_reason", controlling="deal_type", tenant_id=10):
        return picklist_dependencies.save_dependency(
            self.db,
            tenant_id=tenant_id,
            module_key=MODULE,
            dependent_field_key=dependent,
            controlling_field_key=controlling,
            value_map=value_map,
            actor_user_id=1,
        )

    def _enforce(self, payload, existing=None, tenant_id=10):
        return picklist_dependencies.enforce_picklist_dependencies(
            self.db, tenant_id=tenant_id, module_key=MODULE, payload=payload, existing=existing
        )

    def test_saving_validates_fields_values_and_loops(self):
        with self.assertRaises(HTTPException):
            self._save({}, dependent="opportunity_name")
        with self.assertRaises(HTTPException):
            self._save({"not_a_type": ["price"]})
        with self.assertRaises(HTTPException):
            self._save({"new_business": ["not_a_reason"]})
        self._save({"new_business": ["price", "price", "competitor"]})
        stored = self.db.query(PicklistDependency).one()
        self.assertEqual(stored.value_map, {"new_business": ["price", "competitor"]})
        with self.assertRaises(HTTPException) as loop:
            self._save({}, dependent="deal_type", controlling="lost_reason")
        self.assertIn("other way round", loop.exception.detail[0]["msg"])

    def test_dependent_value_must_be_allowed_by_the_controlling_value(self):
        self._save({"new_business": ["price", "competitor"]})
        self.assertEqual(self._enforce({"deal_type": "new_business", "lost_reason": "price"})["lost_reason"], "price")
        # Labels resolve too, as the picklist check would.
        self._enforce({"deal_type": "New business", "lost_reason": "Went with a competitor"})
        with self.assertRaises(HTTPException) as refused:
            self._enforce({"deal_type": "new_business", "lost_reason": "timing"})
        self.assertEqual(refused.exception.detail[0]["loc"], ["body", "lost_reason"])
        # A controlling value missing from the map allows nothing; an empty one allows nothing.
        with self.assertRaises(HTTPException):
            self._enforce({"deal_type": "existing_business", "lost_reason": "price"})
        with self.assertRaises(HTTPException):
            self._enforce({"lost_reason": "price"})
        # An empty dependent is always fine.
        self._enforce({"deal_type": "existing_business", "lost_reason": None})

    def test_update_checks_the_stored_side(self):
        self._save({"new_business": ["price"]})
        deal = SimpleNamespace(deal_type="new_business", lost_reason="price")
        with self.assertRaises(HTTPException) as changed:
            self._enforce({"deal_type": "existing_business"}, existing=deal)
        self.assertEqual(changed.exception.detail[0]["loc"], ["body", "deal_type"])
        self._enforce({"amount": 5}, existing=deal)

    def test_dependencies_are_tenant_scoped(self):
        self._save({"new_business": ["price"]})
        self.assertEqual(picklist_dependencies.list_dependencies(self.db, tenant_id=20, module_key=MODULE), [])
        self._enforce({"deal_type": "existing_business", "lost_reason": "timing"}, tenant_id=20)

    def test_merging_a_value_moves_it_in_the_maps(self):
        self._save({"new_business": ["price", "timing"]})
        reasons = picklists.get_picklist(self.db, 10, "lost_reason")
        picklists.merge_values(self.db, reasons, from_key="timing", into_key="no_decision", actor_user_id=1)
        stored = self.db.query(PicklistDependency).one()
        self.assertEqual(stored.value_map, {"new_business": ["price", "no_decision"]})

    def test_resolver_normalize_runs_the_state_check(self):
        data = {"billing_country": "United States", "billing_state": "Texas"}
        PicklistResolver(self.db, 10).normalize("sales_quotes", data)
        self.assertEqual(data, {"billing_country": "US", "billing_state": "Texas"})


if __name__ == "__main__":
    unittest.main()
