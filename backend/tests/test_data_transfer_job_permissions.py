import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.platform.models import DataTransferJob
from app.modules.platform.services.data_transfer_jobs import (
    data_transfer_download_action,
    require_data_transfer_job_access,
    require_data_transfer_module_access,
)
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import (
    Module,
    Role,
    RoleModulePermission,
    Team,
    TeamModulePermission,
    Tenant,
    TenantModuleConfig,
    User,
    UserStatus,
)


class DataTransferJobPermissionTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.user = User(
            id=1,
            tenant_id=10,
            team_id=1,
            role_id=1,
            email="user@example.com",
            is_active=UserStatus.active,
        )
        self.permission = RoleModulePermission(
            id=1,
            role_id=1,
            module_id=1,
            can_view=1,
            can_create=1,
            can_edit=0,
            can_delete=0,
            can_restore=0,
            can_export=0,
            can_configure=0,
        )
        self.job = DataTransferJob(
            id=11,
            tenant_id=10,
            actor_user_id=1,
            module_key="sales_contacts",
            operation_type="export",
            status="completed",
            mode="background",
        )
        self.db.add_all(
            [
                Tenant(id=10, slug="tenant", name="Tenant"),
                Module(id=1, name="sales_contacts", base_route="/dashboard/sales/contacts", is_enabled=1),
                TenantModuleConfig(id=1, tenant_id=10, module_id=1, is_enabled=1),
                Role(id=1, tenant_id=10, name="User", level=10),
                Team(id=1, tenant_id=10, name="Sales"),
                TeamModulePermission(id=1, team_id=1, module_id=1),
                self.permission,
                self.user,
                self.job,
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_job_metadata_requires_current_module_view_access(self):
        require_data_transfer_job_access(self.db, current_user=self.user, job=self.job, action="view")

        self.permission.can_view = 0
        self.db.add(self.permission)
        self.db.commit()

        with self.assertRaises(HTTPException) as exc:
            require_data_transfer_job_access(self.db, current_user=self.user, job=self.job, action="view")

        self.assertEqual(exc.exception.status_code, 403)

    def test_export_download_requires_export_permission(self):
        self.assertEqual(data_transfer_download_action(self.job), "export")

        with self.assertRaises(HTTPException) as exc:
            require_data_transfer_job_access(
                self.db,
                current_user=self.user,
                job=self.job,
                action=data_transfer_download_action(self.job),
            )

        self.assertEqual(exc.exception.status_code, 403)

        self.permission.can_export = 1
        self.db.add(self.permission)
        self.db.commit()

        require_data_transfer_job_access(
            self.db,
            current_user=self.user,
            job=self.job,
            action=data_transfer_download_action(self.job),
        )

    def test_module_filtered_job_listing_requires_module_view_access(self):
        self.permission.can_view = 0
        self.db.add(self.permission)
        self.db.commit()

        with self.assertRaises(HTTPException) as exc:
            require_data_transfer_module_access(
                self.db,
                current_user=self.user,
                module_key="sales_contacts",
                action="view",
            )

        self.assertEqual(exc.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
