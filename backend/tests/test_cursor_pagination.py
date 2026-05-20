import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.core.cursor_pagination import build_cursor_response
from app.modules.calendar.repositories import calendar_repository
from app.modules.catalog.repositories import product_repository, service_repository
from app.modules.documents.repositories import documents_repository
from app.modules.finance.repositories import io_repository, pos_invoice_repository
from app.modules.mail.repositories import mail_repository
from app.modules.sales.repositories import contacts_repository, opportunities_repository, organizations_repository
from app.modules.tasks.repositories import tasks_repository
from scripts import seed_load_crm


class CursorQuery:
    def __init__(self):
        self.order_by_calls = []
        self.limit_value = None

    def options(self, *_args, **_kwargs):
        return self

    def join(self, *_args, **_kwargs):
        return self

    def filter(self, *_args, **_kwargs):
        return self

    def order_by(self, *args):
        self.order_by_calls.append(args)
        return self

    def limit(self, value):
        self.limit_value = value
        return self

    def all(self):
        return [SimpleNamespace(id=9)]


class CursorDB:
    def __init__(self, query):
        self.query_obj = query

    def query(self, *_args, **_kwargs):
        return self.query_obj


class CursorPaginationContractTests(unittest.TestCase):
    def test_build_cursor_response_supports_dict_items(self):
        response = build_cursor_response([{"id": 3}, {"id": 2}, {"id": 1}], limit=2, id_attr="id")

        self.assertEqual(response["results"], [{"id": 3}, {"id": 2}])
        self.assertEqual(response["next_cursor"], "2")
        self.assertTrue(response["has_more"])
        self.assertEqual(response["limit"], 2)

    def test_build_cursor_response_supports_object_items(self):
        response = build_cursor_response(
            [SimpleNamespace(record_id=3), SimpleNamespace(record_id=2), SimpleNamespace(record_id=1)],
            limit=2,
            id_attr="record_id",
        )

        self.assertEqual([item.record_id for item in response["results"]], [3, 2])
        self.assertEqual(response["next_cursor"], "2")


class CursorRepositoryOrderingTests(unittest.TestCase):
    def _assert_strict_id_cursor_order(self, query):
        self.assertIn((None,), query.order_by_calls)
        self.assertGreaterEqual(len(query.order_by_calls), 2)
        self.assertEqual(query.limit_value, 3)

    def test_sales_cursor_repositories_clear_ranked_ordering(self):
        cases = [
            (contacts_repository, "build_contacts_query", contacts_repository.list_contacts_cursor, {"tenant_id": 10}),
            (organizations_repository, "build_organization_query", organizations_repository.list_cursor, {"tenant_id": 10}),
            (opportunities_repository, "build_opportunity_query", opportunities_repository.list_cursor, {"tenant_id": 10}),
        ]
        for module, builder_name, function, kwargs in cases:
            with self.subTest(module=module.__name__):
                query = CursorQuery()
                with patch.object(module, builder_name, return_value=query):
                    function(CursorDB(query), limit=2, cursor=9, **kwargs)
                self._assert_strict_id_cursor_order(query)

    def test_operations_cursor_repositories_clear_existing_ordering(self):
        cases = [
            (
                tasks_repository,
                "build_task_query",
                tasks_repository.list_tasks_cursor,
                {"tenant_id": 10, "current_user": SimpleNamespace(id=1, tenant_id=10)},
            ),
            (
                pos_invoice_repository,
                "build_invoice_query",
                pos_invoice_repository.list_invoices_cursor,
                {"current_user": SimpleNamespace(id=1, tenant_id=10)},
            ),
            (
                mail_repository,
                "build_messages_query",
                mail_repository.list_messages_cursor,
                {"tenant_id": 10, "owner_user_id": 1},
            ),
        ]
        for module, builder_name, function, kwargs in cases:
            with self.subTest(module=module.__name__):
                query = CursorQuery()
                with patch.object(module, builder_name, return_value=query):
                    function(CursorDB(query), limit=2, cursor=9, **kwargs)
                self._assert_strict_id_cursor_order(query)

    def test_finance_io_cursor_repository_clears_existing_ordering_before_hydration(self):
        query = CursorQuery()
        with patch.object(io_repository, "build_insertion_orders_query", return_value=query), patch.object(
            io_repository,
            "hydrate_custom_field_records",
            side_effect=lambda _db, **kwargs: kwargs["records"],
        ):
            io_repository.list_insertion_orders_cursor(
                CursorDB(query),
                tenant_id=10,
                module_id=1,
                user_id=None,
                limit=2,
                cursor=9,
            )

        self._assert_strict_id_cursor_order(query)

    def test_simple_cursor_repositories_use_strict_id_order(self):
        cases = [
            (
                calendar_repository.list_calendar_events_cursor,
                {"tenant_id": 10, "current_user": SimpleNamespace(id=1, tenant_id=10, team_id=None)},
            ),
            (product_repository.list_products_cursor, {"tenant_id": 10}),
            (service_repository.list_services_cursor, {"tenant_id": 10}),
            (documents_repository.list_documents_cursor, {"tenant_id": 10}),
        ]
        for function, kwargs in cases:
            with self.subTest(function=function.__name__):
                query = CursorQuery()
                if function is calendar_repository.list_calendar_events_cursor:
                    with patch.object(calendar_repository, "build_visible_calendar_events_query", return_value=query):
                        function(CursorDB(query), limit=2, cursor=9, **kwargs)
                else:
                    function(CursorDB(query), limit=2, cursor=9, **kwargs)
                self._assert_strict_id_cursor_order(query)


class LoadSeedSafetyTests(unittest.TestCase):
    def test_seed_refuses_without_explicit_load_guard(self):
        args = SimpleNamespace(reset_load_tenants=False)
        with patch.dict(os.environ, {"LOAD_CRM_SEED_ALLOW": ""}, clear=False), self.assertRaises(SystemExit) as exc:
            seed_load_crm.seed(args)

        self.assertIn("LOAD_CRM_SEED_ALLOW=1", str(exc.exception))

    def test_reset_requires_exact_confirmation_prefix(self):
        with self.assertRaises(SystemExit) as exc:
            seed_load_crm._reset_load_tenants(SimpleNamespace(), confirm_prefix=None)

        self.assertIn("--confirm-reset-load-tenants load-crm", str(exc.exception))


if __name__ == "__main__":
    unittest.main()
