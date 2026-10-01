import json
import unittest

from app.main import app
from scripts.export_layout_contract import PATH_PREFIX, build_contract


class LayoutContractExportTests(unittest.TestCase):
    def setUp(self):
        self.schema = app.openapi()

    def test_export_is_bounded_to_the_record_layout_family(self):
        contract = build_contract(self.schema)

        self.assertTrue(contract["paths"])
        for path in contract["paths"]:
            self.assertTrue(path.startswith(PATH_PREFIX), path)
        self.assertIn(f"{PATH_PREFIX}/{{module_key}}/{{surface}}/resolved", contract["paths"])

        # Unrelated API families must not leak into the pilot slice.
        self.assertLess(len(contract["paths"]), len(self.schema["paths"]))
        self.assertNotIn("/api/v1/sales/leads", contract["paths"])

    def test_referenced_schemas_are_included_transitively(self):
        schemas = build_contract(self.schema)["components"]["schemas"]

        self.assertIn("ResolvedRecordLayoutResponse", schemas)
        # Reached only through ResolvedRecordLayoutResponse -> section -> field.
        self.assertIn("ResolvedRecordLayoutSection", schemas)
        self.assertIn("ResolvedRecordLayoutField", schemas)
        # Reached only through the 422 response.
        self.assertIn("ValidationError", schemas)

        available = self.schema["components"]["schemas"]
        self.assertLess(len(schemas), len(available))

    def test_every_reference_in_the_slice_resolves_inside_the_slice(self):
        contract = build_contract(self.schema)
        schemas = contract["components"]["schemas"]
        prefix = "#/components/schemas/"

        def assert_refs_resolve(node):
            if isinstance(node, dict):
                ref = node.get("$ref")
                if isinstance(ref, str):
                    self.assertTrue(ref.startswith(prefix), ref)
                    self.assertIn(ref[len(prefix) :], schemas)
                for value in node.values():
                    assert_refs_resolve(value)
            elif isinstance(node, list):
                for item in node:
                    assert_refs_resolve(item)

        assert_refs_resolve(contract["paths"])
        assert_refs_resolve(schemas)

    def test_serialization_is_byte_stable(self):
        first = json.dumps(build_contract(app.openapi()), indent=2, sort_keys=True, ensure_ascii=False)
        second = json.dumps(build_contract(app.openapi()), indent=2, sort_keys=True, ensure_ascii=False)

        self.assertEqual(first, second)

    def test_export_fails_loudly_when_the_family_disappears(self):
        schema = {"openapi": "3.1.0", "info": {"title": "Lynk", "version": "0.1.0"}, "paths": {"/api/v1/other": {}}}

        with self.assertRaises(RuntimeError) as caught:
            build_contract(schema)

        self.assertIn(PATH_PREFIX, str(caught.exception))

    def test_export_fails_loudly_on_a_dangling_reference(self):
        schema = {
            "openapi": "3.1.0",
            "info": {"title": "Lynk", "version": "0.1.0"},
            "paths": {f"{PATH_PREFIX}/thing": {"get": {"$ref": "#/components/schemas/Missing"}}},
            "components": {"schemas": {}},
        }

        with self.assertRaises(RuntimeError) as caught:
            build_contract(schema)

        self.assertIn("Missing", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
