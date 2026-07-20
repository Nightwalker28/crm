import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.user_management.models import Role, Team, User, UserAuthMode, UserStatus
from app.modules.user_management.repositories import admin_users_repository
from app.modules.user_management.routes import admin as admin_routes
from app.modules.user_management.schema import BulkUpdateUsersRequest, UpdateUserRequest, UserProfile
from app.modules.user_management.services import admin_users
from app.modules.user_management.models import Tenant


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


class AdminUserQueryCountTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.engine = engine
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default", mfa_policy="admins_only"),
                Role(id=1, tenant_id=10, name="Admin", level=90),
                Team(id=1, tenant_id=10, name="Revenue"),
                User(
                    id=1,
                    tenant_id=10,
                    email="ada@example.com",
                    first_name="Ada",
                    last_name="Lovelace",
                    role_id=1,
                    team_id=1,
                    auth_mode=UserAuthMode.manual_only,
                    is_active=UserStatus.active,
                ),
                User(
                    id=2,
                    tenant_id=10,
                    email="grace@example.com",
                    first_name="Grace",
                    last_name="Hopper",
                    role_id=1,
                    team_id=1,
                    auth_mode=UserAuthMode.manual_only,
                    is_active=UserStatus.active,
                ),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def _count_statements(self, callback) -> int:
        statements = []

        def before_cursor_execute(_conn, _cursor, statement, _parameters, _context, _executemany):
            statements.append(statement)

        event.listen(self.engine, "before_cursor_execute", before_cursor_execute)
        try:
            callback()
        finally:
            event.remove(self.engine, "before_cursor_execute", before_cursor_execute)
        return len(statements)

    def test_admin_user_list_and_search_query_counts_are_bounded(self):
        list_count = self._count_statements(
            lambda: admin_users.list_all_users(
                self.db,
                tenant_id=10,
                pagination=SimpleNamespace(offset=0, limit=25, page=1, page_size=25),
            )
        )
        search_count = self._count_statements(
            lambda: admin_users.search_users(
                self.db,
                tenant_id=10,
                pagination=SimpleNamespace(offset=0, limit=25, page=1, page_size=25),
                q=None,
                teams=None,
                roles=None,
                status_filter=None,
                sort_by="name",
                sort_order="asc",
            )
        )

        self.assertLessEqual(list_count, 3)
        self.assertLessEqual(search_count, 3)

    def test_admin_user_cursor_query_counts_are_bounded(self):
        list_count = self._count_statements(
            lambda: admin_users.list_all_users_cursor(self.db, tenant_id=10, limit=25)
        )
        search_count = self._count_statements(
            lambda: admin_users.search_users_cursor(
                self.db,
                tenant_id=10,
                limit=25,
                q=None,
                teams=None,
                roles=None,
                status_filter=None,
                sort_by="name",
                sort_order="asc",
            )
        )

        self.assertLessEqual(list_count, 2)
        self.assertLessEqual(search_count, 2)

    def test_bulk_update_users_changes_role_and_status_atomically(self):
        self.db.add(Role(id=2, tenant_id=10, name="Manager", level=50))
        self.db.commit()

        updated = admin_users.bulk_update_users(
            self.db,
            BulkUpdateUsersRequest(
                user_ids=[1, 2],
                role_id=2,
                is_active=UserStatus.inactive,
            ),
            tenant_id=10,
            actor_user_id=99,
        )

        self.assertEqual([user.id for user in updated], [1, 2])
        self.assertTrue(all(user.role_id == 2 for user in updated))
        self.assertTrue(all(user.is_active == UserStatus.inactive for user in updated))
        self.assertTrue(all(user._serialized_role_name == "Manager" for user in updated))

    def test_bulk_update_users_rejects_cross_tenant_ids_without_partial_update(self):
        self.db.add_all(
            [
                Tenant(id=20, slug="other", name="Other"),
                Role(id=20, tenant_id=20, name="Other Admin", level=90),
                User(
                    id=20,
                    tenant_id=20,
                    email="other@example.com",
                    role_id=20,
                    auth_mode=UserAuthMode.manual_only,
                    is_active=UserStatus.active,
                ),
            ]
        )
        self.db.commit()

        with self.assertRaises(HTTPException) as exc:
            admin_users.bulk_update_users(
                self.db,
                BulkUpdateUsersRequest(user_ids=[1, 20], is_active=UserStatus.inactive),
                tenant_id=10,
                actor_user_id=99,
            )

        self.assertEqual(exc.exception.status_code, 404)
        self.assertEqual(self.db.get(User, 1).is_active, UserStatus.active)

    def test_bulk_update_users_prevents_self_deactivation(self):
        with self.assertRaises(HTTPException) as exc:
            admin_users.bulk_update_users(
                self.db,
                BulkUpdateUsersRequest(user_ids=[1], is_active=UserStatus.inactive),
                tenant_id=10,
                actor_user_id=1,
            )

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(self.db.get(User, 1).is_active, UserStatus.active)


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


class UserListProjectionTests(unittest.TestCase):
    def _profile(self) -> SimpleNamespace:
        return UserProfile(
            id=7,
            first_name="Ada",
            last_name="Lovelace",
            email="ada@example.com",
            team_id=2,
            role_id=3,
            team_name="Revenue",
            role_name="Manager",
            role_level=50,
            is_admin=False,
            photo_url="https://cdn.example/avatar.png",
            phone_number=None,
            job_title=None,
            timezone=None,
            bio=None,
            auth_mode=UserAuthMode.manual_only,
            last_login_provider=None,
            mfa_enabled=True,
            mfa_required=False,
            is_active=UserStatus.active,
        )

    def test_parse_list_fields_defaults_to_full_user_list_projection(self):
        fields = admin_routes._parse_list_fields(None)
        item = admin_routes._serialize_user_list_item(self._profile(), fields)

        self.assertIn("email", item.model_fields_set)
        self.assertIn("team_name", item.model_fields_set)
        self.assertIn("mfa_enabled", item.model_fields_set)
        self.assertEqual(item.email, "ada@example.com")
        self.assertEqual(item.team_name, "Revenue")

    def test_serialize_user_list_item_respects_requested_projection(self):
        fields = admin_routes._parse_list_fields("email,role_name")
        item = admin_routes._serialize_user_list_item(self._profile(), fields)

        self.assertEqual(item.id, 7)
        self.assertEqual(item.email, "ada@example.com")
        self.assertEqual(item.role_name, "Manager")
        self.assertIn("email", item.model_fields_set)
        self.assertIn("role_name", item.model_fields_set)
        self.assertNotIn("team_name", item.model_fields_set)
        self.assertNotIn("mfa_enabled", item.model_fields_set)


if __name__ == "__main__":
    unittest.main()
