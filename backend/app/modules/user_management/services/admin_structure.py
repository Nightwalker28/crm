from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.modules.user_management.models import Department, DepartmentModulePermission, Team, TeamModulePermission, User
from app.modules.user_management.schema import (
    DepartmentCreateRequest,
    DepartmentUpdateRequest,
    TeamCreateRequest,
    TeamUpdateRequest,
)


def _sync_team_module_permissions_from_department(db: Session, team: Team) -> None:
    desired_module_ids: set[int] = set()
    if team.department_id:
        desired_module_ids = {
            module_id
            for (module_id,) in (
                db.query(DepartmentModulePermission.module_id)
                .filter(DepartmentModulePermission.department_id == team.department_id)
                .all()
            )
        }

    existing_permissions = (
        db.query(TeamModulePermission)
        .filter(TeamModulePermission.team_id == team.id)
        .all()
    )
    existing_by_module_id: dict[int, TeamModulePermission] = {}
    permission_ids_to_delete: list[int] = []
    for permission in existing_permissions:
        if permission.module_id in existing_by_module_id:
            permission_ids_to_delete.append(permission.id)
            continue
        existing_by_module_id[permission.module_id] = permission

    for module_id, permission in existing_by_module_id.items():
        if module_id not in desired_module_ids:
            permission_ids_to_delete.append(permission.id)

    if permission_ids_to_delete:
        (
            db.query(TeamModulePermission)
            .filter(TeamModulePermission.id.in_(permission_ids_to_delete))
            .delete(synchronize_session=False)
        )

    existing_module_ids = set(existing_by_module_id)
    for module_id in desired_module_ids - existing_module_ids:
        db.add(TeamModulePermission(team_id=team.id, module_id=module_id))


def create_department(db: Session, payload: DepartmentCreateRequest, *, tenant_id: int) -> Department:
    existing_department = db.query(Department).filter(Department.tenant_id == tenant_id, Department.name == payload.name).first()
    if existing_department:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Department already exists")

    department = Department(tenant_id=tenant_id, **payload.model_dump())
    db.add(department)
    db.commit()
    db.refresh(department)
    return department


def list_departments(db: Session, *, tenant_id: int) -> list[Department]:
    return db.query(Department).filter(Department.tenant_id == tenant_id).order_by(Department.name.asc()).all()


def update_department(db: Session, department_id: int, payload: DepartmentUpdateRequest, *, tenant_id: int) -> Department:
    department = db.query(Department).filter(Department.id == department_id, Department.tenant_id == tenant_id).first()
    if not department:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")

    update_data = payload.model_dump(exclude_unset=True)
    if "name" in update_data:
        duplicate = (
            db.query(Department)
            .filter(Department.tenant_id == tenant_id, Department.name == update_data["name"], Department.id != department_id)
            .first()
        )
        if duplicate:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Department name already in use")

    for field, value in update_data.items():
        setattr(department, field, value)

    db.add(department)
    db.commit()
    db.refresh(department)
    return department


def delete_department(db: Session, department_id: int, *, tenant_id: int) -> None:
    department = db.query(Department).filter(Department.id == department_id, Department.tenant_id == tenant_id).first()
    if not department:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")

    team_count = db.query(Team).filter(Team.tenant_id == tenant_id, Team.department_id == department_id).count()
    if team_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete a department that still has teams assigned",
        )

    db.delete(department)
    db.commit()


def create_team(db: Session, payload: TeamCreateRequest, *, tenant_id: int) -> Team:
    department = db.query(Department).filter(Department.id == payload.department_id, Department.tenant_id == tenant_id).first()
    if not department:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")

    existing_team = db.query(Team).filter(Team.tenant_id == tenant_id, Team.name == payload.name).first()
    if existing_team:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Team already exists")

    team = Team(tenant_id=tenant_id, **payload.model_dump())
    db.add(team)
    db.flush()
    _sync_team_module_permissions_from_department(db, team)
    db.commit()
    db.refresh(team)
    return team


def list_teams(db: Session, *, tenant_id: int) -> list[Team]:
    return db.query(Team).filter(Team.tenant_id == tenant_id).order_by(Team.name.asc()).all()


def update_team(db: Session, team_id: int, payload: TeamUpdateRequest, *, tenant_id: int) -> Team:
    team = db.query(Team).filter(Team.id == team_id, Team.tenant_id == tenant_id).first()
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

    update_data = payload.model_dump(exclude_unset=True)

    if "department_id" in update_data and update_data["department_id"] is not None:
        department = db.query(Department).filter(Department.id == update_data["department_id"], Department.tenant_id == tenant_id).first()
        if not department:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")

    if "name" in update_data:
        duplicate = (
            db.query(Team)
            .filter(Team.tenant_id == tenant_id, Team.name == update_data["name"], Team.id != team_id)
            .first()
        )
        if duplicate:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Team name already in use")

    for field, value in update_data.items():
        setattr(team, field, value)

    db.add(team)
    if "department_id" in update_data:
        _sync_team_module_permissions_from_department(db, team)
    db.commit()
    db.refresh(team)
    return team


def delete_team(db: Session, team_id: int, *, tenant_id: int) -> None:
    team = db.query(Team).filter(Team.id == team_id, Team.tenant_id == tenant_id).first()
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

    db.query(User).filter(User.tenant_id == tenant_id, User.team_id == team_id).update({User.team_id: None})

    db.delete(team)
    db.commit()
