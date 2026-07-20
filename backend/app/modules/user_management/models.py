import enum
from sqlalchemy import (
    Column,
    BigInteger,
    String,
    ForeignKey,
    Integer,
    SmallInteger,
    Text,
    DateTime,
    Index,
    func,
    Enum,
    JSON,
    Boolean,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from app.core.database import Base

class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    __table_args__ = (
        Index("ix_refresh_tokens_user_jti", "user_id", "token_jti"),
        Index("ix_refresh_tokens_expires_at", "expires_at"),
    )

    id = Column(BigInteger, primary_key=True, index=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_jti = Column(String(64), unique=True, index=True, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

class UserStatus(enum.Enum):
    pending = "pending"
    active = "active"
    inactive = "inactive"


class UserAuthMode(enum.Enum):
    manual_only = "manual_only"
    manual_or_google = "manual_or_google"


class Tenant(Base):
    __tablename__ = "tenants"

    id = Column(BigInteger, primary_key=True, index=True)
    slug = Column(String(120), nullable=False, unique=True, index=True)
    name = Column(String(150), nullable=False)
    is_active = Column(SmallInteger, nullable=False, default=1)
    mfa_policy = Column(String(20), nullable=False, server_default="off")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    domains = relationship(
        "TenantDomain",
        back_populates="tenant",
        cascade="all, delete-orphan",
    )
    users = relationship("User", back_populates="tenant")
    module_configs = relationship(
        "TenantModuleConfig",
        back_populates="tenant",
        cascade="all, delete-orphan",
    )
    sso_settings = relationship(
        "TenantSsoSettings",
        back_populates="tenant",
        cascade="all, delete-orphan",
        uselist=False,
    )


class TenantDomain(Base):
    __tablename__ = "tenant_domains"

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True)
    tenant_id = Column(
        BigInteger,
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    hostname = Column(String(255), nullable=False, unique=True, index=True)
    is_primary = Column(SmallInteger, nullable=False, default=0)
    status = Column(String(20), nullable=False, default="pending", server_default="pending")
    verification_token = Column(String(96), nullable=True, unique=True, index=True)
    verified_at = Column(DateTime(timezone=True), nullable=True)
    last_checked_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    tenant = relationship("Tenant", back_populates="domains")


class TenantSsoSettings(Base):
    __tablename__ = "tenant_sso_settings"
    __table_args__ = (
        UniqueConstraint("tenant_id", name="uq_tenant_sso_settings_tenant"),
        Index("ix_tenant_sso_settings_enabled", "enabled"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    enabled = Column(Boolean, nullable=False, default=False, server_default="false")
    provider_type = Column(String(20), nullable=False, server_default="oidc")
    issuer_url = Column(String(500), nullable=True)
    authorization_endpoint = Column(String(500), nullable=True)
    token_endpoint = Column(String(500), nullable=True)
    userinfo_endpoint = Column(String(500), nullable=True)
    jwks_uri = Column(String(500), nullable=True)
    client_id = Column(String(255), nullable=True)
    encrypted_client_secret = Column(Text, nullable=True)
    client_secret_key_version = Column(String(32), nullable=True)
    allowed_email_domains = Column(JSON, nullable=False, server_default="[]")
    auto_provision_users = Column(Boolean, nullable=False, default=False, server_default="false")
    default_role_id = Column(BigInteger, ForeignKey("roles.id", ondelete="SET NULL"), nullable=True)
    default_team_id = Column(BigInteger, ForeignKey("teams.id", ondelete="SET NULL"), nullable=True)
    email_claim = Column(String(100), nullable=False, server_default="email")
    first_name_claim = Column(String(100), nullable=True)
    last_name_claim = Column(String(100), nullable=True)
    status = Column(String(20), nullable=False, server_default="draft")
    last_test_result = Column(JSON, nullable=True)
    last_successful_login_at = Column(DateTime(timezone=True), nullable=True)
    last_failed_login_reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    tenant = relationship("Tenant", back_populates="sso_settings")
    default_role = relationship("Role", foreign_keys=[default_role_id])
    default_team = relationship("Team", foreign_keys=[default_team_id])

class Role(Base):
    __tablename__ = "roles"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_roles_tenant_name"),
    )

    id = Column(BigInteger, primary_key=True, index=True)
    tenant_id = Column(
        BigInteger,
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String(100), nullable=False)
    level = Column(SmallInteger, nullable=False, default=1)
    description = Column(String, nullable=True)

    tenant = relationship("Tenant")
    users = relationship("User", back_populates="role")
    module_permissions = relationship(
        "RoleModulePermission",
        back_populates="role",
        cascade="all, delete-orphan",
    )


class Department(Base):
    __tablename__ = "departments"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_departments_tenant_name"),
    )

    id = Column(BigInteger, primary_key=True, index=True)
    tenant_id = Column(
        BigInteger,
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    tenant = relationship("Tenant")
    teams = relationship("Team", back_populates="department")
    module_permissions = relationship(
        "DepartmentModulePermission",
        back_populates="department",
        cascade="all, delete-orphan",
    )

class Team(Base):
    __tablename__ = "teams"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_teams_tenant_name"),
    )

    id = Column(BigInteger, primary_key=True, index=True)
    tenant_id = Column(
        BigInteger,
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
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
    tenant = relationship("Tenant")
    department = relationship("Department", back_populates="teams")
    module_permissions = relationship(
        "TeamModulePermission",
        back_populates="team",
        cascade="all, delete-orphan",
    )

class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        Index("ix_users_tenant_status", "tenant_id", "is_active"),
        Index("ix_users_tenant_team", "tenant_id", "team_id"),
        Index("ix_users_tenant_role", "tenant_id", "role_id"),
        UniqueConstraint("tenant_id", "email", name="uq_users_tenant_email"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True)
    tenant_id = Column(
        BigInteger,
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    team_id = Column(BigInteger, ForeignKey("teams.id", ondelete="SET NULL"), nullable=True)
    department_id = Column(BigInteger, ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True)
    role_id = Column(BigInteger, ForeignKey("roles.id", ondelete="RESTRICT"), nullable=True)

    first_name = Column(String(100), nullable=True)
    last_name = Column(String(100), nullable=True)
    email = Column(String(150), nullable=False, index=True)
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
    last_login_provider = Column(String(20), nullable=True, index=True)
    mfa_enabled = Column(Boolean, nullable=False, server_default="false")
    encrypted_totp_secret = Column(Text, nullable=True)
    mfa_secret_key_version = Column(String(32), nullable=True)
    mfa_verified_at = Column(DateTime(timezone=True), nullable=True)

    is_active = Column(
        Enum(UserStatus, name="user_status"),
        nullable=False,
        server_default=UserStatus.inactive.value,
    )

    team = relationship("Team", back_populates="users")
    department = relationship("Department")
    role = relationship("Role", back_populates="users")
    tenant = relationship("Tenant", back_populates="users")
    setup_tokens = relationship(
        "UserSetupToken",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    mfa_backup_codes = relationship(
        "UserMfaBackupCode",
        back_populates="user",
        cascade="all, delete-orphan",
    )


class UserMfaBackupCode(Base):
    __tablename__ = "user_mfa_backup_codes"
    __table_args__ = (
        Index("ix_user_mfa_backup_codes_user_consumed", "user_id", "consumed_at"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    code_hash = Column(String(64), nullable=False, unique=True, index=True)
    consumed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user = relationship("User", back_populates="mfa_backup_codes")


class Module(Base):
    __tablename__ = "modules"

    id = Column(BigInteger, primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True)
    base_route = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    is_enabled = Column(SmallInteger, nullable=False, default=1)
    import_duplicate_mode = Column(String(20), nullable=False, server_default="skip")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    tenant_configs = relationship(
        "TenantModuleConfig",
        back_populates="module",
        cascade="all, delete-orphan",
    )
    department_permissions = relationship(
        "DepartmentModulePermission",
        back_populates="module",
    )
    team_permissions = relationship(
        "TeamModulePermission",
        back_populates="module",
        cascade="all, delete-orphan",
    )
    role_permissions = relationship(
        "RoleModulePermission",
        back_populates="module",
        cascade="all, delete-orphan",
    )


class TenantModuleConfig(Base):
    __tablename__ = "tenant_module_configs"
    __table_args__ = (
        UniqueConstraint("tenant_id", "module_id", name="uq_tenant_module_configs_tenant_module"),
    )

    id = Column(BigInteger, primary_key=True, index=True)
    tenant_id = Column(
        BigInteger,
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    module_id = Column(
        BigInteger,
        ForeignKey("modules.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    is_enabled = Column(SmallInteger, nullable=False, default=1)
    import_duplicate_mode = Column(String(20), nullable=False, server_default="skip")
    sidebar_tab_key = Column(String(100), nullable=True)
    display_name = Column(String(150), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    tenant = relationship("Tenant", back_populates="module_configs")
    module = relationship("Module", back_populates="tenant_configs")


class TenantSidebarTab(Base):
    __tablename__ = "tenant_sidebar_tabs"
    __table_args__ = (
        UniqueConstraint("tenant_id", "key", name="uq_tenant_sidebar_tabs_tenant_key"),
    )

    id = Column(BigInteger, primary_key=True, index=True)
    tenant_id = Column(
        BigInteger,
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    key = Column(String(100), nullable=False, index=True)
    label = Column(String(120), nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class DepartmentModulePermission(Base):
    __tablename__ = "department_module_permissions"
    __table_args__ = (
        UniqueConstraint("department_id", "module_id", name="uq_department_module_permissions_department_module"),
    )

    id = Column(BigInteger, primary_key=True, index=True)
    department_id = Column(
        BigInteger,
        ForeignKey("departments.id", ondelete="CASCADE"),
        nullable=False,
    )
    module_id = Column(BigInteger, ForeignKey("modules.id", ondelete="CASCADE"), nullable=False)

    department = relationship("Department", back_populates="module_permissions")
    module = relationship("Module", back_populates="department_permissions")


class TeamModulePermission(Base):
    __tablename__ = "team_module_permissions"
    __table_args__ = (
        UniqueConstraint("team_id", "module_id", name="uq_team_module_permissions_team_module"),
    )

    id = Column(BigInteger, primary_key=True, index=True)
    team_id = Column(
        BigInteger,
        ForeignKey("teams.id", ondelete="CASCADE"),
        nullable=False,
    )
    module_id = Column(
        BigInteger,
        ForeignKey("modules.id", ondelete="CASCADE"),
        nullable=False,
    )

    team = relationship("Team", back_populates="module_permissions")
    module = relationship("Module", back_populates="team_permissions")


class RoleModulePermission(Base):
    __tablename__ = "role_module_permissions"
    __table_args__ = (
        UniqueConstraint("role_id", "module_id", name="uq_role_module_permissions_role_module"),
    )

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
    __table_args__ = (
        Index("ix_user_setup_tokens_expires_at", "expires_at"),
        Index("ix_user_setup_tokens_consumed_expires", "consumed_at", "expires_at"),
        Index("ix_user_setup_tokens_user_consumed", "user_id", "consumed_at"),
    )

    id = Column(BigInteger, primary_key=True, index=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(64), nullable=False, unique=True, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    consumed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user = relationship("User", back_populates="setup_tokens")


class CompanyProfile(Base):
    __tablename__ = "company_profiles"
    __table_args__ = (
        UniqueConstraint("tenant_id", name="uq_company_profiles_tenant_id"),
    )

    id = Column(BigInteger, primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
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
    __table_args__ = (
        UniqueConstraint("user_id", "module_key", name="uq_user_table_preferences_user_module"),
    )

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


class UserDashboardLayout(Base):
    __tablename__ = "user_dashboard_layouts"
    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", name="uq_user_dashboard_layouts_tenant_user"),
    )

    id = Column(BigInteger, primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    layout = Column(JSON, nullable=False, server_default="{}")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    user = relationship("User")
    tenant = relationship("Tenant")


class UserSavedView(Base):
    __tablename__ = "user_saved_views"
    __table_args__ = (
        Index("ix_user_saved_views_user_module", "user_id", "module_key"),
    )

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
