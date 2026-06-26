import unittest

from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.passwords import hash_password
from app.modules.user_management.models import Tenant, User, UserStatus
from app.modules.user_management.services.auth import authenticate_manual_user


class UserEmailUniquenessTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(bind=engine, tables=[Tenant.__table__, User.__table__])
        self.SessionLocal = sessionmaker(bind=engine)

    def test_same_email_is_allowed_across_tenants(self):
        db = self.SessionLocal()
        db.add_all(
            [
                Tenant(id=1, slug="tenant-a", name="Tenant A"),
                Tenant(id=2, slug="tenant-b", name="Tenant B"),
                User(
                    id=1,
                    tenant_id=1,
                    email="shared@example.com",
                    is_active=UserStatus.active,
                ),
                User(
                    id=2,
                    tenant_id=2,
                    email="shared@example.com",
                    is_active=UserStatus.active,
                ),
            ]
        )

        db.commit()

        self.assertEqual(db.query(User).filter(User.email == "shared@example.com").count(), 2)
        db.close()

    def test_same_email_is_rejected_inside_one_tenant(self):
        db = self.SessionLocal()
        db.add(Tenant(id=1, slug="tenant-a", name="Tenant A"))
        db.add_all(
            [
                User(
                    id=1,
                    tenant_id=1,
                    email="duplicate@example.com",
                    is_active=UserStatus.active,
                ),
                User(
                    id=2,
                    tenant_id=1,
                    email="duplicate@example.com",
                    is_active=UserStatus.active,
                ),
            ]
        )

        with self.assertRaises(IntegrityError):
            db.commit()
        db.close()

    def test_manual_login_with_shared_email_uses_explicit_tenant_scope(self):
        db = self.SessionLocal()
        password = "SharedEmailPass7842"
        db.add_all(
            [
                Tenant(id=1, slug="tenant-a", name="Tenant A"),
                Tenant(id=2, slug="tenant-b", name="Tenant B"),
                User(
                    id=1,
                    tenant_id=1,
                    email="shared@example.com",
                    password_hash=hash_password(password),
                    is_active=UserStatus.active,
                ),
                User(
                    id=2,
                    tenant_id=2,
                    email="shared@example.com",
                    password_hash=hash_password(password),
                    is_active=UserStatus.active,
                ),
            ]
        )
        db.commit()

        user = authenticate_manual_user(
            db,
            tenant_id=2,
            email="shared@example.com",
            password=password,
        )

        self.assertEqual(user.id, 2)
        self.assertEqual(user.tenant_id, 2)
        db.close()


if __name__ == "__main__":
    unittest.main()
