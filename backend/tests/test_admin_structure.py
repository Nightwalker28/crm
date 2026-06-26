import unittest
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.user_management.models import Department, Team, Tenant, User
from app.modules.user_management.schema import TeamUpdateRequest
from app.modules.user_management.services import admin_structure


class AdminStructureTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(
            bind=engine,
            tables=[
                Tenant.__table__,
                Department.__table__,
                Team.__table__,
                User.__table__,
            ],
        )
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.db.add_all(
            [
                Tenant(id=1, slug="default", name="Default"),
                Department(id=1, tenant_id=1, name="Ops"),
                Department(id=2, tenant_id=1, name="Sales"),
                Team(id=1, tenant_id=1, department_id=1, name="Revenue"),
                User(id=1, tenant_id=1, team_id=1, department_id=1, email="user@example.com"),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_update_team_rolls_back_department_and_user_changes_on_sync_failure(self):
        rollback_calls = 0
        original_rollback = self.db.rollback

        def rollback_spy():
            nonlocal rollback_calls
            rollback_calls += 1
            original_rollback()

        self.db.rollback = rollback_spy

        with patch(
            "app.modules.user_management.services.admin_structure._sync_team_module_permissions_from_department",
            side_effect=RuntimeError("sync failed"),
        ):
            with self.assertRaises(RuntimeError):
                admin_structure.update_team(
                    self.db,
                    team_id=1,
                    payload=TeamUpdateRequest(department_id=2),
                    tenant_id=1,
                )

        team = self.db.query(Team).filter(Team.id == 1).one()
        user = self.db.query(User).filter(User.id == 1).one()
        self.assertEqual(rollback_calls, 1)
        self.assertEqual(team.department_id, 1)
        self.assertEqual(user.department_id, 1)

    def test_sync_team_module_permissions_raises_on_duplicate_rows(self):
        class FakeDepartmentPermissionQuery:
            def filter(self, *_args):
                return self

            def all(self):
                return [(7,)]

        class FakeTeamPermissionQuery:
            def filter(self, *_args):
                return self

            def all(self):
                return [
                    SimpleNamespace(id=1, team_id=1, module_id=7),
                    SimpleNamespace(id=2, team_id=1, module_id=7),
                ]

        class FakeDB:
            def query(self, target):
                if target is admin_structure.DepartmentModulePermission.module_id:
                    return FakeDepartmentPermissionQuery()
                if target is admin_structure.TeamModulePermission:
                    return FakeTeamPermissionQuery()
                self.fail(f"Unexpected query target: {target}")

            def add(self, _value):
                self.fail("Duplicate sync should not create replacement rows")

        with self.assertRaisesRegex(RuntimeError, "Duplicate team module permission rows"):
            admin_structure._sync_team_module_permissions_from_department(
                FakeDB(),
                Team(id=1, tenant_id=1, department_id=1, name="Revenue"),
            )


if __name__ == "__main__":
    unittest.main()
