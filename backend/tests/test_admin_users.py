import unittest
from types import SimpleNamespace

from fastapi import HTTPException

from app.modules.user_management.models import UserStatus
from app.modules.user_management.services import admin_users


class FakeQuery:
    def __init__(self, mapping):
        self.mapping = mapping
        self.model = None
        self.filters = []

    def __call__(self, model):
        self.model = model
        self.filters = []
        return self

    def filter(self, *conditions):
        self.filters.extend(conditions)
        return self

    def first(self):
        model_name = self.model.__name__
        if model_name == "User":
            return self.mapping.get("user")
        if model_name == "Role":
            return self.mapping.get("role")
        if model_name == "Team":
            return self.mapping.get("team")
        return None


class FakeDB:
    def __init__(self, *, user=None, role=None, team=None):
        self.mapping = {"user": user, "role": role, "team": team}
        self.query_builder = FakeQuery(self.mapping)
        self.committed = False

    def query(self, model):
        return self.query_builder(model)

    def commit(self):
        self.committed = True


class ApproveUserTests(unittest.TestCase):
    def test_approve_user_rejects_missing_role(self):
        user = SimpleNamespace(role_id=None, team_id=None, is_active=UserStatus.pending)
        db = FakeDB(user=user, role=None, team=SimpleNamespace(id=8))
        payload = SimpleNamespace(role_id=5, team_id=8)

        with self.assertRaises(HTTPException) as exc:
            admin_users.approve_user(db, user_id=1, payload=payload)

        self.assertEqual(exc.exception.status_code, 404)
        self.assertEqual(exc.exception.detail, "Role not found")
        self.assertFalse(db.committed)

    def test_approve_user_rejects_missing_team(self):
        user = SimpleNamespace(role_id=None, team_id=None, is_active=UserStatus.pending)
        db = FakeDB(user=user, role=SimpleNamespace(id=5), team=None)
        payload = SimpleNamespace(role_id=5, team_id=8)

        with self.assertRaises(HTTPException) as exc:
            admin_users.approve_user(db, user_id=1, payload=payload)

        self.assertEqual(exc.exception.status_code, 404)
        self.assertEqual(exc.exception.detail, "Team not found")
        self.assertFalse(db.committed)


if __name__ == "__main__":
    unittest.main()
