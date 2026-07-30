import unittest
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy.exc import IntegrityError

from app.modules.user_management.models import UserSavedView
from app.modules.user_management.services import profile


class FakeQuery:
    def __init__(self, db):
        self.db = db

    def filter(self, *conditions):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def all(self):
        return self.db.saved_views

    def first(self):
        return getattr(self.db, "table_preference", None)


class RaceDB:
    def __init__(self, existing_view):
        self.saved_views = []
        self.existing_view = existing_view
        self.added = []
        self.rolled_back = False

    def query(self, _model):
        return FakeQuery(self)

    def add(self, value):
        self.added.append(value)

    def commit(self):
        raise IntegrityError("insert user_saved_views", {}, Exception("duplicate system view"))

    def rollback(self):
        self.rolled_back = True
        self.saved_views = [self.existing_view]

    def refresh(self, _value):
        raise AssertionError("new duplicate view should not be refreshed")


class SavedViewListDB:
    def __init__(self, saved_views):
        self.saved_views = saved_views
        self.table_preference = None
        self.all_calls = 0
        self.added = []
        self.commits = 0

    def query(self, _model):
        return SavedViewListQuery(self)

    def add(self, value):
        self.added.append(value)

    def commit(self):
        self.commits += 1


class SavedViewListQuery(FakeQuery):
    def all(self):
        self.db.all_calls += 1
        return list(self.db.saved_views)


class SavedViewRaceTests(unittest.TestCase):
    def test_get_or_create_system_saved_view_recovers_from_duplicate_race(self):
        existing = UserSavedView(
            id=9,
            user_id=7,
            module_key="tasks",
            name=profile.SYSTEM_DEFAULT_VIEW_NAME,
            config={"_meta": {"system_default": True}},
            is_default=0,
        )
        db = RaceDB(existing)
        user = SimpleNamespace(id=7)

        view = profile._get_or_create_system_saved_view(
            db,
            user,
            "tasks",
            visible_columns=["title", "status"],
        )

        self.assertIs(view, existing)
        self.assertTrue(db.rolled_back)
        self.assertEqual(len(db.added), 1)


class SavedViewConfigTests(unittest.TestCase):
    def test_saved_view_modules_do_not_alias_table_preference_modules(self):
        self.assertIsNot(profile.SAVED_VIEW_MODULES, profile.TABLE_PREFERENCE_MODULES)

    def test_saved_view_modules_cover_every_configurable_builtin_list(self):
        self.assertTrue(
            {
                "tasks",
                "sales_leads",
                "sales_contacts",
                "sales_organizations",
                "sales_opportunities",
                "sales_quotes",
                "sales_orders",
                "contracts",
                "support_cases",
                "finance_io",
                "finance_pos",
                "finance_payments",
                "catalog_products",
                "catalog_services",
                "admin_users",
            }.issubset(profile.SAVED_VIEW_MODULES)
        )

    def test_list_saved_views_does_not_require_legacy_table_preferences_for_view_only_modules(self):
        view_only_modules = {
            "sales_orders",
            "contracts",
            "support_cases",
            "finance_pos",
            "finance_payments",
            "catalog_products",
            "catalog_services",
        }
        user = SimpleNamespace(id=7, tenant_id=1)

        for module_key in view_only_modules:
            with self.subTest(module_key=module_key):
                system_view = UserSavedView(
                    id=9,
                    user_id=7,
                    module_key=module_key,
                    name=profile.SYSTEM_DEFAULT_VIEW_NAME,
                    config={"_meta": {"system_default": True}},
                    is_default=1,
                )
                db = SavedViewListDB([system_view])

                with patch.object(
                    profile,
                    "get_user_table_preference",
                    side_effect=AssertionError("legacy table preferences must not be loaded"),
                ):
                    views = profile.list_saved_views(
                        db,
                        user,
                        module_key,
                        default_visible_columns=["name", "status"],
                    )

                self.assertEqual(views[0]["module_key"], module_key)
                self.assertEqual(views[0]["id"], 9)

    def test_normalize_saved_view_config_rejects_deep_nested_json(self):
        nested = current = {}
        for index in range(profile.SAVED_VIEW_MAX_DEPTH + 1):
            current["child"] = {}
            current = current["child"]

        with self.assertRaisesRegex(ValueError, "too deeply nested"):
            profile._normalize_saved_view_config(
                "tasks",
                {"filters": {"all_conditions": [{"field": "status", "operator": "is", "value": nested}]}},
            )

    def test_normalize_saved_view_config_rejects_oversized_serialized_json(self):
        oversized_columns = [
            f"column_{index:03d}_{'x' * 900}"
            for index in range(profile.SAVED_VIEW_MAX_COLUMNS)
        ]

        with self.assertRaisesRegex(ValueError, "config is too large"):
            profile._normalize_saved_view_config("tasks", {"visible_columns": oversized_columns})

    def test_normalize_saved_view_config_rejects_unbounded_conditions(self):
        conditions = [
            {"field": "status", "operator": "is", "value": f"open-{index}"}
            for index in range(profile.SAVED_VIEW_MAX_FILTER_CONDITIONS + 1)
        ]

        with self.assertRaisesRegex(ValueError, "too many filter conditions"):
            profile._normalize_saved_view_config("tasks", {"filters": {"all_conditions": conditions}})

    def test_list_saved_views_marks_system_default_without_second_full_query(self):
        system_view = UserSavedView(
            id=9,
            user_id=7,
            module_key="tasks",
            name=profile.SYSTEM_DEFAULT_VIEW_NAME,
            config={"_meta": {"system_default": True}},
            is_default=0,
        )
        custom_view = UserSavedView(
            id=10,
            user_id=7,
            module_key="tasks",
            name="Mine",
            config={},
            is_default=0,
        )
        db = SavedViewListDB([custom_view, system_view])
        user = SimpleNamespace(id=7, tenant_id=1)

        views = profile.list_saved_views(
            db,
            user,
            "tasks",
            default_visible_columns=["title", "status"],
        )

        self.assertEqual(db.all_calls, 1)
        self.assertEqual(db.commits, 1)
        self.assertEqual(views[0]["id"], 9)
        self.assertTrue(views[0]["is_default"])


if __name__ == "__main__":
    unittest.main()
