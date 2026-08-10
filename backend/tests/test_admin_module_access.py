import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.user_management.models import (
    Department,
    DepartmentModulePermission,
    Module,
    Team,
    TeamModulePermission,
    Tenant,
    TenantModuleConfig,
    TenantSidebarTab,
)
from app.modules.user_management.schema import ModuleAccessUpdateRequest
from app.modules.user_management.services import admin_modules


class AdminModuleAccessHierarchyTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(
            bind=engine,
            tables=[
                Tenant.__table__,
                Department.__table__,
                Team.__table__,
                Module.__table__,
                TenantModuleConfig.__table__,
                TenantSidebarTab.__table__,
                DepartmentModulePermission.__table__,
                TeamModulePermission.__table__,
            ],
        )
        self.db = sessionmaker(bind=engine)()
        self.db.add_all([
            Tenant(id=1, slug="tenant-one", name="Tenant One"),
            Tenant(id=2, slug="tenant-two", name="Tenant Two"),
            Department(id=10, tenant_id=1, name="Allowed"),
            Department(id=11, tenant_id=1, name="Blocked"),
            Department(id=20, tenant_id=2, name="Other tenant"),
            Team(id=21, tenant_id=1, department_id=10, name="Inherited"),
            Team(id=22, tenant_id=1, department_id=11, name="Blocked child"),
            Team(id=23, tenant_id=1, department_id=None, name="Unassigned"),
            Team(id=30, tenant_id=2, department_id=20, name="Cross tenant"),
            Module(id=100, name="sales_leads", base_route="/dashboard/sales/leads", is_enabled=1),
            DepartmentModulePermission(id=1000, department_id=10, module_id=100),
            TeamModulePermission(id=1001, team_id=22, module_id=100),
            TeamModulePermission(id=1002, team_id=23, module_id=100),
            TeamModulePermission(id=1003, team_id=21, module_id=100),
        ])
        self.db.commit()
        self.module_scope = patch.object(admin_modules, "_module_belongs_to_tenant_or_global", return_value=True)
        self.module_scope.start()

    def tearDown(self):
        self.module_scope.stop()
        self.db.close()

    def test_response_distinguishes_department_direct_and_blocked_states(self):
        response = admin_modules.get_module_access(self.db, 100, tenant_id=1)
        teams = {team.id: team for team in response.teams}

        self.assertTrue(teams[21].has_access)
        self.assertEqual(teams[21].access_state, "department_access")
        self.assertTrue(teams[21].has_direct_access)
        self.assertTrue(teams[21].direct_grant_allowed)
        self.assertFalse(teams[22].has_access)
        self.assertEqual(teams[22].access_state, "blocked_by_department")
        self.assertFalse(teams[22].has_direct_access)
        self.assertTrue(teams[23].has_access)
        self.assertTrue(teams[23].has_direct_access)
        self.assertTrue(teams[23].direct_grant_allowed)
        self.assertEqual(teams[23].access_state, "direct_team_access")

    def test_team_grant_under_blocked_department_is_rejected(self):
        with self.assertRaises(HTTPException) as exc:
            admin_modules.update_module_access(
                self.db,
                100,
                ModuleAccessUpdateRequest(department_ids=[10], team_ids=[22]),
                tenant_id=1,
                actor_user_id=7,
            )

        self.assertEqual(exc.exception.status_code, 409)
        self.assertEqual(exc.exception.detail["code"], "team_department_conflict")

    def test_cross_tenant_department_and_team_ids_are_rejected(self):
        for payload in (
            ModuleAccessUpdateRequest(department_ids=[20], team_ids=[]),
            ModuleAccessUpdateRequest(department_ids=[], team_ids=[30]),
        ):
            with self.assertRaises(HTTPException) as exc:
                admin_modules.update_module_access(
                    self.db,
                    100,
                    payload,
                    tenant_id=1,
                    actor_user_id=7,
                )
            self.assertEqual(exc.exception.status_code, 400)

    def test_update_keeps_selected_teams_under_allowed_departments_and_logs_change(self):
        with patch.object(admin_modules, "safe_log_activity") as log_mock:
            response = admin_modules.update_module_access(
                self.db,
                100,
                ModuleAccessUpdateRequest(department_ids=[10], team_ids=[21, 23]),
                tenant_id=1,
                actor_user_id=7,
            )

        stored_team_ids = {
            permission.team_id
            for permission in self.db.query(TeamModulePermission).filter_by(module_id=100).all()
        }
        self.assertEqual(stored_team_ids, {21, 23})
        self.assertEqual({team.id for team in response.teams if team.has_access}, {21, 23})
        log_mock.assert_called_once()
        self.assertEqual(log_mock.call_args.kwargs["action"], "module.access.updated")
        self.assertEqual(log_mock.call_args.kwargs["tenant_id"], 1)
        self.assertEqual(log_mock.call_args.kwargs["actor_user_id"], 7)
        self.assertEqual(
            log_mock.call_args.kwargs["after_state"]["team_access_rule"],
            "department_gate_plus_team_selection",
        )


if __name__ == "__main__":
    unittest.main()
