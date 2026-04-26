import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.modules.user_management.models import Role, Team, User, UserAuthMode, UserStatus
from app.modules.user_management.services import admin_users


class FakeQuery:
    def __init__(self, mapping):
        self.mapping = mapping
        self.model = None

    def __call__(self, model):
        self.model = model
        return self

    def filter(self, *conditions):
        return self

    def first(self):
        model_name = self.model.__name__
        return self.mapping.get(model_name.lower())


class FakeDB:
    def __init__(self, *, user=None, role=None, team=None):
        self.mapping = {"user": user, "role": role, "team": team}
        self.query_builder = FakeQuery(self.mapping)
        self.committed = False

    def query(self, model):
        return self.query_builder(model)

    def add(self, _value):
        if isinstance(_value, User) and _value.id is None:
            _value.id = 99
        return None

    def commit(self):
        self.committed = True

    def refresh(self, _value):
        return None


class CreateUserTests(unittest.TestCase):
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
