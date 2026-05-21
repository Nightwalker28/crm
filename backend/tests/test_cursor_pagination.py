import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.core.cursor_pagination import build_cursor_response
from app.modules.calendar.repositories import calendar_repository
from app.modules.catalog.repositories import product_repository, service_repository
from app.modules.client_portal.repositories import client_portal_repository
from app.modules.documents.repositories import documents_repository
from app.modules.finance.repositories import io_repository, pos_invoice_repository
from app.modules.mail.repositories import mail_repository
from app.modules.platform.repositories import custom_modules_repository
from app.modules.platform.services import activity_logs, crm_events, data_transfer_jobs, notifications, record_comments
from app.modules.sales.repositories import contacts_repository, opportunities_repository, organizations_repository
from app.modules.tasks.repositories import tasks_repository
from app.modules.user_management.repositories import admin_users_repository
from app.modules.website_integrations.repositories import website_integration_repository
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

    def count(self):
        return 0

    def distinct(self):
        return self

    def all(self):
        return [SimpleNamespace(id=9, event_id=9)]


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
        self.assertTrue(any(len(call) == 1 and call[0] is None for call in query.order_by_calls))
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
            (client_portal_repository.list_client_accounts_cursor, {"tenant_id": 10}),
            (client_portal_repository.list_client_pages_cursor, {"tenant_id": 10}),
            (website_integration_repository.list_orders_cursor, {"tenant_id": 10}),
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

    def test_custom_module_record_cursor_repository_uses_strict_id_order(self):
        query = CursorQuery()
        definition = SimpleNamespace(id=1, tenant_id=10)

        custom_modules_repository.list_records_cursor(CursorDB(query), definition=definition, limit=2, cursor=9)

        self._assert_strict_id_cursor_order(query)

    def test_admin_user_cursor_repositories_clear_existing_ordering(self):
        for function in [admin_users_repository.list_users_cursor, admin_users_repository.search_users_cursor]:
            with self.subTest(function=function.__name__):
                query = CursorQuery()
                with patch.object(admin_users_repository, "build_user_query", return_value=query):
                    kwargs = {"tenant_id": 10, "limit": 2, "cursor": 9}
                    if function is admin_users_repository.search_users_cursor:
                        kwargs.update(
                            {
                                "q": None,
                                "teams": None,
                                "roles": None,
                                "status_filter": None,
                                "sort_by": "name",
                                "sort_order": "asc",
                            }
                        )
                    function(CursorDB(query), **kwargs)
                self._assert_strict_id_cursor_order(query)

    def test_platform_cursor_services_use_strict_id_order(self):
        cases = [
            (activity_logs.list_activity_logs_cursor, {"tenant_id": 10}),
            (notifications.list_notifications_cursor, {"tenant_id": 10, "user_id": 1}),
            (data_transfer_jobs.list_data_transfer_jobs_cursor, {"tenant_id": 10, "actor_user_id": 1}),
            (crm_events.list_crm_events_cursor, {"tenant_id": 10}),
        ]
        for function, kwargs in cases:
            with self.subTest(function=function.__name__):
                query = CursorQuery()
                function(CursorDB(query), limit=2, cursor=9, **kwargs)
                self._assert_strict_id_cursor_order(query)

    def test_record_comments_cursor_service_uses_strict_id_order(self):
        query = CursorQuery()
        with patch.object(record_comments, "get_record_reference", return_value=SimpleNamespace(id=1)):
            record_comments.list_record_comments_cursor(
                CursorDB(query),
                tenant_id=10,
                module_key="sales_contacts",
                entity_id="1",
                limit=2,
                cursor=9,
            )
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
