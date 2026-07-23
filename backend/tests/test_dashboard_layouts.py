import unittest

from app.modules.user_management.services import profile


class DashboardLayoutTests(unittest.TestCase):
    def test_normalize_dashboard_layout_keeps_supported_widget_shape(self):
        layout = profile._normalize_dashboard_layout(
            {
                "widgets": [
                    {"id": "crm", "type": "crm_snapshot", "size": "wide"},
                    {"id": "forecast", "type": "weighted_forecast", "size": "large"},
                    {"id": "leads", "type": "module_summary", "size": "small", "module_key": "sales_leads"},
                    {"id": "note", "type": "note", "config": {"body": "Call back top accounts"}},
                ]
            }
        )

        self.assertEqual(
            layout,
            {
                "widgets": [
                    {"id": "crm", "type": "crm_snapshot", "size": "wide"},
                    {"id": "forecast", "type": "weighted_forecast", "size": "large"},
                    {"id": "leads", "type": "module_summary", "size": "small", "module_key": "sales_leads"},
                    {"id": "note", "type": "note", "size": "medium", "config": {"body": "Call back top accounts"}},
                ]
            },
        )

    def test_normalize_dashboard_layout_rejects_duplicate_widget_ids(self):
        with self.assertRaisesRegex(ValueError, "ids must be unique"):
            profile._normalize_dashboard_layout(
                {
                    "widgets": [
                        {"id": "same", "type": "crm_snapshot"},
                        {"id": "same", "type": "recent_activity"},
                    ]
                }
            )

    def test_normalize_dashboard_layout_rejects_unsupported_widget_type(self):
        with self.assertRaisesRegex(ValueError, "Unsupported dashboard widget type"):
            profile._normalize_dashboard_layout({"widgets": [{"id": "bad", "type": "external_feed"}]})

    def test_normalize_dashboard_layout_rejects_oversized_widget_config(self):
        with self.assertRaisesRegex(ValueError, "config value is too large"):
            profile._normalize_dashboard_layout(
                {"widgets": [{"id": "note", "type": "note", "config": {"body": "x" * 2_001}}]}
            )

    def test_normalize_dashboard_layout_rejects_deep_widget_config(self):
        with self.assertRaisesRegex(ValueError, "too deeply nested"):
            profile._normalize_dashboard_layout(
                {
                    "widgets": [
                        {
                            "id": "note",
                            "type": "note",
                            "config": {"a": {"b": {"c": {"d": {"e": {"f": "too deep"}}}}}},
                        }
                    ]
                }
            )

    def test_saved_empty_layout_is_marked_as_existing_layout(self):
        class Query:
            def __init__(self, record):
                self.record = record

            def filter(self, *args):
                return self

            def first(self):
                return self.record

        class DB:
            def query(self, _model):
                return Query(type("Record", (), {"layout": {"widgets": []}})())

        user = type("User", (), {"tenant_id": 1, "id": 2})()

        self.assertEqual(profile.get_user_dashboard_layout(DB(), user), {"widgets": [], "has_layout": True})


if __name__ == "__main__":
    unittest.main()
