import unittest
from types import SimpleNamespace

from sqlalchemy.exc import IntegrityError

from app.modules.user_management.models import UserSavedView
from app.modules.user_management.services import profile


class FakeQuery:
    def __init__(self, db):
        self.db = db

    def filter(self, *conditions):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def all(self):
        return self.db.saved_views


class RaceDB:
    def __init__(self, existing_view):
        self.saved_views = []
        self.existing_view = existing_view
        self.added = []
        self.rolled_back = False

    def query(self, _model):
        return FakeQuery(self)

    def add(self, value):
        self.added.append(value)

    def commit(self):
        raise IntegrityError("insert user_saved_views", {}, Exception("duplicate system view"))

    def rollback(self):
        self.rolled_back = True
        self.saved_views = [self.existing_view]

    def refresh(self, _value):
        raise AssertionError("new duplicate view should not be refreshed")


class SavedViewRaceTests(unittest.TestCase):
    def test_get_or_create_system_saved_view_recovers_from_duplicate_race(self):
        existing = UserSavedView(
            id=9,
            user_id=7,
            module_key="tasks",
            name=profile.SYSTEM_DEFAULT_VIEW_NAME,
            config={"_meta": {"system_default": True}},
            is_default=0,
        )
        db = RaceDB(existing)
        user = SimpleNamespace(id=7)

        view = profile._get_or_create_system_saved_view(
            db,
            user,
            "tasks",
            visible_columns=["title", "status"],
        )

        self.assertIs(view, existing)
        self.assertTrue(db.rolled_back)
        self.assertEqual(len(db.added), 1)


if __name__ == "__main__":
    unittest.main()
