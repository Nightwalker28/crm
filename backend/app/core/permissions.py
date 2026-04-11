from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.access_control import require_department_module_access
from app.core.database import get_db
from app.core.security import require_user

def require_module_access(module_key: str):
    def checker(
        current_user=Depends(require_user),
        db: Session = Depends(get_db),
    ):
        try:
            require_department_module_access(
                db,
                user=current_user,
                module_key=module_key,
            )
        except ValueError:
            raise HTTPException(status_code=500, detail="module not found")
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc))
        
        return current_user

    return checker

        
