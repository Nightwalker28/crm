import unittest
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core import access_control
from app.core.database import Base
from app.modules.user_management.models import (
    Department,
    DepartmentModulePermission,
    Module,
    Role,
    RoleModulePermission,
    Team,
    TeamModulePermission,
    Tenant,
)


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
        user = SimpleNamespace(id=7, tenant_id=11, department_id=27, team_id=10)
        db = FakeDB(" Finance ")

        scope = access_control.get_finance_user_scope(db, user)

        self.assertEqual(scope.department_id, 27)
        self.assertIsNone(scope.user_id_filter)

    def test_finance_scope_limits_non_finance_user_to_own_records(self):
        user = SimpleNamespace(id=7, tenant_id=11, department_id=27, team_id=10)
        db = FakeDB("Sales")

        scope = access_control.get_finance_user_scope(db, user)

        self.assertEqual(scope.department_id, 27)
        self.assertEqual(scope.user_id_filter, 7)

    def test_finance_scope_fails_closed_without_tenant_context(self):
        user = SimpleNamespace(id=7, department_id=27, team_id=10)

        scope = access_control.get_finance_user_scope(FailingQueryDB(), user)

        self.assertEqual(scope.department_id, 27)
        self.assertEqual(scope.user_id_filter, 7)


class RoleLevelTests(unittest.TestCase):
    def test_get_user_role_level_prefers_access_token_claim(self):
        user = SimpleNamespace(id=7, tenant_id=1, role_id=5, _token_role_level=100)

        role_level = access_control.get_user_role_level(FailingQueryDB(), user)

        self.assertEqual(role_level, 100)

    def test_get_user_role_level_debug_logs_legacy_token_fallback(self):
        user = SimpleNamespace(id=7, tenant_id=1, role_id=5)

        with self.assertLogs("app.core.access_control", level="DEBUG") as logs:
            role_level = access_control.get_user_role_level(FakeDB(100), user)

        self.assertEqual(role_level, 100)
        self.assertTrue(any("missing role_level" in message for message in logs.output))


class HierarchicalModuleAssignmentTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(
            bind=engine,
            tables=[
                Tenant.__table__,
                Role.__table__,
                Department.__table__,
                Team.__table__,
                Module.__table__,
                RoleModulePermission.__table__,
                DepartmentModulePermission.__table__,
                TeamModulePermission.__table__,
            ],
        )
        self.db = sessionmaker(bind=engine)()
        self.db.add_all([
            Tenant(id=1, slug="tenant-one", name="Tenant One"),
            Tenant(id=2, slug="tenant-two", name="Tenant Two"),
            Role(id=1, tenant_id=1, name="User", level=10),
            Role(id=2, tenant_id=2, name="Other", level=10),
            Department(id=10, tenant_id=1, name="Sales"),
            Department(id=20, tenant_id=2, name="Other"),
            Team(id=11, tenant_id=1, department_id=10, name="Assigned"),
            Team(id=12, tenant_id=1, department_id=None, name="Unassigned"),
            Team(id=21, tenant_id=2, department_id=20, name="Cross tenant"),
            Module(id=100, name="sales_leads", base_route="/dashboard/sales/leads", is_enabled=1),
            RoleModulePermission(id=1000, role_id=1, module_id=100, can_view=1),
        ])
        self.db.commit()
        self.module = self.db.get(Module, 100)

    def tearDown(self):
        self.db.close()

    def user(self, *, team_id=11, role_id=1, role_level=10):
        return SimpleNamespace(
            id=7,
            tenant_id=1,
            department_id=10,
            team_id=team_id,
            role_id=role_id,
            _token_role_level=role_level,
        )

    def has_access(self, user=None, *, enabled=True):
        with patch.object(access_control, "is_module_enabled_for_tenant", return_value=enabled):
            return access_control.user_has_module_assignment(
                self.db,
                user=user or self.user(),
                module=self.module,
            )

    def test_role_denied(self):
        permission = self.db.query(RoleModulePermission).filter_by(role_id=1, module_id=100).one()
        permission.can_view = 0
        self.db.commit()
        self.db.add(DepartmentModulePermission(id=1001, department_id=10, module_id=100))
        self.db.commit()

        self.assertFalse(self.has_access())

    def test_disabled_module_denies_admin_and_regular_user(self):
        self.assertFalse(self.has_access(enabled=False))
        self.assertFalse(self.has_access(self.user(role_level=100), enabled=False))

    def test_direct_team_grant_cannot_bypass_blocked_department(self):
        self.db.add(TeamModulePermission(id=1002, team_id=11, module_id=100))
        self.db.commit()

        self.assertFalse(self.has_access())

    def test_department_grant_allows_assigned_team(self):
        self.db.add(DepartmentModulePermission(id=1003, department_id=10, module_id=100))
        self.db.commit()

        self.assertTrue(self.has_access())

    def test_unassigned_team_requires_direct_grant(self):
        user = self.user(team_id=12)
        user.department_id = None
        self.assertFalse(self.has_access(user))

        self.db.add(TeamModulePermission(id=1004, team_id=12, module_id=100))
        self.db.commit()
        self.assertTrue(self.has_access(user))

    def test_admin_bypasses_assignments_when_module_is_enabled(self):
        self.assertTrue(self.has_access(self.user(team_id=None, role_level=100)))

    def test_cross_tenant_team_and_role_ids_are_denied(self):
        self.assertFalse(self.has_access(self.user(team_id=21)))
        self.assertFalse(self.has_access(self.user(role_id=2)))


if __name__ == "__main__":
    unittest.main()
