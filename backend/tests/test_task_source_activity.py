import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.pagination import create_pagination
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.sales.models import SalesContact
from app.modules.tasks.models import Task, TaskAssignee
from app.modules.tasks.repositories import tasks_repository
from app.modules.tasks.routes import tasks_routes
from app.modules.tasks.services import tasks_services
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Module, Role, Team, User, UserStatus


class FakeTaskQuery:
    def __init__(self):
        self.operations = []

    def count(self):
        self.operations.append("count")
        return 0

    def order_by(self, *args):
        self.operations.append("order_by_reset" if len(args) == 1 and args[0] is None else "order_by")
        return self

    def offset(self, value):
        self.operations.append(("offset", value))
        return self

    def limit(self, value):
        self.operations.append(("limit", value))
        return self

    def all(self):
        self.operations.append("all")
        return []


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
                Role(id=2, tenant_id=10, name="Member", level=10),
                self.current_user,
                User(
                    id=2,
                    tenant_id=10,
                    email="member@example.com",
                    first_name="Mia",
                    last_name="Member",
                    role_id=2,
                    team_id=3,
                    is_active=UserStatus.active,
                ),
                User(
                    id=3,
                    tenant_id=10,
                    email="other@example.com",
                    first_name="Other",
                    last_name="Member",
                    role_id=2,
                    is_active=UserStatus.active,
                ),
                Team(id=3, tenant_id=10, name="Success"),
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

    def test_list_tasks_applies_explicit_sort_before_pagination(self):
        query = FakeTaskQuery()
        pagination = SimpleNamespace(offset=20, limit=10)

        with patch.object(tasks_repository, "build_task_query", return_value=query):
            tasks, total_count = tasks_repository.list_tasks(
                self.db,
                tenant_id=10,
                current_user=self.current_user,
                pagination=pagination,
                sort_by="title",
                sort_direction="asc",
            )

        self.assertEqual(tasks, [])
        self.assertEqual(total_count, 0)
        self.assertEqual(query.operations, ["count", "order_by_reset", "order_by", ("offset", 20), ("limit", 10), "all"])

    def test_task_model_declares_tenant_status_and_due_indexes(self):
        index_names = {index.name for index in Task.__table__.indexes}

        self.assertTrue({"ix_tasks_tenant_status", "ix_tasks_tenant_due_at"}.issubset(index_names))

    def test_get_task_include_deleted_returns_active_and_deleted_rows(self):
        active = Task(id=101, tenant_id=10, title="Active task", status="todo", priority="medium", created_by_user_id=1)
        deleted = Task(
            id=102,
            tenant_id=10,
            title="Deleted task",
            status="todo",
            priority="medium",
            created_by_user_id=1,
            deleted_at=datetime.utcnow(),
        )
        self.db.add_all([active, deleted])
        self.db.commit()

        self.assertIs(
            tasks_repository.get_task(
                self.db,
                tenant_id=10,
                current_user=self.current_user,
                task_id=101,
                include_deleted=True,
            ),
            active,
        )
        self.assertIs(
            tasks_repository.get_task(
                self.db,
                tenant_id=10,
                current_user=self.current_user,
                task_id=102,
                include_deleted=True,
            ),
            deleted,
        )
        self.assertIsNone(
            tasks_repository.get_task(
                self.db,
                tenant_id=10,
                current_user=self.current_user,
                task_id=102,
            )
        )

    def test_deleted_task_lookup_and_list_apply_visibility(self):
        member = self.db.query(User).filter(User.id == 2).one()
        own_deleted = Task(
            id=111,
            tenant_id=10,
            title="Own deleted task",
            status="todo",
            priority="medium",
            created_by_user_id=2,
            deleted_at=datetime.utcnow(),
        )
        assigned_deleted = Task(
            id=112,
            tenant_id=10,
            title="Assigned deleted task",
            status="todo",
            priority="medium",
            created_by_user_id=3,
            deleted_at=datetime.utcnow(),
        )
        hidden_deleted = Task(
            id=113,
            tenant_id=10,
            title="Hidden deleted task",
            status="todo",
            priority="medium",
            created_by_user_id=3,
            deleted_at=datetime.utcnow(),
        )
        self.db.add_all([own_deleted, assigned_deleted, hidden_deleted])
        self.db.flush()
        self.db.add(
            TaskAssignee(
                tenant_id=10,
                task_id=112,
                assignee_type="team",
                assignee_key="team:3",
                team_id=3,
            )
        )
        self.db.commit()

        tasks, total_count = tasks_repository.list_deleted_tasks(
            self.db,
            tenant_id=10,
            current_user=member,
            pagination=create_pagination(1, 10),
        )

        self.assertEqual(total_count, 2)
        self.assertEqual({task.id for task in tasks}, {111, 112})
        self.assertIsNone(
            tasks_repository.get_deleted_task(
                self.db,
                tenant_id=10,
                current_user=member,
                task_id=113,
            )
        )

    def test_create_task_rejects_blank_title_before_commit(self):
        with self.assertRaises(HTTPException) as exc:
            tasks_services.create_task(
                self.db,
                payload={"title": "   ", "assignees": []},
                current_user=self.current_user,
            )

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Task title is required")
        self.assertEqual(self.db.query(Task).count(), 0)

    def test_create_task_rolls_back_when_assignee_sync_fails(self):
        with self.assertRaises(HTTPException) as exc:
            tasks_services.create_task(
                self.db,
                payload={
                    "title": "Call lead",
                    "assignees": [{"assignee_type": "user", "user_id": 999}],
                },
                current_user=self.current_user,
            )

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Assignee user not found")
        self.assertEqual(self.db.query(Task).count(), 0)
        self.assertEqual(self.db.query(TaskAssignee).count(), 0)

    def test_update_task_rolls_back_title_when_assignee_sync_fails(self):
        task = Task(
            id=120,
            tenant_id=10,
            title="Original title",
            status="todo",
            priority="medium",
            created_by_user_id=1,
            updated_by_user_id=1,
        )
        self.db.add(task)
        self.db.commit()

        with self.assertRaises(HTTPException):
            tasks_services.update_task(
                self.db,
                task=task,
                payload={
                    "title": "Changed title",
                    "assignees": [{"assignee_type": "user", "user_id": 999}],
                },
                current_user=self.current_user,
            )

        self.db.expire_all()
        persisted = self.db.query(Task).filter(Task.id == 120).one()
        self.assertEqual(persisted.title, "Original title")
        self.assertEqual(self.db.query(TaskAssignee).count(), 0)

    def test_assignee_validation_batches_user_and_team_lookup(self):
        payload = [
            {"assignee_type": "user", "user_id": 2},
            {"assignee_type": "user", "user_id": 3},
            {"assignee_type": "team", "team_id": 3},
            {"assignee_type": "team", "team_id": 3},
        ]

        with patch.object(self.db, "query", wraps=self.db.query) as query_mock:
            normalized = tasks_services._normalize_assignees(
                self.db,
                tenant_id=10,
                assignees_payload=payload,
                current_user=self.current_user,
            )

        self.assertEqual([item["assignee_key"] for item in normalized], ["user:2", "user:3", "team:3"])
        self.assertEqual(query_mock.call_count, 2)

    def test_notification_recipient_resolution_batches_team_members(self):
        self.db.add_all(
            [
                Team(id=4, tenant_id=10, name="Delivery"),
                User(id=4, tenant_id=10, email="delivery@example.com", first_name="Dee", last_name="Livery", role_id=2, team_id=4, is_active=UserStatus.active),
            ]
        )
        self.db.commit()

        with patch.object(self.db, "query", wraps=self.db.query) as query_mock:
            user_ids = tasks_services._resolve_notification_user_ids(
                self.db,
                tenant_id=10,
                assignee_keys=["user:3", "team:3", "team:4"],
            )

        self.assertEqual(user_ids, [2, 3, 4])
        query_mock.assert_called_once()

    def test_assignment_options_are_bounded_searchable_and_include_selected(self):
        self.db.add_all(
            [
                User(id=4, tenant_id=10, email="inactive@example.com", first_name="Inactive", last_name="User", role_id=2, is_active=UserStatus.inactive),
                User(id=5, tenant_id=10, email="zoe@example.com", first_name="Zoe", last_name="Active", role_id=2, is_active=UserStatus.active),
                Team(id=4, tenant_id=10, name="Delivery"),
            ]
        )
        self.db.commit()

        limited = tasks_services.list_task_assignment_options(self.db, tenant_id=10, limit=1)
        searched = tasks_services.list_task_assignment_options(self.db, tenant_id=10, query="mia", limit=100)
        selected = tasks_services.list_task_assignment_options(self.db, tenant_id=10, limit=1, selected_user_ids=[4], selected_team_ids=[4])

        self.assertEqual(len(limited["users"]), 1)
        self.assertEqual([user["email"] for user in searched["users"]], ["member@example.com"])
        self.assertNotIn("inactive@example.com", {user["email"] for user in limited["users"]})
        self.assertIn("inactive@example.com", {user["email"] for user in selected["users"]})
        self.assertIn("Delivery", {team["name"] for team in selected["teams"]})

    def test_task_list_and_serializer_query_count_is_bounded(self):
        self.db.add_all(
            [
                Task(id=130, tenant_id=10, title="First", status="todo", priority="medium", created_by_user_id=1),
                Task(id=131, tenant_id=10, title="Second", status="todo", priority="medium", created_by_user_id=1),
            ]
        )
        self.db.flush()
        self.db.add(
            TaskAssignee(
                tenant_id=10,
                task_id=130,
                assignee_type="user",
                assignee_key="user:2",
                user_id=2,
            )
        )
        self.db.commit()

        statements = []

        def before_cursor_execute(_conn, _cursor, statement, _parameters, _context, _executemany):
            statements.append(statement)

        event.listen(self.db.get_bind(), "before_cursor_execute", before_cursor_execute)
        try:
            tasks, _total = tasks_repository.list_tasks(
                self.db,
                tenant_id=10,
                current_user=self.current_user,
                pagination=create_pagination(1, 25),
            )
            [tasks_services.serialize_task(task) for task in tasks]
        finally:
            event.remove(self.db.get_bind(), "before_cursor_execute", before_cursor_execute)

        self.assertLessEqual(len(statements), 6)


if __name__ == "__main__":
    unittest.main()
