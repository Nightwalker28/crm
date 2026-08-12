from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.access_control import PermissionPolicy
from app.core.database import get_db
from app.core.security import require_user


def require_department_module_access(db: Session, *, user, module_key: str) -> None:
    PermissionPolicy(db, user).require_module(module_key)


def require_role_module_action_access(db: Session, *, user, module_key: str, action: str) -> None:
    PermissionPolicy(db, user).require_action(module_key, action)


def require_module_access(module_key: str):
    def checker(
        current_user=Depends(require_user),
        db: Session = Depends(get_db),
    ):
        try:
            require_department_module_access(db, user=current_user, module_key=module_key)
        except ValueError:
            raise HTTPException(status_code=500, detail="module not found")
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc))
        
        return current_user

    return checker


def require_linked_record_access(db: Session, *, user, module_key: str) -> None:
    """Guard a relationship a write is about to establish.

    Linking a record exposes it: the linked name, and often its related counts, show up on
    the record that points at it. A contextual create surface can therefore prefill a
    relationship the user is allowed to see, but the id it sends is a hint and never an
    authorization. Creating or editing a record that points at another module requires the
    same module availability and `view` permission as opening that module directly, on top
    of the create/edit permission the route already enforces for its own module.

    Tenant ownership of the linked id stays with the domain service, which is where the
    lookup happens.
    """

    try:
        require_department_module_access(db, user=user, module_key=module_key)
        require_role_module_action_access(db, user=user, module_key=module_key, action="view")
    except ValueError:
        raise HTTPException(status_code=500, detail="module not found")
    except PermissionError:
        raise HTTPException(
            status_code=403,
            detail="You do not have access to the record you are trying to link.",
        )


def require_action_access(module_key: str, action: str):
    def checker(
        current_user=Depends(require_user),
        db: Session = Depends(get_db),
    ):
        try:
            require_role_module_action_access(db, user=current_user, module_key=module_key, action=action)
        except ValueError as exc:
            detail = str(exc)
            if detail in {"module not found", "unknown action"}:
                raise HTTPException(status_code=500, detail=detail)
            raise
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc))

        return current_user

    return checker

        
