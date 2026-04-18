from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.modules.user_management.models import Module
from app.modules.user_management.schema import ModuleUpdateRequest
from app.core.duplicates import DuplicateMode


def list_modules(db: Session) -> list[Module]:
    return db.query(Module).order_by(Module.name.asc()).all()


def update_module(db: Session, module_id: int, payload: ModuleUpdateRequest) -> Module:
    module = db.query(Module).filter(Module.id == module_id).first()
    if not module:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Module not found")

    update_data = payload.model_dump(exclude_unset=True)
    if "name" in update_data and update_data["name"]:
        duplicate = (
            db.query(Module)
            .filter(Module.name == update_data["name"].strip(), Module.id != module_id)
            .first()
        )
        if duplicate:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Module name already exists")

    for field, value in update_data.items():
        if field == "import_duplicate_mode" and value is not None:
            try:
                value = DuplicateMode(value).value
            except ValueError as exc:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid duplicate mode") from exc
        if isinstance(value, str):
            value = value.strip() or None
        setattr(module, field, value)

    db.add(module)
    db.commit()
    db.refresh(module)
    return module


def get_module_duplicate_mode(db: Session, module_name: str) -> str:
    module = db.query(Module).filter(Module.name == module_name).first()
    if not module:
        return DuplicateMode.skip.value
    value = (module.import_duplicate_mode or DuplicateMode.skip.value).strip().lower()
    try:
        return DuplicateMode(value).value
    except ValueError:
        return DuplicateMode.skip.value
