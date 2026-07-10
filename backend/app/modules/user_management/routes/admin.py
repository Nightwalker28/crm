from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session
from app.core.cursor_pagination import CursorPagination, build_cursor_response, get_cursor_pagination
from app.core.database import get_db
from app.core.list_fields import parse_list_fields
from app.core.module_filters import parse_filter_conditions
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
    SidebarTabCreateRequest,
    SidebarTabSchema,
    SidebarTabUpdateRequest,
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
    TenantDomainCreateRequest,
    TenantDomainResponse,
    TenantSsoSettingsResponse,
    TenantSsoTestResponse,
    TenantSsoSettingsUpdateRequest,
    TenantMfaPolicyRequest,
    TenantMfaPolicyResponse,
    UpdateUserRequest,
    UserListResponse,
    UserListItem,
    UserProfile,
    UserUpdateOptions,
    AdminMfaResetResponse,
)
from app.modules.user_management.services import admin_modules, admin_structure, admin_users, role_permissions
from app.modules.user_management.services.mfa import admin_reset_user_mfa, get_tenant_mfa_policy, update_tenant_mfa_policy
from app.modules.user_management.services.sso import get_or_create_sso_settings, serialize_sso_settings, test_sso_settings, update_sso_settings
from app.modules.user_management.services.tenant_domains import create_tenant_domain, delete_tenant_domain, list_tenant_domains, serialize_tenant_domain, verify_tenant_domain
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
    "role_level",
    "photo_url",
    "auth_mode",
    "mfa_enabled",
    "mfa_required",
    "is_active",
}


def _parse_list_fields(raw_fields: str | None) -> set[str]:
    return parse_list_fields(raw_fields, USER_LIST_FIELDS)


def _serialize_user_list_item(user, fields: set[str]) -> UserListItem:
    profile = user if isinstance(user, UserProfile) else admin_users.serialize_user_profile(user)
    profile_payload = profile.model_dump()
    payload = {"id": profile_payload["id"]}
    for field in fields:
        payload[field] = profile_payload.get(field, getattr(user, field, None))
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


@router.get("/cursor", response_model=dict)
def list_all_users_cursor(
    fields: Optional[str] = Query(None),
    pagination: CursorPagination = Depends(get_cursor_pagination),
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    users = admin_users.list_all_users_cursor(
        db,
        tenant_id=admin.tenant_id,
        limit=pagination.limit,
        cursor=pagination.cursor,
    )
    selected_fields = _parse_list_fields(fields)
    return build_cursor_response(
        users,
        limit=pagination.limit,
        id_attr="id",
        serializer=lambda user: _serialize_user_list_item(user, selected_fields).model_dump(mode="json"),
    )


@router.get("/search", response_model=UserListResponse)
def search_users(
    q: Optional[str] = Query(None, alias="search"),
    teams: Optional[str] = Query(None),
    roles: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    sort_by: str = Query("name"),
    sort_order: str = Query("asc"),
    fields: Optional[str] = Query(None),
    filters_all: str | None = Query(default=None),
    filters_any: str | None = Query(default=None),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    try:
        all_conditions = parse_filter_conditions(filters_all)
        any_conditions = parse_filter_conditions(filters_any)
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


@router.get("/search/cursor", response_model=dict)
def search_users_cursor(
    q: Optional[str] = Query(None, alias="search"),
    teams: Optional[str] = Query(None),
    roles: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    sort_by: str = Query("name"),
    sort_order: str = Query("asc"),
    fields: Optional[str] = Query(None),
    filters_all: str | None = Query(default=None),
    filters_any: str | None = Query(default=None),
    pagination: CursorPagination = Depends(get_cursor_pagination),
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    try:
        all_conditions = parse_filter_conditions(filters_all)
        any_conditions = parse_filter_conditions(filters_any)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    users = admin_users.search_users_cursor(
        db,
        tenant_id=admin.tenant_id,
        limit=pagination.limit,
        cursor=pagination.cursor,
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
    return build_cursor_response(
        users,
        limit=pagination.limit,
        id_attr="id",
        serializer=lambda user: _serialize_user_list_item(user, selected_fields).model_dump(mode="json"),
    )


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


@router.get("/sidebar-tabs", response_model=list[SidebarTabSchema])
def list_sidebar_tabs(
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    return admin_modules.list_sidebar_tabs(db, tenant_id=admin.tenant_id)


@router.post("/sidebar-tabs", response_model=SidebarTabSchema, status_code=201)
def create_sidebar_tab(
    payload: SidebarTabCreateRequest,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    return admin_modules.create_sidebar_tab(db, tenant_id=admin.tenant_id, payload=payload)


@router.put("/sidebar-tabs/{tab_key}", response_model=SidebarTabSchema)
def update_sidebar_tab(
    tab_key: str,
    payload: SidebarTabUpdateRequest,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    return admin_modules.update_sidebar_tab(db, tenant_id=admin.tenant_id, tab_key=tab_key, payload=payload)


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
    role = role_permissions.create_role(db, payload, tenant_id=admin.tenant_id)
    admin_users.invalidate_user_update_options_cache(admin.tenant_id)
    return role


@router.put("/roles/{role_id}", response_model=RoleSchema)
def update_role(
    role_id: int,
    payload: RoleUpdateRequest,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    role = role_permissions.update_role(db, role_id, payload, tenant_id=admin.tenant_id)
    admin_users.invalidate_user_update_options_cache(admin.tenant_id)
    return role


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
    team = admin_structure.create_team(db, payload, tenant_id=admin.tenant_id)
    admin_users.invalidate_user_update_options_cache(admin.tenant_id)
    return team


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
    team = admin_structure.update_team(db, team_id, payload, tenant_id=admin.tenant_id)
    admin_users.invalidate_user_update_options_cache(admin.tenant_id)
    return team


@router.delete("/teams/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_team(
    team_id: int,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    admin_structure.delete_team(db, team_id, tenant_id=admin.tenant_id)
    admin_users.invalidate_user_update_options_cache(admin.tenant_id)


@router.get("/mfa-policy", response_model=TenantMfaPolicyResponse)
def get_mfa_policy(
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return TenantMfaPolicyResponse(policy=get_tenant_mfa_policy(db, tenant_id=admin.tenant_id))


@router.put("/mfa-policy", response_model=TenantMfaPolicyResponse)
def update_mfa_policy(
    payload: TenantMfaPolicyRequest,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    policy = update_tenant_mfa_policy(
        db,
        tenant_id=admin.tenant_id,
        actor_user_id=admin.id,
        policy=payload.policy.value,
    )
    return TenantMfaPolicyResponse(policy=policy)


@router.post("/{user_id}/mfa-reset", response_model=AdminMfaResetResponse)
def reset_user_mfa(
    user_id: int,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    admin_reset_user_mfa(
        db,
        tenant_id=admin.tenant_id,
        actor_user_id=admin.id,
        user_id=user_id,
    )
    return AdminMfaResetResponse(message="MFA reset")


@router.get("/domains", response_model=list[TenantDomainResponse])
def get_tenant_domains(
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return list_tenant_domains(db, tenant_id=admin.tenant_id)


@router.post("/domains", response_model=TenantDomainResponse, status_code=status.HTTP_201_CREATED)
def add_tenant_domain(
    payload: TenantDomainCreateRequest,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    domain = create_tenant_domain(
        db,
        tenant_id=admin.tenant_id,
        actor_user_id=admin.id,
        hostname=payload.hostname,
        is_primary=payload.is_primary,
    )
    return serialize_tenant_domain(domain)


@router.post("/domains/{domain_id}/verify", response_model=TenantDomainResponse)
def verify_custom_domain(
    domain_id: int,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    domain = verify_tenant_domain(db, tenant_id=admin.tenant_id, actor_user_id=admin.id, domain_id=domain_id)
    return serialize_tenant_domain(domain)


@router.delete("/domains/{domain_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_tenant_domain(
    domain_id: int,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    delete_tenant_domain(db, tenant_id=admin.tenant_id, actor_user_id=admin.id, domain_id=domain_id)


@router.get("/sso-settings", response_model=TenantSsoSettingsResponse)
def get_sso_settings(
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return serialize_sso_settings(get_or_create_sso_settings(db, tenant_id=admin.tenant_id))


@router.put("/sso-settings", response_model=TenantSsoSettingsResponse)
def update_tenant_sso_settings(
    payload: TenantSsoSettingsUpdateRequest,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    settings_row = update_sso_settings(
        db,
        tenant_id=admin.tenant_id,
        actor_user_id=admin.id,
        payload=payload.model_dump(exclude_unset=True),
    )
    return serialize_sso_settings(settings_row)


@router.post("/sso-settings/test", response_model=TenantSsoTestResponse)
def test_tenant_sso_settings(
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return test_sso_settings(
        db,
        tenant_id=admin.tenant_id,
        actor_user_id=admin.id,
    )


@router.put("/{user_id}", response_model=UserProfile)
def update_user(
    user_id: int,
    payload: UpdateUserRequest,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return admin_users.serialize_user_profile(
        admin_users.update_user(db, user_id, payload, tenant_id=admin.tenant_id)
    )
