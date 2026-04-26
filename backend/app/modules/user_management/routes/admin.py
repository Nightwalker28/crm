from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.module_filters import normalize_filter_logic, parse_filter_conditions
from app.core.security import require_admin
from app.core.tenancy import get_frontend_origin_for_request
from app.core.pagination import Pagination, get_pagination
from app.modules.user_management.schema import (
    AdminCreateUserRequest,
    AdminCreateUserResponse,
    ModuleAccessSchema,
    ModuleAccessUpdateRequest,
    ModuleSchema,
    ModuleUpdateRequest,
    DepartmentCreateRequest,
    DepartmentSchema,
    DepartmentUpdateRequest,
    ModulePermissionSchema,
    RoleCreateRequest,
    RolePermissionOverviewResponse,
    RolePermissionUpdateRequest,
    RoleSchema,
    RoleUpdateRequest,
    TeamCreateRequest,
    TeamSchema,
    TeamUpdateRequest,
    UpdateUserRequest,
    UserListResponse,
    UserListItem,
    UserProfile,
    UserUpdateOptions,
)
from app.modules.user_management.services import admin_modules, admin_structure, admin_users, role_permissions
from typing import Optional

router = APIRouter(prefix="/admin/users", tags=["Admin Users"])

USER_LIST_FIELDS = {
    "first_name",
    "last_name",
    "email",
    "team_id",
    "role_id",
    "team_name",
    "role_name",
    "photo_url",
    "auth_mode",
    "is_active",
}


def _parse_list_fields(raw_fields: str | None) -> set[str]:
    if not raw_fields:
        return USER_LIST_FIELDS
    requested = {field.strip() for field in raw_fields.split(",") if field.strip()}
    valid = requested & USER_LIST_FIELDS
    return valid or USER_LIST_FIELDS


def _serialize_user_list_item(user, fields: set[str]) -> UserListItem:
    safe_fields = set(fields)
    safe_fields.update({"team_name", "first_name", "last_name", "email", "team_id", "role_id", "role_name", "auth_mode", "is_active", "photo_url"})
    payload = {"id": user.id}
    for field in safe_fields:
        payload[field] = getattr(user, field, None)
    return UserListItem.model_validate(payload)

@router.get("", response_model=UserListResponse)
def list_all_users(
    fields: Optional[str] = Query(None),
    pagination: Pagination = Depends(get_pagination), 
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    response = admin_users.list_all_users(db, tenant_id=admin.tenant_id, pagination=pagination)
    selected_fields = _parse_list_fields(fields)
    response["results"] = [_serialize_user_list_item(user, selected_fields) for user in response["results"]]
    return response

@router.get("/search", response_model=UserListResponse)
def search_users(
    q: Optional[str] = Query(None, alias="search"),
    teams: Optional[str] = Query(None),
    roles: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    sort_by: str = Query("name"),
    sort_order: str = Query("asc"),
    fields: Optional[str] = Query(None),
    filter_logic: str = Query(default="all"),
    filters: str | None = Query(default=None),
    filters_all: str | None = Query(default=None),
    filters_any: str | None = Query(default=None),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    try:
        all_conditions = parse_filter_conditions(filters_all or (filters if normalize_filter_logic(filter_logic) != "any" else None))
        any_conditions = parse_filter_conditions(filters_any or (filters if normalize_filter_logic(filter_logic) == "any" else None))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    response = admin_users.search_users(
        db,
        tenant_id=admin.tenant_id,
        pagination=pagination,
        q=q,
        teams=teams,
        roles=roles,
        status_filter=status,
        sort_by=sort_by,
        sort_order=sort_order,
        all_filter_conditions=all_conditions,
        any_filter_conditions=any_conditions,
    )
    selected_fields = _parse_list_fields(fields)
    response["results"] = [_serialize_user_list_item(user, selected_fields) for user in response["results"]]
    return response

@router.get("/options", response_model=UserUpdateOptions)
def list_user_update_options(
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return admin_users.list_user_update_options(db, tenant_id=admin.tenant_id)


@router.get("/modules", response_model=list[ModuleSchema])
def list_modules(
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return admin_modules.list_modules(db, tenant_id=admin.tenant_id)


@router.put("/modules/{module_id}", response_model=ModuleSchema)
def update_module(
    module_id: int,
    payload: ModuleUpdateRequest,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return admin_modules.update_module(db, module_id, payload, tenant_id=admin.tenant_id)


@router.get("/modules/{module_id}/access", response_model=ModuleAccessSchema)
def get_module_access(
    module_id: int,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return admin_modules.get_module_access(db, module_id, tenant_id=admin.tenant_id)


@router.put("/modules/{module_id}/access", response_model=ModuleAccessSchema)
def update_module_access(
    module_id: int,
    payload: ModuleAccessUpdateRequest,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return admin_modules.update_module_access(db, module_id, payload, tenant_id=admin.tenant_id)


@router.get("/roles/permissions", response_model=RolePermissionOverviewResponse)
def get_role_permission_overview(
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return role_permissions.list_role_permission_overview(db, tenant_id=admin.tenant_id)


@router.get("/roles/{role_id}/permissions", response_model=list[ModulePermissionSchema])
def get_role_permissions(
    role_id: int,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return role_permissions.get_role_permissions(db, role_id, tenant_id=admin.tenant_id)


@router.post("/roles", response_model=RoleSchema, status_code=status.HTTP_201_CREATED)
def create_role(
    payload: RoleCreateRequest,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return role_permissions.create_role(db, payload, tenant_id=admin.tenant_id)


@router.put("/roles/{role_id}", response_model=RoleSchema)
def update_role(
    role_id: int,
    payload: RoleUpdateRequest,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return role_permissions.update_role(db, role_id, payload, tenant_id=admin.tenant_id)


@router.put("/roles/{role_id}/permissions", response_model=list[ModulePermissionSchema])
def update_role_permissions(
    role_id: int,
    payload: RolePermissionUpdateRequest,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return role_permissions.update_role_permissions(db, role_id, payload, tenant_id=admin.tenant_id)


@router.post("", response_model=AdminCreateUserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: AdminCreateUserRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return admin_users.create_user(
        db,
        payload,
        tenant_id=admin.tenant_id,
        frontend_origin=get_frontend_origin_for_request(request),
    )

@router.post("/departments", response_model=DepartmentSchema, status_code=status.HTTP_201_CREATED)
def create_department(
    payload: DepartmentCreateRequest,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return admin_structure.create_department(db, payload, tenant_id=admin.tenant_id)


@router.get("/departments", response_model=list[DepartmentSchema])
def list_departments(
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return admin_structure.list_departments(db, tenant_id=admin.tenant_id)


@router.put("/departments/{department_id}", response_model=DepartmentSchema)
def update_department(
    department_id: int,
    payload: DepartmentUpdateRequest,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return admin_structure.update_department(db, department_id, payload, tenant_id=admin.tenant_id)


@router.delete("/departments/{department_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_department(
    department_id: int,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    admin_structure.delete_department(db, department_id, tenant_id=admin.tenant_id)


@router.post("/teams", response_model=TeamSchema, status_code=status.HTTP_201_CREATED)
def create_team(
    payload: TeamCreateRequest,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return admin_structure.create_team(db, payload, tenant_id=admin.tenant_id)


@router.get("/teams", response_model=list[TeamSchema])
def list_teams(
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return admin_structure.list_teams(db, tenant_id=admin.tenant_id)


@router.put("/teams/{team_id}", response_model=TeamSchema)
def update_team(
    team_id: int,
    payload: TeamUpdateRequest,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return admin_structure.update_team(db, team_id, payload, tenant_id=admin.tenant_id)


@router.delete("/teams/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_team(
    team_id: int,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    admin_structure.delete_team(db, team_id, tenant_id=admin.tenant_id)

@router.put("/{user_id}", response_model=UserProfile)
def update_user(
    user_id: int,
    payload: UpdateUserRequest,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return admin_users.update_user(db, user_id, payload, tenant_id=admin.tenant_id)
