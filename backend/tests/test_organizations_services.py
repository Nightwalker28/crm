import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.modules.sales.schema import SalesOrganizationCreate
from app.modules.sales.services import organizations_services
from app.modules.user_management.models import User  # noqa: F401


class FakeQuery:
    def filter(self, *conditions):
        return self

    def first(self):
        return None


class FakeDB:
    def __init__(self):
        self.events = []
        self.commits = 0

    def query(self, *_entities):
        return FakeQuery()

    def add(self, value):
        self.events.append("add")
        self.organization = value

    def flush(self):
        self.events.append("flush")
        self.organization.org_id = 44

    def commit(self):
        self.events.append("commit")
        self.commits += 1

    def refresh(self, _value):
        self.events.append("refresh")


class CreateOrganizationTransactionTests(unittest.TestCase):
    def test_create_organization_flushes_custom_fields_before_single_commit(self):
        db = FakeDB()
        current_user = SimpleNamespace(id=7, tenant_id=3)
        payload = SalesOrganizationCreate(
            org_name="Acme",
            primary_email="ops@acme.example",
            custom_fields={"tier": "enterprise"},
        )
        saved_calls = []

        def fake_save_custom_field_values(*args, **kwargs):
            db.events.append("save_custom_fields")
            saved_calls.append(kwargs)

        with patch.object(organizations_services, "validate_custom_field_payload", return_value={"tier": "enterprise"}), \
             patch.object(organizations_services, "save_custom_field_values", side_effect=fake_save_custom_field_values), \
             patch.object(organizations_services, "hydrate_custom_field_record", side_effect=lambda *args, **kwargs: kwargs["record"]):
            organization = organizations_services.create_organization(db, payload, current_user)

        self.assertEqual(organization.org_id, 44)
        self.assertEqual(db.events, ["add", "flush", "save_custom_fields", "commit", "refresh"])
        self.assertEqual(db.commits, 1)
        self.assertEqual(saved_calls[0]["tenant_id"], 3)
        self.assertEqual(saved_calls[0]["record_id"], 44)
        self.assertEqual(saved_calls[0]["values"], {"tier": "enterprise"})


class OrganizationQueryBuildTests(unittest.TestCase):
    def test_build_organization_query_always_uses_ranked_search_helper(self):
        db = FakeDB()
        calls = []

        def fake_apply_ranked_search(query, *, search, document, default_order_column):
            calls.append(search)
            return query

        with patch.object(organizations_services, "apply_ranked_search", side_effect=fake_apply_ranked_search), \
             patch.object(organizations_services, "build_custom_field_filter_map", return_value={}):
            organizations_services._build_organization_query(db, tenant_id=3, search=None)
            organizations_services._build_organization_query(db, tenant_id=3, search="acme")

        self.assertEqual(calls, [None, "acme"])


if __name__ == "__main__":
    unittest.main()
