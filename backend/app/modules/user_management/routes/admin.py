from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import require_admin
from app.core.pagination import Pagination, get_pagination
from app.modules.user_management.schema import (
    ApproveUserRequest,
    DepartmentCreateRequest,
    DepartmentSchema,
    DepartmentUpdateRequest,
    TeamCreateRequest,
    TeamSchema,
    TeamUpdateRequest,
    UpdateUserRequest,
    UserListResponse,
    UserProfile,
    UserUpdateOptions,
)
from app.modules.user_management.services import admin_structure, admin_users
from typing import Optional

router = APIRouter(prefix="/admin/users", tags=["Admin Users"])

@router.get("", response_model=UserListResponse)
def list_all_users(
    pagination: Pagination = Depends(get_pagination), 
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return admin_users.list_all_users(db, pagination)

@router.get("/search", response_model=UserListResponse)
def search_users(
    q: Optional[str] = Query(None, alias="search"),
    teams: Optional[str] = Query(None),
    roles: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    sort_by: str = Query("name"),
    sort_order: str = Query("asc"),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return admin_users.search_users(
        db,
        pagination=pagination,
        q=q,
        teams=teams,
        roles=roles,
        status_filter=status,
        sort_by=sort_by,
        sort_order=sort_order,
    )

@router.get("/options", response_model=UserUpdateOptions)
def list_user_update_options(
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return admin_users.list_user_update_options(db)

@router.post("/departments", response_model=DepartmentSchema, status_code=status.HTTP_201_CREATED)
def create_department(
    payload: DepartmentCreateRequest,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return admin_structure.create_department(db, payload)


@router.get("/departments", response_model=list[DepartmentSchema])
def list_departments(
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return admin_structure.list_departments(db)


@router.put("/departments/{department_id}", response_model=DepartmentSchema)
def update_department(
    department_id: int,
    payload: DepartmentUpdateRequest,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return admin_structure.update_department(db, department_id, payload)


@router.delete("/departments/{department_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_department(
    department_id: int,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    admin_structure.delete_department(db, department_id)


@router.post("/teams", response_model=TeamSchema, status_code=status.HTTP_201_CREATED)
def create_team(
    payload: TeamCreateRequest,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return admin_structure.create_team(db, payload)


@router.get("/teams", response_model=list[TeamSchema])
def list_teams(
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return admin_structure.list_teams(db)


@router.put("/teams/{team_id}", response_model=TeamSchema)
def update_team(
    team_id: int,
    payload: TeamUpdateRequest,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return admin_structure.update_team(db, team_id, payload)


@router.delete("/teams/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_team(
    team_id: int,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    admin_structure.delete_team(db, team_id)

@router.get("/pending", response_model=list[UserProfile])
def list_pending_users(
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return admin_users.list_pending_users(db, limit=limit, offset=offset)

@router.put("/{user_id}", response_model=UserProfile)
def update_user(
    user_id: int,
    payload: UpdateUserRequest,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return admin_users.update_user(db, user_id, payload)

@router.post("/approve/{user_id}")
def approve_user(
    user_id: int,
    payload: ApproveUserRequest,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return admin_users.approve_user(db, user_id, payload)

@router.delete("/pending/{user_id}")
def reject_pending_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return admin_users.reject_pending_user(db, user_id)
