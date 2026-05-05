import unittest
from types import SimpleNamespace

from app.core import access_control


class FakeQuery:
    def __init__(self, scalar_value):
        self.scalar_value = scalar_value

    def filter(self, *args, **kwargs):
        return self

    def scalar(self):
        return self.scalar_value


class FakeDB:
    def __init__(self, scalar_value):
        self.scalar_value = scalar_value

    def query(self, *_args, **_kwargs):
        return FakeQuery(self.scalar_value)


class FailingQueryDB:
    def query(self, *_args, **_kwargs):
        raise AssertionError("unexpected database query")


class FinanceScopeTests(unittest.TestCase):
    def test_finance_scope_full_access_for_finance_department(self):
        user = SimpleNamespace(id=7, team_id=10)
        db = FakeDB(access_control.FINANCE_FULL_ACCESS_DEPARTMENT_ID)

        scope = access_control.get_finance_user_scope(db, user)

        self.assertEqual(scope.department_id, access_control.FINANCE_FULL_ACCESS_DEPARTMENT_ID)
        self.assertIsNone(scope.user_id_filter)

    def test_finance_scope_limits_non_finance_user_to_own_records(self):
        user = SimpleNamespace(id=7, team_id=10)
        db = FakeDB(3)

        scope = access_control.get_finance_user_scope(db, user)

        self.assertEqual(scope.department_id, 3)
        self.assertEqual(scope.user_id_filter, 7)


class RoleLevelTests(unittest.TestCase):
    def test_get_user_role_level_prefers_access_token_claim(self):
        user = SimpleNamespace(id=7, tenant_id=1, role_id=5, _token_role_level=100)

        role_level = access_control.get_user_role_level(FailingQueryDB(), user)

        self.assertEqual(role_level, 100)

    def test_get_user_role_level_logs_legacy_token_fallback(self):
        user = SimpleNamespace(id=7, tenant_id=1, role_id=5)

        with self.assertLogs("app.core.access_control", level="WARNING") as logs:
            role_level = access_control.get_user_role_level(FakeDB(100), user)

        self.assertEqual(role_level, 100)
        self.assertTrue(any("missing role_level" in message for message in logs.output))


if __name__ == "__main__":
    unittest.main()
