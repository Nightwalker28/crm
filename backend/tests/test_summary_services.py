import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.modules.sales.services import summary_services


class EmptyQuery:
    def filter(self, *conditions):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def limit(self, _value):
        return self

    def first(self):
        return None

    def all(self):
        return []


class EmptyDB:
    def query(self, *_entities):
        return EmptyQuery()


class SummaryHydrationTests(unittest.TestCase):
    def test_contact_summary_does_not_rehydrate_primary_contact(self):
        contact = SimpleNamespace(
            tenant_id=3,
            contact_id=11,
            organization_id=None,
        )

        with patch.object(summary_services, "hydrate_custom_field_record") as hydrate_one, \
             patch.object(summary_services, "hydrate_custom_field_records", side_effect=lambda *args, **kwargs: kwargs["records"]):
            summary = summary_services.build_contact_summary(EmptyDB(), contact)

        self.assertIs(summary["contact"], contact)
        hydrate_one.assert_not_called()

    def test_organization_summary_does_not_rehydrate_primary_organization(self):
        organization = SimpleNamespace(
            tenant_id=3,
            org_id=22,
            org_name="Acme",
        )

        with patch.object(summary_services, "hydrate_custom_field_record") as hydrate_one, \
             patch.object(summary_services, "hydrate_custom_field_records", side_effect=lambda *args, **kwargs: kwargs["records"]):
            summary = summary_services.build_organization_summary(EmptyDB(), organization)

        self.assertIs(summary["organization"], organization)
        hydrate_one.assert_not_called()

    def test_opportunity_summary_does_not_rehydrate_primary_opportunity(self):
        opportunity = SimpleNamespace(
            tenant_id=3,
            opportunity_id=33,
            contact_id=None,
            organization_id=None,
            campaign_type=None,
            delivery_format=None,
            tactics=None,
            target_audience=None,
        )

        with patch.object(summary_services, "hydrate_custom_field_record") as hydrate_one:
            summary = summary_services.build_opportunity_summary(EmptyDB(), opportunity)

        self.assertIs(summary["opportunity"], opportunity)
        hydrate_one.assert_not_called()


if __name__ == "__main__":
    unittest.main()
