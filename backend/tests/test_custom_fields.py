import unittest
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import literal

from app.modules.platform.services.custom_fields import build_custom_field_filter_map, load_custom_field_values_with_fallback


class CustomFieldFilterTests(unittest.TestCase):
    def test_number_custom_field_filter_builds_without_json_numeric_cast_error(self):
        definition = SimpleNamespace(
            id=1,
            field_key="contract_value",
            field_type="number",
        )

        with patch(
            "app.modules.platform.services.custom_fields.list_custom_field_definitions",
            return_value=[definition],
        ):
            field_map = build_custom_field_filter_map(
                SimpleNamespace(),
                tenant_id=1,
                module_key="sales_organizations",
                record_id_expression=literal(42),
            )

        self.assertEqual(field_map["custom:contract_value"]["type"], "number")
        self.assertIn("expression", field_map["custom:contract_value"])


class CustomFieldHydrationFallbackTests(unittest.TestCase):
    def test_persisted_values_override_transient_fallback_cache(self):
        db = SimpleNamespace()
        with patch(
            "app.modules.platform.services.custom_fields.load_custom_field_values",
            return_value={"tier": "enterprise"},
        ) as load_values:
            values = load_custom_field_values_with_fallback(
                db,
                tenant_id=7,
                module_key="sales_contacts",
                record_id=42,
                fallback={"tier": "stale", "region": "emea"},
            )

        self.assertEqual(values, {"tier": "enterprise"})
        load_values.assert_called_once_with(
            db,
            tenant_id=7,
            module_key="sales_contacts",
            record_id=42,
        )

    def test_empty_persisted_values_use_pruned_transient_fallback_cache(self):
        with patch(
            "app.modules.platform.services.custom_fields.load_custom_field_values",
            return_value={},
        ):
            values = load_custom_field_values_with_fallback(
                SimpleNamespace(),
                tenant_id=7,
                module_key="sales_contacts",
                record_id=42,
                fallback={
                    "tier": "enterprise",
                    "empty_text": "",
                    "empty_list": [],
                    "empty_dict": {},
                    "false_boolean": False,
                },
            )

        self.assertEqual(values, {"tier": "enterprise", "false_boolean": False})


if __name__ == "__main__":
    unittest.main()
