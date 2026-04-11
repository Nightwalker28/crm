from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, text, case, func
from sqlalchemy.orm import Session, selectinload, joinedload
from app.core.database import get_db
from app.core.postgres_search import apply_trigram_search, searchable_text
from app.core.security import require_admin
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.modules.user_management.models import Department, Role, Team, User, UserStatus
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
from typing import Optional

router = APIRouter(prefix="/admin/users", tags=["Admin Users"])


def _sync_pk_sequence(db: Session, model, sequence_name: str):
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

@router.get("", response_model=UserListResponse)
def list_all_users(
    pagination: Pagination = Depends(get_pagination), 
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    query = (
        db.query(User)
        .options(joinedload(User.team), selectinload(User.role))
        .outerjoin(Team)
    )

    UNASSIGNED_LABEL = "Action Required"

    # --- PRIORITY SORT LOGIC ---
    # Rank 0: Inactive + No Role + No Team
    attention_sort = case(
        (
            (User.is_active == UserStatus.pending) &
            (User.role_id.is_(None)) & 
            (User.team_id.is_(None)), 
            0
        ),
        else_=1
    )

    team_sort = func.coalesce(Team.name, UNASSIGNED_LABEL)
    
    query = query.order_by(
        attention_sort.asc(), 
        team_sort.asc(), 
        User.first_name.asc(), 
        User.id.asc()
    )

    total_count = query.count()
    items = query.offset(pagination.offset).limit(pagination.limit).all()

    # --- SERIALIZATION ---
    serialized = []
    for u in items:
        profile = UserProfile.model_validate(u)
        
        # Inject "Action Required" for missing team
        if not profile.team_name: 
            profile.team_name = UNASSIGNED_LABEL
        
        # ADDED: Inject "Unassigned" for missing role
        if not profile.role_name:
            profile.role_name = "Unassigned"
            
        serialized.append(profile)
    
    return build_paged_response(serialized, total_count, pagination)

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
    query = (
        db.query(User)
        .options(joinedload(User.team), selectinload(User.role))
        .outerjoin(Team)
    )

    UNASSIGNED_LABEL = "Action Required"

    # --- APPLY FILTERS ---
    if q:
        document = searchable_text(User.first_name, User.last_name, User.email)
        query, rank = apply_trigram_search(query, search=q, document=document)
    else:
        rank = None

    if teams and teams.lower() != "all":
        try:
            ids = [int(x) for x in teams.split(",") if x.strip().isdigit()]
            if ids: query = query.filter(User.team_id.in_(ids))
        except ValueError: pass

    if roles and roles.lower() != "all":
        try:
            ids = [int(x) for x in roles.split(",") if x.strip().isdigit()]
            if ids: query = query.filter(User.role_id.in_(ids))
        except ValueError: pass

    if status:
        raw_statuses = [s.strip().lower() for s in status.split(",") if s.strip()]

        valid_statuses = []
        for s in raw_statuses:
            try:
                valid_statuses.append(UserStatus(s))
            except ValueError:
                pass  # ignore invalid values

        if valid_statuses:
            query = query.filter(User.is_active.in_(valid_statuses))


    # --- PRIORITY SORT LOGIC ---
    attention_sort = case(
        (
            (User.is_active == UserStatus.pending) & 
            (User.role_id.is_(None)) & 
            (User.team_id.is_(None)), 
            0
        ),
        else_=1
    )

    # --- APPLY SORTING ---
    team_sort = func.coalesce(Team.name, UNASSIGNED_LABEL)

    if sort_by == "email":
        user_sort = User.email
    elif sort_by == "role":
        query = query.outerjoin(Role)
        user_sort = Role.name
    elif sort_by == "status":
        user_sort = User.is_active
    else:
        user_sort = User.first_name 

    if rank is not None:
        if sort_order == "desc":
            query = query.order_by(attention_sort.asc(), team_sort.asc(), rank.asc(), User.id.desc())
        else:
            query = query.order_by(attention_sort.asc(), team_sort.asc(), rank.desc(), User.id.asc())
    elif sort_order == "desc":
        query = query.order_by(attention_sort.asc(), team_sort.asc(), user_sort.desc(), User.id.desc())
    else:
        query = query.order_by(attention_sort.asc(), team_sort.asc(), user_sort.asc(), User.id.asc())

    total_count = query.count()
    items = query.offset(pagination.offset).limit(pagination.limit).all()

    # --- SERIALIZATION ---
    serialized = []
    for u in items:
        profile = UserProfile.model_validate(u)
        
        if not profile.team_name: 
            profile.team_name = UNASSIGNED_LABEL
            
        # ADDED: Inject "Unassigned" for missing role
        if not profile.role_name:
            profile.role_name = "Unassigned"
            
        serialized.append(profile)
    
    return build_paged_response(serialized, total_count, pagination)

@router.get("/options", response_model=UserUpdateOptions)
def list_user_update_options(
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    roles = db.query(Role).order_by(Role.name.asc()).all()
    teams = db.query(Team).order_by(Team.name.asc()).all()
    
    statuses = [s.value for s in UserStatus]
    return UserUpdateOptions(roles=roles, teams=teams, statuses=statuses)

@router.post("/departments", response_model=DepartmentSchema, status_code=status.HTTP_201_CREATED)
def create_department(
    payload: DepartmentCreateRequest,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    _sync_pk_sequence(db, Department, "departments_id_seq")

    existing_department = db.query(Department).filter(Department.name == payload.name).first()
    if existing_department:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Department already exists")

    department = Department(**payload.model_dump())
    db.add(department)
    db.commit()
    db.refresh(department)
    return department


@router.get("/departments", response_model=list[DepartmentSchema])
def list_departments(
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return db.query(Department).order_by(Department.name.asc()).all()


@router.put("/departments/{department_id}", response_model=DepartmentSchema)
def update_department(
    department_id: int,
    payload: DepartmentUpdateRequest,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    department = db.query(Department).filter(Department.id == department_id).first()
    if not department:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")

    update_data = payload.model_dump(exclude_unset=True)
    if "name" in update_data:
        duplicate = (
            db.query(Department)
            .filter(Department.name == update_data["name"], Department.id != department_id)
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


@router.delete("/departments/{department_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_department(
    department_id: int,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    department = db.query(Department).filter(Department.id == department_id).first()
    if not department:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")

    team_count = db.query(Team).filter(Team.department_id == department_id).count()
    if team_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete a department that still has teams assigned",
        )

    db.delete(department)
    db.commit()


@router.post("/teams", response_model=TeamSchema, status_code=status.HTTP_201_CREATED)
def create_team(
    payload: TeamCreateRequest,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    _sync_pk_sequence(db, Team, "teams_id_seq")

    department = db.query(Department).filter(Department.id == payload.department_id).first()
    if not department:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")

    existing_team = db.query(Team).filter(Team.name == payload.name).first()
    if existing_team:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Team already exists")

    team = Team(**payload.model_dump())
    db.add(team)
    db.commit()
    db.refresh(team)
    return team


@router.get("/teams", response_model=list[TeamSchema])
def list_teams(
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    return db.query(Team).order_by(Team.name.asc()).all()


@router.put("/teams/{team_id}", response_model=TeamSchema)
def update_team(
    team_id: int,
    payload: TeamUpdateRequest,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

    update_data = payload.model_dump(exclude_unset=True)

    if "department_id" in update_data and update_data["department_id"] is not None:
        department = db.query(Department).filter(Department.id == update_data["department_id"]).first()
        if not department:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")

    if "name" in update_data:
        duplicate = (
            db.query(Team)
            .filter(Team.name == update_data["name"], Team.id != team_id)
            .first()
        )
        if duplicate:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Team name already in use")

    for field, value in update_data.items():
        setattr(team, field, value)

    db.add(team)
    db.commit()
    db.refresh(team)
    return team


@router.delete("/teams/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_team(
    team_id: int,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

    db.query(User).filter(User.team_id == team_id).update({User.team_id: None})

    db.delete(team)
    db.commit()

@router.get("/pending", response_model=list[UserProfile])
def list_pending_users(
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    users = (
        db.query(User)
        .options(selectinload(User.team), selectinload(User.role))
        .filter(User.is_active == UserStatus.pending)
        .offset(offset)
        .limit(limit)
        .all()
    )
    return users

@router.put("/{user_id}", response_model=UserProfile)
def update_user(
    user_id: int,
    payload: UpdateUserRequest,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(user, field, value)

    db.add(user)
    db.commit()
    db.refresh(user)
    return user

@router.post("/approve/{user_id}")
def approve_user(
    user_id: int,
    payload: ApproveUserRequest,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user.role_id = payload.role_id
    user.team_id = payload.team_id
    user.is_active = UserStatus.active

    db.commit()
    return {"message": "User approved successfully"}

@router.delete("/pending/{user_id}")
def reject_pending_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user or user.is_active != UserStatus.pending:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pending user not found",
        )

    db.delete(user)
    db.commit()
    return {"message": "Pending user rejected and removed"}
