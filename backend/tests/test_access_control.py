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


if __name__ == "__main__":
    unittest.main()
