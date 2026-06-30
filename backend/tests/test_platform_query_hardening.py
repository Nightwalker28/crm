import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.modules.platform.services import global_search, recycle_purge


class FakePostgresDB:
    def __init__(self):
        self.bind = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))
        self.statements = []

    def execute(self, statement, *_args, **_kwargs):
        self.statements.append(str(statement))


class PlatformQueryHardeningTests(unittest.TestCase):
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
        self.assertEqual(db.statements[-1], "RESET LOCAL statement_timeout")

    def test_recycle_purge_rejects_unsafe_identifiers(self):
        for identifier in ["sales_leads; drop table users", "sales-leads", "1sales"]:
            with self.subTest(identifier=identifier):
                with self.assertRaisesRegex(ValueError, "Unsafe recycle purge identifier"):
                    recycle_purge._quote_purge_identifier(identifier)

    def test_recycle_purge_quotes_allowlisted_identifiers(self):
        statement = str(recycle_purge._build_purge_statement("sales_leads", "lead_id"))

        self.assertIn('FROM "sales_leads"', statement)
        self.assertIn('SELECT "lead_id"', statement)
        self.assertIn('"sales_leads"."lead_id" = rows_to_delete."lead_id"', statement)


if __name__ == "__main__":
    unittest.main()
