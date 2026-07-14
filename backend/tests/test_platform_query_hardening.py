import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from app.modules.platform.services import global_search, recycle_purge


class FakePostgresDB:
    def __init__(self):
        self.bind = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))
        self.statements = []

    def execute(self, statement, *_args, **_kwargs):
        self.statements.append(str(statement))


class PlatformQueryHardeningTests(unittest.TestCase):
    def test_global_search_registry_has_a_builder_for_every_static_module(self):
        module_keys = {module["module_key"] for module in global_search.GLOBAL_SEARCH_MODULES}

        self.assertEqual(module_keys, set(global_search.SEARCH_BUILDERS))
        self.assertTrue(
            {
                "sales_orders",
                "catalog_products",
                "catalog_services",
                "contracts",
                "documents",
                "support_cases",
                "finance_io",
                "finance_pos",
            }.issubset(module_keys)
        )

    def test_global_search_skips_records_without_module_view_access(self):
        db = SimpleNamespace(bind=None)
        current_user = SimpleNamespace(id=1, tenant_id=10)
        allowed_builder = Mock(return_value=[{"record_id": "1"}])
        denied_builder = Mock(return_value=[{"record_id": "2"}])

        with patch.object(
            global_search,
            "GLOBAL_SEARCH_MODULES",
            ({"module_key": "allowed"}, {"module_key": "denied"}),
        ), patch.dict(
            global_search.SEARCH_BUILDERS,
            {"allowed": allowed_builder, "denied": denied_builder},
            clear=True,
        ), patch.object(
            global_search,
            "require_department_module_access",
        ), patch.object(
            global_search,
            "require_role_module_action_access",
            side_effect=[None, PermissionError("forbidden")],
        ), patch.object(global_search, "_custom_module_results", return_value=[]):
            results = global_search.list_global_search_results(
                db,
                current_user=current_user,
                query=" alpha ",
                limit_per_module=3,
            )

        self.assertEqual(results, [{"record_id": "1"}])
        allowed_builder.assert_called_once_with(
            db,
            tenant_id=10,
            current_user=current_user,
            query="alpha",
            limit=3,
        )
        denied_builder.assert_not_called()

    def test_global_search_resets_statement_timeout_when_builder_fails(self):
        db = FakePostgresDB()
        current_user = SimpleNamespace(id=1, tenant_id=10)

        with patch.object(global_search, "GLOBAL_SEARCH_MODULES", ({"module_key": "tasks"},)), patch.dict(
            global_search.SEARCH_BUILDERS,
            {"tasks": lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("search failed"))},
        ), patch.object(global_search, "require_department_module_access"), patch.object(
            global_search,
            "require_role_module_action_access",
        ):
            with self.assertRaisesRegex(RuntimeError, "search failed"):
                global_search.list_global_search_results(db, current_user=current_user, query="alpha")

        self.assertEqual(db.statements[0], f"SET LOCAL statement_timeout = {global_search.GLOBAL_SEARCH_STATEMENT_TIMEOUT_MS}")
        self.assertEqual(db.statements[-1], "SET LOCAL statement_timeout = DEFAULT")

    def test_recycle_purge_rejects_unsafe_identifiers(self):
        for identifier in ["sales_leads; drop table users", "sales-leads", "1sales"]:
            with self.subTest(identifier=identifier):
                with self.assertRaisesRegex(ValueError, "Unsafe recycle purge identifier"):
                    recycle_purge._quote_purge_identifier(identifier)

    def test_recycle_purge_quotes_allowlisted_identifiers(self):
        statement = str(recycle_purge._build_purge_statement("sales_leads", "lead_id"))

        self.assertIn('FROM "sales_leads"', statement)
        self.assertIn('SELECT "lead_id"', statement)
        self.assertIn("DELETE FROM record_tag_links", statement)
        self.assertIn("module_key = 'sales_leads'", statement)
        self.assertIn('"sales_leads"."lead_id" = rows_to_delete."lead_id"', statement)


if __name__ == "__main__":
    unittest.main()
