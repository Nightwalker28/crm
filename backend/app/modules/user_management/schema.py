from typing import Optional, List
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, EmailStr

class UserStatus(str, Enum):
    pending = "pending"
    active = "active"
    inactive = "inactive"

class UserProfile(BaseModel):
    id: int
    first_name: Optional[str]
    last_name: Optional[str]
    email: EmailStr
    team_id: Optional[int]
    role_id: Optional[int]
    team_name: Optional[str] = None
    role_name: Optional[str] = None
    photo_url: Optional[str]
    is_active: UserStatus

    model_config = ConfigDict(from_attributes=True)

class UserListResponse(BaseModel):
    results: List[UserProfile]  # Renamed from 'users' to match pagination.py helper
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

class ApproveUserRequest(BaseModel):
    role_id: int
    team_id: int

class UpdateUserRequest(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    team_id: Optional[int] = None
    role_id: Optional[int] = None
    is_active: Optional[UserStatus] = None
    
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
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

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
