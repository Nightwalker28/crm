import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.sales.models import SalesContact
from app.modules.tasks.models import Task
from app.modules.tasks.routes import tasks_routes
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Module, Role, User, UserStatus


class TaskSourceActivityTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.current_user = User(
            id=1,
            tenant_id=10,
            email="admin@example.com",
            first_name="Ada",
            last_name="Admin",
            role_id=1,
            is_active=UserStatus.active,
        )
        self.db.add_all(
            [
                Module(id=1, name="sales_contacts", base_route="sales_contacts", is_enabled=1),
                Module(id=2, name="tasks", base_route="tasks", is_enabled=1),
                Role(id=1, tenant_id=10, name="Admin", level=100),
                self.current_user,
                SalesContact(contact_id=7, tenant_id=10, primary_email="lead@example.com", assigned_to=1),
                SalesContact(contact_id=8, tenant_id=99, primary_email="other@example.com", assigned_to=1),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_source_payload_resolves_existing_tenant_record(self):
        context = tasks_routes._resolve_payload_source_context(
            self.db,
            current_user=self.current_user,
            payload={"source_module_key": "sales_contacts", "source_entity_id": "7"},
        )

        self.assertEqual(
            context,
            {"module_key": "sales_contacts", "entity_type": "sales_contact", "entity_id": "7"},
        )

    def test_source_payload_rejects_missing_entity_id(self):
        with self.assertRaises(HTTPException) as exc:
            tasks_routes._resolve_payload_source_context(
                self.db,
                current_user=self.current_user,
                payload={"source_module_key": "sales_contacts"},
            )

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Task source requires both module and record.")

    def test_source_payload_rejects_cross_tenant_record(self):
        with self.assertRaises(HTTPException) as exc:
            tasks_routes._resolve_payload_source_context(
                self.db,
                current_user=self.current_user,
                payload={"source_module_key": "sales_contacts", "source_entity_id": "8"},
            )

        self.assertEqual(exc.exception.status_code, 404)

    def test_mirror_task_activity_logs_to_source_record(self):
        task = Task(
            id=42,
            tenant_id=10,
            title="Call lead",
            status="todo",
            priority="medium",
            source_module_key="sales_contacts",
            source_entity_id="7",
            source_label="lead@example.com",
            created_by_user_id=1,
            updated_by_user_id=1,
        )

        with patch.object(tasks_routes, "log_activity") as log_mock:
            tasks_routes._mirror_task_source_activity(
                self.db,
                current_user=self.current_user,
                task=task,
                action="task.update",
                description="Updated task Call lead",
                before_state={"title": "Call lead"},
                after_state={"title": "Call lead", "status": "todo"},
            )

        log_mock.assert_called_once()
        call_kwargs = log_mock.call_args.kwargs
        self.assertEqual(call_kwargs["tenant_id"], 10)
        self.assertEqual(call_kwargs["module_key"], "sales_contacts")
        self.assertEqual(call_kwargs["entity_type"], "sales_contact")
        self.assertEqual(call_kwargs["entity_id"], "7")
        self.assertEqual(call_kwargs["action"], "task.update")


if __name__ == "__main__":
    unittest.main()
