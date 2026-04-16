import enum
import uuid
from sqlalchemy import (
    Column,
    BigInteger,
    String,
    ForeignKey,
    SmallInteger,
    Text,
    DateTime,
    func,
    Enum,
    JSON,
)
from sqlalchemy.orm import relationship
from app.core.database import Base
from datetime import datetime

class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(BigInteger, primary_key=True, index=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_jti = Column(String(64), unique=True, index=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class UserGoogleToken(Base):
    __tablename__ = "user_google_tokens"

    id = Column(BigInteger, primary_key=True, index=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    access_token_enc = Column(Text, nullable=False)
    refresh_token_enc = Column(Text, nullable=True)
    scopes = Column(Text, nullable=True)
    token_type = Column(String(50), nullable=True)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="google_tokens")

class UserStatus(enum.Enum):
    pending = "pending"
    active = "active"
    inactive = "inactive"


class UserAuthMode(enum.Enum):
    manual_only = "manual_only"
    manual_or_google = "manual_or_google"

class Role(Base):
    __tablename__ = "roles"

    id = Column(BigInteger, primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True)
    level = Column(SmallInteger, nullable=False, default=1)
    description = Column(String, nullable=True)

    users = relationship("User", back_populates="role")
    module_permissions = relationship(
        "RoleModulePermission",
        back_populates="role",
        cascade="all, delete-orphan",
    )


class Department(Base):
    __tablename__ = "departments"

    id = Column(BigInteger, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    teams = relationship("Team", back_populates="department")
    module_permissions = relationship(
        "DepartmentModulePermission",
        back_populates="department",
        cascade="all, delete-orphan",
    )

class Team(Base):
    __tablename__ = "teams"

    id = Column(BigInteger, primary_key=True, index=True)
    department_id = Column(
        BigInteger,
        ForeignKey("departments.id", ondelete="RESTRICT"),
        nullable=True,
    )
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    users = relationship("User", back_populates="team")
    department = relationship("Department", back_populates="teams")

class User(Base):
    __tablename__ = "users"

    id = Column(BigInteger, primary_key=True, index=True)
    team_id = Column(BigInteger, ForeignKey("teams.id", ondelete="SET NULL"), nullable=True)
    role_id = Column(BigInteger, ForeignKey("roles.id", ondelete="RESTRICT"), nullable=True)

    first_name = Column(String(100), nullable=True)
    last_name = Column(String(100), nullable=True)
    email = Column(String(150), nullable=False, unique=True, index=True)
    password_hash = Column(Text, nullable=True)
    photo_url = Column(String(500), nullable=True)
    phone_number = Column(String(50), nullable=True)
    job_title = Column(String(150), nullable=True)
    timezone = Column(String(100), nullable=True)
    bio = Column(Text, nullable=True)
    auth_mode = Column(
        Enum(UserAuthMode, name="user_auth_mode"),
        nullable=False,
        server_default=UserAuthMode.manual_or_google.value,
    )

    is_active = Column(
        Enum(UserStatus, name="user_status"),
        nullable=False,
        server_default=UserStatus.inactive.value,
    )

    team = relationship("Team", back_populates="users")
    role = relationship("Role", back_populates="users")
    google_tokens = relationship(
        "UserGoogleToken",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )
    setup_tokens = relationship(
        "UserSetupToken",
        back_populates="user",
        cascade="all, delete-orphan",
    )

    @property
    def team_name(self) -> str | None:
        return self.team.name if self.team else None

    @property
    def role_name(self) -> str | None:
        return self.role.name if self.role else None


class Module(Base):
    __tablename__ = "modules"

    id = Column(BigInteger, primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True)
    base_route = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    is_enabled = Column(SmallInteger, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    department_permissions = relationship(
        "DepartmentModulePermission",
        back_populates="module",
    )
    role_permissions = relationship(
        "RoleModulePermission",
        back_populates="module",
        cascade="all, delete-orphan",
    )


class DepartmentModulePermission(Base):
    __tablename__ = "department_module_permissions"

    id = Column(BigInteger, primary_key=True, index=True)
    department_id = Column(
        BigInteger,
        ForeignKey("departments.id", ondelete="CASCADE"),
        nullable=False,
    )
    module_id = Column(BigInteger, ForeignKey("modules.id", ondelete="CASCADE"), nullable=False)

    department = relationship("Department", back_populates="module_permissions")
    module = relationship("Module", back_populates="department_permissions")


class RoleModulePermission(Base):
    __tablename__ = "role_module_permissions"

    id = Column(BigInteger, primary_key=True, index=True)
    role_id = Column(
        BigInteger,
        ForeignKey("roles.id", ondelete="CASCADE"),
        nullable=False,
    )
    module_id = Column(
        BigInteger,
        ForeignKey("modules.id", ondelete="CASCADE"),
        nullable=False,
    )
    can_view = Column(SmallInteger, nullable=False, default=1)
    can_create = Column(SmallInteger, nullable=False, default=0)
    can_edit = Column(SmallInteger, nullable=False, default=0)
    can_delete = Column(SmallInteger, nullable=False, default=0)
    can_restore = Column(SmallInteger, nullable=False, default=0)
    can_export = Column(SmallInteger, nullable=False, default=0)
    can_configure = Column(SmallInteger, nullable=False, default=0)

    role = relationship("Role", back_populates="module_permissions")
    module = relationship("Module", back_populates="role_permissions")


class UserSetupToken(Base):
    __tablename__ = "user_setup_tokens"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(64), nullable=False, unique=True, index=True)
    expires_at = Column(DateTime, nullable=False)
    consumed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="setup_tokens")


class CompanyProfile(Base):
    __tablename__ = "company_profiles"

    id = Column(BigInteger, primary_key=True, index=True)
    name = Column(String(150), nullable=False)
    primary_email = Column(String(150), nullable=True)
    website = Column(String(255), nullable=True)
    primary_phone = Column(String(50), nullable=True)
    industry = Column(String(120), nullable=True)
    country = Column(String(120), nullable=True)
    operating_currencies = Column(JSON, nullable=True)
    billing_address = Column(Text, nullable=True)
    logo_url = Column(String(500), nullable=True)
    updated_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    updated_by_user = relationship("User")


class UserTablePreference(Base):
    __tablename__ = "user_table_preferences"

    id = Column(BigInteger, primary_key=True, index=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    module_key = Column(String(100), nullable=False, index=True)
    visible_columns = Column(JSON, nullable=False, server_default="[]")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    user = relationship("User")


class UserSavedView(Base):
    __tablename__ = "user_saved_views"

    id = Column(BigInteger, primary_key=True, index=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    module_key = Column(String(100), nullable=False, index=True)
    name = Column(String(150), nullable=False)
    config = Column(JSON, nullable=False, server_default="{}")
    is_default = Column(SmallInteger, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    user = relationship("User")
