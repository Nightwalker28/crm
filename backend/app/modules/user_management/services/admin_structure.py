from fastapi import HTTPException, status
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.modules.user_management.models import Department, DepartmentModulePermission, Team, TeamModulePermission, User
from app.modules.user_management.schema import (
    DepartmentCreateRequest,
    DepartmentUpdateRequest,
    TeamCreateRequest,
    TeamUpdateRequest,
)


def _sync_pk_sequence(db: Session, model, sequence_name: str) -> None:
    """Ensure Postgres sequence is at least the current max(id) for the model."""
    max_id = db.query(func.coalesce(func.max(model.id), 0)).scalar()
    seq_state = db.execute(text(f"SELECT last_value, is_called FROM {sequence_name}")).first()

    if not seq_state:
        return

    current_value = seq_state.last_value if seq_state.is_called else 0

    if max_id == 0 and current_value == 0:
        db.execute(text(f"SELECT setval('{sequence_name}', 1, false)"))
    elif max_id >= current_value:
        db.execute(text(f"SELECT setval('{sequence_name}', :value, true)"), {"value": max_id})


def _sync_team_module_permissions_from_department(db: Session, team: Team) -> None:
    if not team.department_id:
        db.query(TeamModulePermission).filter(TeamModulePermission.team_id == team.id).delete()
        return

    department_module_ids = [
        module_id
        for (module_id,) in (
            db.query(DepartmentModulePermission.module_id)
            .filter(DepartmentModulePermission.department_id == team.department_id)
            .all()
        )
    ]

    db.query(TeamModulePermission).filter(TeamModulePermission.team_id == team.id).delete()
    for module_id in department_module_ids:
        db.add(TeamModulePermission(team_id=team.id, module_id=module_id))


def create_department(db: Session, payload: DepartmentCreateRequest, *, tenant_id: int) -> Department:
    _sync_pk_sequence(db, Department, "departments_id_seq")

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
    _sync_pk_sequence(db, Team, "teams_id_seq")

    department = db.query(Department).filter(Department.id == payload.department_id, Department.tenant_id == tenant_id).first()
    if not department:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")

    existing_team = db.query(Team).filter(Team.tenant_id == tenant_id, Team.name == payload.name).first()
    if existing_team:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Team already exists")

    team = Team(tenant_id=tenant_id, **payload.model_dump())
    db.add(team)
    db.commit()
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
    db.commit()
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
