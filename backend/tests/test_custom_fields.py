import unittest
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import literal

from app.modules.platform.services.custom_fields import build_custom_field_filter_map


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


if __name__ == "__main__":
    unittest.main()
