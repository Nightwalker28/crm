"""Picklist routes (13b §3.1).

Reading a tenant's lists is open to every signed-in user: forms, filters and list cells all
need the values. Changing them is administration, guarded like custom fields.
"""

from typing import Any, Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_admin, require_user
from app.core.unit_of_work import unit_of_work
from app.core.subdivisions import subdivisions
from app.modules.platform.services import picklist_dependencies, picklists

router = APIRouter(prefix="/picklists", tags=["Picklists"])
admin_router = APIRouter(prefix="/admin/picklists", tags=["Picklists"])


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PicklistCreateRequest(_Strict):
    label: str = Field(min_length=1, max_length=150)
    scope: Literal["global", "local"] = "global"


class PicklistUpdateRequest(_Strict):
    label: str = Field(min_length=1, max_length=150)


class PicklistValueCreateRequest(_Strict):
    label: str = Field(min_length=1, max_length=150)
    tone: Literal["neutral", "success", "attention", "critical"] | None = None
    meaning: str | None = None


class PicklistValueUpdateRequest(_Strict):
    label: str | None = Field(default=None, min_length=1, max_length=150)
    tone: Literal["neutral", "success", "attention", "critical"] | None = None
    meaning: str | None = None
    is_active: bool | None = None
    is_default: bool | None = None


class PicklistOrderRequest(_Strict):
    keys: list[str] = Field(min_length=1)


class PicklistMergeRequest(_Strict):
    from_key: str
    into_key: str


class PicklistDependencyRequest(_Strict):
    controlling_field_key: str = Field(min_length=1, max_length=150)
    # Controlling value key → the dependent value keys it allows.
    value_map: dict[str, list[str]] = Field(default_factory=dict)


class PicklistUnmatchedRequest(_Strict):
    value: str = Field(min_length=1)
    into_key: str | None = None


@router.get("")
def list_tenant_picklists(db: Session = Depends(get_db), current_user=Depends(require_user)) -> dict[str, Any]:
    with unit_of_work(db):
        lists = picklists.list_picklists(db, current_user.tenant_id)
        return {"results": [picklists.serialize_picklist(item) for item in lists]}


@admin_router.get("")
def list_picklists_for_admin(db: Session = Depends(get_db), admin=Depends(require_admin)) -> dict[str, Any]:
    with unit_of_work(db):
        lists = picklists.list_picklists(db, admin.tenant_id)
        return {"results": [picklists.serialize_picklist(item) for item in lists]}


@admin_router.post("", status_code=status.HTTP_201_CREATED)
def create_picklist(payload: PicklistCreateRequest, db: Session = Depends(get_db), admin=Depends(require_admin)) -> dict[str, Any]:
    with unit_of_work(db):
        picklist = picklists.create_picklist(db, admin.tenant_id, label=payload.label, scope=payload.scope, actor_user_id=admin.id)
        return picklists.serialize_picklist(picklist)


@admin_router.get("/{key}")
def get_picklist_for_admin(key: str, db: Session = Depends(get_db), admin=Depends(require_admin)) -> dict[str, Any]:
    with unit_of_work(db):
        picklist = picklists.get_picklist(db, admin.tenant_id, key)
        return picklists.serialize_picklist(picklist, include_usage=picklists.usage(db, admin.tenant_id, key))


@admin_router.patch("/{key}")
def update_picklist(key: str, payload: PicklistUpdateRequest, db: Session = Depends(get_db), admin=Depends(require_admin)) -> dict[str, Any]:
    with unit_of_work(db):
        picklist = picklists.get_picklist(db, admin.tenant_id, key)
        picklists.update_picklist(db, picklist, label=payload.label, actor_user_id=admin.id)
        return picklists.serialize_picklist(picklist)


@admin_router.post("/{key}/values", status_code=status.HTTP_201_CREATED)
def add_picklist_value(
    key: str, payload: PicklistValueCreateRequest, db: Session = Depends(get_db), admin=Depends(require_admin)
) -> dict[str, Any]:
    with unit_of_work(db):
        picklist = picklists.get_picklist(db, admin.tenant_id, key)
        picklists.add_value(
            db, admin.tenant_id, picklist, label=payload.label, tone=payload.tone, meaning=payload.meaning, actor_user_id=admin.id
        )
        return picklists.serialize_picklist(picklist)


@admin_router.patch("/{key}/values/{value_key}")
def update_picklist_value(
    key: str, value_key: str, payload: PicklistValueUpdateRequest, db: Session = Depends(get_db), admin=Depends(require_admin)
) -> dict[str, Any]:
    with unit_of_work(db):
        picklist = picklists.get_picklist(db, admin.tenant_id, key)
        picklists.update_value(db, picklist, value_key, payload.model_dump(exclude_unset=True), actor_user_id=admin.id)
        return picklists.serialize_picklist(picklist)


@admin_router.put("/{key}/order")
def reorder_picklist_values(
    key: str, payload: PicklistOrderRequest, db: Session = Depends(get_db), admin=Depends(require_admin)
) -> dict[str, Any]:
    with unit_of_work(db):
        picklist = picklists.get_picklist(db, admin.tenant_id, key)
        picklists.reorder_values(db, picklist, payload.keys, actor_user_id=admin.id)
        return picklists.serialize_picklist(picklists.get_picklist(db, admin.tenant_id, key))


@admin_router.post("/{key}/merge")
def merge_picklist_values(
    key: str, payload: PicklistMergeRequest, db: Session = Depends(get_db), admin=Depends(require_admin)
) -> dict[str, Any]:
    with unit_of_work(db):
        picklist = picklists.get_picklist(db, admin.tenant_id, key)
        counts = picklists.merge_values(db, picklist, from_key=payload.from_key, into_key=payload.into_key, actor_user_id=admin.id)
        return {"picklist": picklists.serialize_picklist(picklist), "moved": counts}


@admin_router.get("/{key}/unmatched")
def list_unmatched_values(key: str, db: Session = Depends(get_db), admin=Depends(require_admin)) -> dict[str, Any]:
    with unit_of_work(db):
        picklist = picklists.get_picklist(db, admin.tenant_id, key)
        return {"results": picklists.unmatched_values(db, picklist)}


@admin_router.post("/{key}/unmatched")
def resolve_unmatched_value(
    key: str, payload: PicklistUnmatchedRequest, db: Session = Depends(get_db), admin=Depends(require_admin)
) -> dict[str, Any]:
    with unit_of_work(db):
        picklist = picklists.get_picklist(db, admin.tenant_id, key)
        moved = picklists.resolve_unmatched(db, picklist, raw=payload.value, into_key=payload.into_key, actor_user_id=admin.id)
        return {"picklist": picklists.serialize_picklist(picklist), "moved": moved}


# --- states and provinces, dependent picklists (13b §3.6) ------------------------------


@router.get("/subdivisions/{country_code}")
def list_subdivisions(country_code: str, current_user=Depends(require_user)) -> dict[str, Any]:
    """A country's states or provinces. Empty for a country whose state stays free text."""
    return {
        "country_code": country_code.upper(),
        "results": [{"code": item.code, "name": item.name, "type": item.type} for item in subdivisions(country_code)],
    }


@router.get("/dependencies/{module_key}")
def list_module_dependencies(module_key: str, db: Session = Depends(get_db), current_user=Depends(require_user)) -> dict[str, Any]:
    """The dependencies a form filters by. Configuration, readable like the lists themselves."""
    with unit_of_work(db):
        items = picklist_dependencies.list_dependencies(db, tenant_id=current_user.tenant_id, module_key=module_key)
        return {"results": [picklist_dependencies.serialize_dependency(item) for item in items]}


@admin_router.get("/dependencies/{module_key}")
def list_module_dependencies_for_admin(module_key: str, db: Session = Depends(get_db), admin=Depends(require_admin)) -> dict[str, Any]:
    with unit_of_work(db):
        items = picklist_dependencies.list_dependencies(db, tenant_id=admin.tenant_id, module_key=module_key)
        fields = picklist_dependencies.picklist_fields(db, tenant_id=admin.tenant_id, module_key=module_key)
        return {
            "results": [picklist_dependencies.serialize_dependency(item) for item in items],
            "fields": [
                {"field_key": ref.field_key, "label": ref.label, "list_key": ref.list_key, "multiple": ref.multiple}
                for ref in fields.values()
            ],
        }


@admin_router.put("/dependencies/{module_key}/{dependent_field_key}")
def save_module_dependency(
    module_key: str,
    dependent_field_key: str,
    payload: PicklistDependencyRequest,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
) -> dict[str, Any]:
    with unit_of_work(db):
        dependency = picklist_dependencies.save_dependency(
            db,
            tenant_id=admin.tenant_id,
            module_key=module_key,
            dependent_field_key=dependent_field_key,
            controlling_field_key=payload.controlling_field_key,
            value_map=payload.value_map,
            actor_user_id=admin.id,
        )
        return picklist_dependencies.serialize_dependency(dependency)


@admin_router.delete("/dependencies/{module_key}/{dependent_field_key}", status_code=status.HTTP_204_NO_CONTENT)
def delete_module_dependency(
    module_key: str, dependent_field_key: str, db: Session = Depends(get_db), admin=Depends(require_admin)
) -> None:
    with unit_of_work(db):
        picklist_dependencies.delete_dependency(
            db, tenant_id=admin.tenant_id, module_key=module_key, dependent_field_key=dependent_field_key, actor_user_id=admin.id
        )
