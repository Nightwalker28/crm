from typing import Optional, List, Any
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, EmailStr, field_validator

class UserStatus(str, Enum):
    pending = "pending"
    active = "active"
    inactive = "inactive"


class UserAuthMode(str, Enum):
    manual_only = "manual_only"
    manual_or_google = "manual_or_google"

class UserProfile(BaseModel):
    id: int
    first_name: Optional[str]
    last_name: Optional[str]
    email: EmailStr
    team_id: Optional[int]
    role_id: Optional[int]
    team_name: Optional[str] = None
    role_name: Optional[str] = None
    role_level: Optional[int] = None
    is_admin: bool = False
    photo_url: Optional[str]
    phone_number: Optional[str] = None
    job_title: Optional[str] = None
    timezone: Optional[str] = None
    bio: Optional[str] = None
    auth_mode: UserAuthMode
    last_login_provider: Optional[str] = None
    is_active: UserStatus

    model_config = ConfigDict(from_attributes=True)

class UserListItem(BaseModel):
    id: int
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[EmailStr] = None
    team_id: Optional[int] = None
    role_id: Optional[int] = None
    team_name: Optional[str] = None
    role_name: Optional[str] = None
    photo_url: Optional[str] = None
    auth_mode: Optional[UserAuthMode] = None
    is_active: Optional[UserStatus] = None

class UserListResponse(BaseModel):
    results: List[UserListItem]  # Renamed from 'users' to match pagination.py helper
    range_start: int = 0
    range_end: int = 0
    total_count: int
    total_pages: int
    page: int
    page_size: int

class OptionSummary(BaseModel):
    id: int
    name: str

    model_config = ConfigDict(from_attributes=True)

class UserUpdateOptions(BaseModel):
    roles: list[OptionSummary]
    teams: list[OptionSummary]
    statuses: list[UserStatus]


class RolePermissionActions(BaseModel):
    can_view: bool = True
    can_create: bool = False
    can_edit: bool = False
    can_delete: bool = False
    can_restore: bool = False
    can_export: bool = False
    can_configure: bool = False


class RoleTemplateSummary(BaseModel):
    key: str
    label: str
    description: str


class RoleSchema(BaseModel):
    id: int
    name: str
    level: int
    description: str | None = None

    model_config = ConfigDict(from_attributes=True)


class ModulePermissionSchema(BaseModel):
    module_id: int
    module_name: str
    module_description: str | None = None
    actions: RolePermissionActions


class RolePermissionOverviewResponse(BaseModel):
    roles: list[RoleSchema]
    templates: list[RoleTemplateSummary]
    modules: list[ModulePermissionSchema]


class RoleCreateRequest(BaseModel):
    name: str
    description: str | None = None
    level: int | None = None
    template_key: str = "user"


class RoleUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    level: int | None = None


class ModulePermissionUpdateRequest(BaseModel):
    module_id: int
    actions: RolePermissionActions


class RolePermissionUpdateRequest(BaseModel):
    permissions: list[ModulePermissionUpdateRequest]

class ApproveUserRequest(BaseModel):
    role_id: int
    team_id: int

class UpdateUserRequest(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    team_id: Optional[int] = None
    role_id: Optional[int] = None
    is_active: Optional[UserStatus] = None
    auth_mode: Optional[UserAuthMode] = None

    @field_validator("is_active")
    @classmethod
    def reject_pending_status(cls, value: Optional[UserStatus]) -> Optional[UserStatus]:
        if value == UserStatus.pending:
            raise ValueError("Pending status is no longer supported")
        return value
    
class DepartmentSchema(BaseModel):
    id: int
    name: str
    description: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class DepartmentCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None


class DepartmentUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class TeamSchema(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    department_id: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)


class TeamCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    department_id: int


class TeamUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    department_id: Optional[int] = None


class ModuleSchema(BaseModel):
    id: int
    name: str
    base_route: Optional[str] = None
    description: Optional[str] = None
    is_enabled: bool = True
    import_duplicate_mode: str = "skip"
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class ModuleUpdateRequest(BaseModel):
    name: str | None = None
    base_route: str | None = None
    description: str | None = None
    is_enabled: bool | None = None
    import_duplicate_mode: str | None = None


class ModuleAccessDepartmentOption(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    has_access: bool = False


class ModuleAccessTeamOption(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    department_id: Optional[int] = None
    department_name: Optional[str] = None
    has_access: bool = False


class ModuleAccessSchema(BaseModel):
    module: ModuleSchema
    departments: list[ModuleAccessDepartmentOption]
    teams: list[ModuleAccessTeamOption]


class ModuleAccessUpdateRequest(BaseModel):
    department_ids: list[int] = []
    team_ids: list[int] = []

class AuthResponse(BaseModel):
    status: str
    message: str
    access_token: Optional[str] = None
    token_type: Optional[str] = None


class ManualSignupRequest(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: EmailStr
    password: str


class ManualLoginRequest(BaseModel):
    email: EmailStr
    password: str


class SetupPasswordRequest(BaseModel):
    token: str
    password: str


class AdminCreateUserRequest(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: EmailStr
    team_id: int
    role_id: int
    auth_mode: UserAuthMode
    is_active: UserStatus = UserStatus.active


class AdminCreateUserResponse(BaseModel):
    user: UserProfile
    setup_link: Optional[str] = None


class UserProfileUpdateRequest(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    photo_url: Optional[str] = None
    phone_number: Optional[str] = None
    job_title: Optional[str] = None
    timezone: Optional[str] = None
    bio: Optional[str] = None


class UserImageUploadResponse(BaseModel):
    photo_url: str
    user: UserProfile


class CompanyProfileResponse(BaseModel):
    id: int
    name: str
    primary_email: Optional[str] = None
    website: Optional[str] = None
    primary_phone: Optional[str] = None
    industry: Optional[str] = None
    country: Optional[str] = None
    operating_currencies: list[str] = []
    billing_address: Optional[str] = None
    logo_url: Optional[str] = None
    updated_by: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class CompanyProfileUpdateRequest(BaseModel):
    name: Optional[str] = None
    primary_email: Optional[str] = None
    website: Optional[str] = None
    primary_phone: Optional[str] = None
    industry: Optional[str] = None
    country: Optional[str] = None
    operating_currencies: list[str] | None = None
    billing_address: Optional[str] = None
    logo_url: Optional[str] = None


class CompanyLogoUploadResponse(BaseModel):
    logo_url: str
    company: CompanyProfileResponse


class TablePreferenceResponse(BaseModel):
    module_key: str
    visible_columns: list[str]


class TablePreferenceUpdateRequest(BaseModel):
    visible_columns: list[str]


class SavedViewConfig(BaseModel):
    visible_columns: list[str] = []
    filters: dict[str, Any] = {}
    sort: dict[str, Any] | None = None


class SavedViewResponse(BaseModel):
    id: int | None = None
    module_key: str
    name: str
    config: SavedViewConfig
    is_default: bool = False
    is_system: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None


class SavedViewsListResponse(BaseModel):
    views: list[SavedViewResponse]


class SavedViewCreateRequest(BaseModel):
    name: str
    config: SavedViewConfig
    is_default: bool = False


class SavedViewUpdateRequest(BaseModel):
    name: str | None = None
    config: SavedViewConfig | None = None
    is_default: bool | None = None
