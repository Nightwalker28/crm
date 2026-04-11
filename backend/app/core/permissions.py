from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_
from app.core.database import get_db
from app.core.security import require_user
from app.modules.user_management.models import (
    Module,
    DepartmentModulePermission,
    Team,
)

def require_module_access(module_key: str):
    def checker(
        current_user=Depends(require_user),
        db: Session = Depends(get_db),
    ):
        # Look up module by stable key (name or base_route)
        module = (
            db.query(Module)
            .filter(or_(Module.name == module_key, Module.base_route == module_key))
            .first()
        )
        if not module:
            raise HTTPException(status_code=500, detail="module not found")

        # Resolve user's department via their team (department is the permission scope)
        department_id = None
        if current_user.team_id:
            department_id = (
                db.query(Team.department_id)
                .filter(Team.id == current_user.team_id)
                .scalar()
            )

        if not department_id:
            raise HTTPException(status_code=403, detail="User is not assigned to a department")

        # Ensure the user's department is allowed to access this module
        allowed = (
            db.query(DepartmentModulePermission)
            .filter_by(department_id=department_id, module_id=module.id)
            .first()
        )

        if not allowed:
            raise HTTPException(status_code=403, detail="Access to this module is forbidden")
        return current_user

    return checker

        
