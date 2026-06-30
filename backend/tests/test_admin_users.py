import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError

from app.modules.user_management.models import Role, Team, User, UserAuthMode, UserStatus
from app.modules.user_management.repositories import admin_users_repository
from app.modules.user_management.schema import UpdateUserRequest
from app.modules.user_management.services import admin_users


class FakeQuery:
    def __init__(self, mapping):
        self.mapping = mapping
        self.model = None

    def __call__(self, *models):
        self.model = models[0] if len(models) == 1 else models
        return self

    def filter(self, *conditions):
        return self

    def first(self):
        if isinstance(self.model, tuple):
            values = tuple(self.mapping.get(model.__name__.lower()) for model in self.model)
            return values if all(values) else None
        model_name = self.model.__name__
        return self.mapping.get(model_name.lower())


class FakeDB:
    def __init__(self, *, user=None, role=None, team=None):
        self.mapping = {"user": user, "role": role, "team": team}
        self.query_builder = FakeQuery(self.mapping)
        self.committed = False

    def query(self, *models):
        return self.query_builder(*models)

    def add(self, _value):
        if isinstance(_value, User) and _value.id is None:
            _value.id = 99
        return None

    def commit(self):
        self.committed = True

    def flush(self):
        return None

    def refresh(self, _value):
        return None


class CountSourceQuery:
    def __init__(self):
        self.order_by_calls = []
        self.with_entities_args = None
        self.subquery_called = False

    def order_by(self, *args):
        self.order_by_calls.append(args)
        return self

    def with_entities(self, *args):
        self.with_entities_args = args
        return self

    def subquery(self):
        self.subquery_called = True
        return "count-source"


class CountResultQuery:
    def __init__(self):
        self.select_from_arg = None

    def select_from(self, value):
        self.select_from_arg = value
        return self

    def scalar(self):
        return 7


class CountDB:
    def __init__(self):
        self.count_query = CountResultQuery()

    def query(self, *_args):
        return self.count_query


class CreateUserTests(unittest.TestCase):
    def test_update_user_request_rejects_pending_status_before_service(self):
        with self.assertRaises(ValidationError) as exc:
            UpdateUserRequest(is_active=UserStatus.pending)

        self.assertIn("Pending status is no longer supported", str(exc.exception))

    def test_list_user_update_options_uses_cache(self):
        cached = {
            "roles": [{"id": 5, "name": "Admin"}],
            "teams": [{"id": 8, "name": "Revenue"}],
            "statuses": ["active", "inactive"],
        }
        db = SimpleNamespace(query=lambda *_args: self.fail("DB should not be queried on cache hit"))

        with patch.object(admin_users, "cache_get_json", return_value=cached):
            result = admin_users.list_user_update_options(db, tenant_id=1)

        self.assertEqual(result.roles[0].name, "Admin")
        self.assertEqual(result.teams[0].name, "Revenue")

    def test_user_update_options_cache_key_is_schema_versioned(self):
        self.assertEqual(admin_users._user_update_options_cache_key(42), "user-update-options-v2:42")

    def test_create_user_rejects_missing_role(self):
        db = FakeDB(user=None, role=None, team=SimpleNamespace(id=8))
        payload = SimpleNamespace(
            email="new.user@example.com",
            first_name="New",
            last_name="User",
            role_id=5,
            team_id=8,
            auth_mode=UserAuthMode.manual_only,
            is_active=UserStatus.active,
        )

        with self.assertRaises(HTTPException) as exc:
            admin_users.create_user(db, payload, tenant_id=1)

        self.assertEqual(exc.exception.status_code, 404)
        self.assertEqual(exc.exception.detail, "Role not found")
        self.assertFalse(db.committed)

    def test_create_user_rejects_missing_team(self):
        db = FakeDB(user=None, role=SimpleNamespace(id=5), team=None)
        payload = SimpleNamespace(
            email="new.user@example.com",
            first_name="New",
            last_name="User",
            role_id=5,
            team_id=8,
            auth_mode=UserAuthMode.manual_only,
            is_active=UserStatus.active,
        )

        with self.assertRaises(HTTPException) as exc:
            admin_users.create_user(db, payload, tenant_id=1)

        self.assertEqual(exc.exception.status_code, 404)
        self.assertEqual(exc.exception.detail, "Team not found")
        self.assertFalse(db.committed)

    def test_update_user_rejects_pending_status(self):
        user = SimpleNamespace(id=1, is_active=UserStatus.active)
        db = FakeDB(user=user, role=SimpleNamespace(id=5), team=SimpleNamespace(id=8))
        payload = SimpleNamespace(model_dump=lambda exclude_unset=True: {"is_active": UserStatus.pending})

        with self.assertRaises(HTTPException) as exc:
            admin_users.update_user(db, user_id=1, payload=payload, tenant_id=1)

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Pending status is no longer supported")

    def test_update_user_uses_loaded_role_and_team_refs(self):
        user = SimpleNamespace(
            id=1,
            role_id=4,
            team_id=7,
            department_id=2,
            is_active=UserStatus.active,
            auth_mode=UserAuthMode.manual_only,
        )
        role = SimpleNamespace(id=5, name="Manager", level=50)
        team = SimpleNamespace(id=8, name="Revenue", department_id=3)
        db = FakeDB(user=user, role=role, team=team)
        payload = SimpleNamespace(model_dump=lambda exclude_unset=True: {"role_id": 5, "team_id": 8})

        updated = admin_users.update_user(db, user_id=1, payload=payload, tenant_id=1)

        self.assertTrue(db.committed)
        self.assertEqual(updated.role_id, 5)
        self.assertEqual(updated.team_id, 8)
        self.assertEqual(updated.department_id, 3)
        self.assertEqual(updated._serialized_role_name, "Manager")
        self.assertEqual(updated._serialized_role_level, 50)
        self.assertEqual(updated._serialized_team_name, "Revenue")

    def test_create_user_returns_setup_link_for_manual_users(self):
        db = FakeDB(user=None, role=SimpleNamespace(id=5), team=SimpleNamespace(id=8))
        payload = SimpleNamespace(
            email="new.user@example.com",
            first_name="New",
            last_name="User",
            role_id=5,
            team_id=8,
            auth_mode=UserAuthMode.manual_only,
            is_active=UserStatus.active,
        )

        with patch(
            "app.modules.user_management.services.admin_users.create_user_setup_link",
            return_value="http://localhost:3000/auth/setup-password?token=abc",
        ):
            response = admin_users.create_user(db, payload, tenant_id=1)

        self.assertTrue(db.committed)
        self.assertEqual(response.setup_link, "http://localhost:3000/auth/setup-password?token=abc")


class AdminUserRepositoryTests(unittest.TestCase):
    def test_count_user_query_strips_ordering_before_counting_ids(self):
        db = CountDB()
        query = CountSourceQuery()

        total = admin_users_repository.count_user_query(db, query)

        self.assertEqual(total, 7)
        self.assertIn((None,), query.order_by_calls)
        self.assertEqual(query.with_entities_args, (User.id,))
        self.assertTrue(query.subquery_called)
        self.assertEqual(db.count_query.select_from_arg, "count-source")


class UserSerializationTests(unittest.TestCase):
    def test_serialize_user_profiles_uses_model_relationship_properties_once(self):
        user = User(
            id=1,
            tenant_id=1,
            email="ops@example.com",
            team_id=2,
            role_id=3,
            photo_url=None,
            auth_mode=UserAuthMode.manual_only,
            is_active=UserStatus.active,
        )
        user.team = Team(id=2, tenant_id=1, name="Operations")
        user.role = Role(id=3, tenant_id=1, name="Superuser", level=90)

        [profile] = admin_users._serialize_user_profiles([user])

        self.assertEqual(profile.team_name, "Operations")
        self.assertEqual(profile.role_name, "Superuser")

    def test_serialize_user_profiles_uses_unassigned_fallback_properties(self):
        user = User(
            id=1,
            tenant_id=1,
            email="unassigned@example.com",
            team_id=None,
            role_id=None,
            photo_url=None,
            auth_mode=UserAuthMode.manual_only,
            is_active=UserStatus.active,
        )

        [profile] = admin_users._serialize_user_profiles([user])

        self.assertEqual(profile.team_name, "Unassigned")
        self.assertEqual(profile.role_name, "Unassigned")


if __name__ == "__main__":
    unittest.main()
