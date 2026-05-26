import ast
import unittest
from pathlib import Path


def _load_default_modules() -> list[dict]:
    seed_path = Path(__file__).resolve().parents[1] / "app" / "bootstrap" / "seed.py"
    tree = ast.parse(seed_path.read_text())
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "DEFAULT_MODULES":
                    return ast.literal_eval(node.value)
    raise AssertionError("DEFAULT_MODULES not found")


class CatalogModuleFoundationTests(unittest.TestCase):
    def test_catalog_products_and_services_are_seeded_as_distinct_modules(self):
        default_modules = _load_default_modules()
        modules_by_name = {module["name"]: module for module in default_modules}

        self.assertEqual(
            modules_by_name["catalog_products"]["base_route"],
            "/dashboard/catalog/products",
        )
        self.assertEqual(
            modules_by_name["catalog_services"]["base_route"],
            "/dashboard/catalog/services",
        )
        self.assertIn("product", modules_by_name["catalog_products"]["description"].lower())
        self.assertIn("service", modules_by_name["catalog_services"]["description"].lower())

    def test_finance_pos_module_is_seeded_for_pos_mode(self):
        default_modules = _load_default_modules()
        modules_by_name = {module["name"]: module for module in default_modules}

        self.assertEqual(modules_by_name["finance_pos"]["base_route"], "/dashboard/finance/pos")
        self.assertIn("pos", modules_by_name["finance_pos"]["description"].lower())

    def test_no_default_module_uses_stale_finance_invoice_route(self):
        default_modules = _load_default_modules()

        stale_modules = [
            module["name"]
            for module in default_modules
            if module.get("base_route") == "/dashboard/finance/invoices"
        ]

        self.assertEqual(stale_modules, [])

    def test_crm_administration_modules_are_seeded(self):
        default_modules = _load_default_modules()
        modules_by_name = {module["name"]: module for module in default_modules}

        self.assertEqual(modules_by_name["reports"]["base_route"], "/dashboard/reports")
        self.assertEqual(modules_by_name["message_templates"]["base_route"], "/dashboard/settings/message-templates")
        self.assertIn("crm", modules_by_name["reports"]["description"].lower())
        self.assertIn("templates", modules_by_name["message_templates"]["description"].lower())


if __name__ == "__main__":
    unittest.main()
