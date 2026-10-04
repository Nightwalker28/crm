from collections.abc import Iterable

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


# One way to ask "may this user do X in module Y" outside a route's dependencies (13a B6).
# Routes guard their own module with `require_module_access` + `require_action_access`; a
# second module the route touches, or a part of a response that depends on one, goes through
# these. They check all three layers, as the dependencies do.


def can_access(db: Session, user, module_key: str, *actions: str) -> bool:
    """Module enabled, available to the user's team, and each action (default `view`) granted."""
    return PermissionPolicy(db, user).can(module_key, *actions)


def can_access_any(db: Session, user, grants: Iterable[tuple[str, str]]) -> bool:
    policy = PermissionPolicy(db, user)
    return any(policy.can(module_key, action) for module_key, action in grants)


def require_access(db: Session, user, module_key: str, *actions: str, detail: str) -> None:
    """`can_access` or a 403 carrying `detail`, which names what the user cannot do."""
    if not can_access(db, user, module_key, *actions):
        raise HTTPException(status_code=403, detail=detail)


def require_any_access(db: Session, user, grants: Iterable[tuple[str, str]], *, detail: str) -> None:
    if not can_access_any(db, user, grants):
        raise HTTPException(status_code=403, detail=detail)

