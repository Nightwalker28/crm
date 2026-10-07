"""Dependent picklists (13b §3.6, F3.6).

A controlling picklist field limits the values of a dependent one on the same module: *Deal
type* → *Lost reason*, a custom *Product line* → *Model*. Salesforce's rules: a controlling
value missing from the map allows no dependent value, and an empty controlling field leaves
the dependent empty. A field has at most one controlling field and chains do not loop.

Both fields are picklists: a standard field bound in `PICKLIST_BINDINGS`, or a custom field
(`custom:<key>`) of type picklist; the dependent may also be a multi-select picklist.
Country → state is not stored here: it is built in (`picklists.normalize_address_states`).

Checked on user writes, next to the field rules (13b §5 decision 9): system writes copy
values from records that were already checked.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.modules.platform.models import FieldDefinition, Picklist, PicklistDependency
from app.modules.platform.services.activity_logs import safe_log_activity
from app.modules.platform.services.custom_fields import load_custom_field_values
from app.modules.platform.services.picklists import PICKLIST_MODULE_KEY, bindings_for_module, get_picklist


CUSTOM_PREFIX = "custom:"


@dataclass(frozen=True)
class PicklistFieldRef:
    field_key: str
    label: str
    list_key: str
    multiple: bool = False

    @property
    def custom_key(self) -> str | None:
        return self.field_key.removeprefix(CUSTOM_PREFIX) if self.field_key.startswith(CUSTOM_PREFIX) else None


def _error(field_key: str | None, message: str) -> HTTPException:
    if field_key:
        return HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=[{"loc": ["body", field_key], "msg": message, "type": "domain"}],
        )
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=message)


def picklist_fields(db: Session, *, tenant_id: int, module_key: str) -> dict[str, PicklistFieldRef]:
    """Every picklist field of a module that can take part in a dependency."""

    fields = {
        field_key: PicklistFieldRef(field_key, binding.label, binding.list_key)
        for field_key, binding in bindings_for_module(module_key).items()
    }
    definitions = (
        db.query(FieldDefinition, Picklist.key)
        .join(Picklist, Picklist.id == FieldDefinition.picklist_id)
        .filter(
            FieldDefinition.tenant_id == tenant_id,
            FieldDefinition.module_key == module_key,
            FieldDefinition.is_active.is_(True),
            FieldDefinition.field_type.in_(("picklist", "multi_picklist")),
        )
        .all()
    )
    for definition, list_key in definitions:
        field_key = f"{CUSTOM_PREFIX}{definition.field_key}"
        fields[field_key] = PicklistFieldRef(
            field_key, definition.label, list_key, multiple=definition.field_type == "multi_picklist"
        )
    return fields


def list_dependencies(db: Session, *, tenant_id: int, module_key: str) -> list[PicklistDependency]:
    return (
        db.query(PicklistDependency)
        .filter(PicklistDependency.tenant_id == tenant_id, PicklistDependency.module_key == module_key)
        .order_by(PicklistDependency.id.asc())
        .all()
    )


def serialize_dependency(dependency: PicklistDependency) -> dict[str, Any]:
    return {
        "id": dependency.id,
        "module_key": dependency.module_key,
        "controlling_field_key": dependency.controlling_field_key,
        "dependent_field_key": dependency.dependent_field_key,
        "value_map": dependency.value_map or {},
    }


def _get(db: Session, tenant_id: int, module_key: str, dependent_field_key: str) -> PicklistDependency | None:
    return (
        db.query(PicklistDependency)
        .filter(
            PicklistDependency.tenant_id == tenant_id,
            PicklistDependency.module_key == module_key,
            PicklistDependency.dependent_field_key == dependent_field_key,
        )
        .first()
    )


def save_dependency(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    dependent_field_key: str,
    controlling_field_key: str,
    value_map: dict[str, list[str]],
    actor_user_id: int | None,
) -> PicklistDependency:
    """Creates or replaces the dependency of one field. Validates before anything is set."""

    fields = picklist_fields(db, tenant_id=tenant_id, module_key=module_key)
    dependent = fields.get(dependent_field_key)
    controlling = fields.get(controlling_field_key)
    if dependent is None:
        raise _error("dependent_field_key", "Choose a picklist field of this module.")
    if controlling is None:
        raise _error("controlling_field_key", "Choose a picklist field of this module.")
    if controlling.multiple:
        raise _error("controlling_field_key", "A multi-select picklist cannot control another field.")
    if controlling_field_key == dependent_field_key:
        raise _error("controlling_field_key", "A field cannot control itself.")

    existing = list_dependencies(db, tenant_id=tenant_id, module_key=module_key)
    controller_of = {item.dependent_field_key: item.controlling_field_key for item in existing}
    controller_of[dependent_field_key] = controlling_field_key
    seen = {dependent_field_key}
    cursor = controlling_field_key
    while cursor in controller_of:
        if cursor in seen:
            raise _error("controlling_field_key", "These fields already depend on each other the other way round.")
        seen.add(cursor)
        cursor = controller_of[cursor]
    if cursor in seen:
        raise _error("controlling_field_key", "These fields already depend on each other the other way round.")

    controlling_keys = {value.key for value in get_picklist(db, tenant_id, controlling.list_key).values}
    dependent_keys = {value.key for value in get_picklist(db, tenant_id, dependent.list_key).values}
    cleaned: dict[str, list[str]] = {}
    for controlling_key, allowed in (value_map or {}).items():
        if controlling_key not in controlling_keys:
            raise _error("value_map", f"“{controlling_key}” is not a value of {controlling.label}.")
        unknown = sorted(set(allowed or []) - dependent_keys)
        if unknown:
            raise _error("value_map", f"Not values of {dependent.label}: {', '.join(unknown)}.")
        # Kept in the dependent list's order, de-duplicated.
        cleaned[controlling_key] = [key for key in dict.fromkeys(allowed or [])]

    dependency = _get(db, tenant_id, module_key, dependent_field_key)
    action = "update" if dependency is not None else "create"
    if dependency is None:
        dependency = PicklistDependency(tenant_id=tenant_id, module_key=module_key, dependent_field_key=dependent_field_key)
        db.add(dependency)
    dependency.controlling_field_key = controlling_field_key
    dependency.value_map = cleaned
    db.flush()
    safe_log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key=PICKLIST_MODULE_KEY,
        entity_type="picklist_dependency",
        entity_id=dependency.id,
        action=action,
        description=f"{controlling.label} now controls {dependent.label}",
        after_state=serialize_dependency(dependency),
        commit=False,
    )
    return dependency


def delete_dependency(db: Session, *, tenant_id: int, module_key: str, dependent_field_key: str, actor_user_id: int | None) -> None:
    dependency = _get(db, tenant_id, module_key, dependent_field_key)
    if dependency is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This field has no controlling field.")
    before = serialize_dependency(dependency)
    db.delete(dependency)
    db.flush()
    safe_log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key=PICKLIST_MODULE_KEY,
        entity_type="picklist_dependency",
        entity_id=before["id"],
        action="delete",
        description=f"Removed the controlling field of {dependent_field_key}",
        before_state=before,
        commit=False,
    )


def rewrite_merged_value(db: Session, *, tenant_id: int, list_key: str, from_key: str, into_key: str) -> int:
    """After a picklist merge, moves the merged value's place in every map that uses the list."""

    changed = 0
    for dependency in db.query(PicklistDependency).filter(PicklistDependency.tenant_id == tenant_id).all():
        fields = picklist_fields(db, tenant_id=tenant_id, module_key=dependency.module_key)
        controlling = fields.get(dependency.controlling_field_key)
        dependent = fields.get(dependency.dependent_field_key)
        value_map = {key: list(values) for key, values in (dependency.value_map or {}).items()}
        touched = False
        if controlling is not None and controlling.list_key == list_key and from_key in value_map:
            moved = value_map.pop(from_key)
            value_map[into_key] = list(dict.fromkeys([*value_map.get(into_key, []), *moved]))
            touched = True
        if dependent is not None and dependent.list_key == list_key:
            for key, values in value_map.items():
                if from_key in values:
                    value_map[key] = list(dict.fromkeys(into_key if value == from_key else value for value in values))
                    touched = True
        if touched:
            dependency.value_map = value_map
            changed += 1
    if changed:
        db.flush()
    return changed


# --- enforcement ---------------------------------------------------------------------


def _as_key(db: Session, tenant_id: int, list_key: str, raw: Any, cache: dict[str, Any]) -> str | None:
    """A submitted value as its key: matched on key, then label. Unknown text is returned as
    it is; the picklist check refuses it later with its own message."""

    if raw is None:
        return None
    text = " ".join(str(raw).split())
    if not text:
        return None
    if list_key not in cache:
        cache[list_key] = get_picklist(db, tenant_id, list_key)
    folded = text.casefold()
    for value in cache[list_key].values:
        if value.key == text or value.key.casefold() == folded or value.label.casefold() == folded:
            return value.key
    return text


def enforce_picklist_dependencies(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    payload: dict,
    existing: Any | None = None,
    record_id: int | None = None,
) -> dict:
    """Refuses a dependent value its controlling value does not allow. Returns the payload.

    Runs when either field of a dependency is written; the other side comes from the record.
    """

    dependencies = list_dependencies(db, tenant_id=tenant_id, module_key=module_key)
    if not dependencies:
        return payload
    fields = picklist_fields(db, tenant_id=tenant_id, module_key=module_key)
    submitted_custom = payload.get("custom_fields") if isinstance(payload.get("custom_fields"), dict) else {}
    stored_custom: dict[str, Any] | None = None
    lists: dict[str, Any] = {}

    def submitted(ref: PicklistFieldRef) -> tuple[bool, Any]:
        if ref.custom_key is not None:
            return (ref.custom_key in submitted_custom, submitted_custom.get(ref.custom_key))
        return (ref.field_key in payload, payload.get(ref.field_key))

    def stored(ref: PicklistFieldRef) -> Any:
        nonlocal stored_custom
        if ref.custom_key is None:
            return getattr(existing, ref.field_key, None) if existing is not None else None
        if record_id is None:
            return None
        if stored_custom is None:
            stored_custom = load_custom_field_values(db, tenant_id=tenant_id, module_key=module_key, record_id=record_id)
        return stored_custom.get(ref.custom_key)

    for dependency in dependencies:
        controlling = fields.get(dependency.controlling_field_key)
        dependent = fields.get(dependency.dependent_field_key)
        if controlling is None or dependent is None:
            continue  # a field was retired or switched off; the map waits for it
        controlling_sent, controlling_raw = submitted(controlling)
        dependent_sent, dependent_raw = submitted(dependent)
        if not controlling_sent and not dependent_sent:
            continue
        controlling_value = _as_key(
            db, tenant_id, controlling.list_key, controlling_raw if controlling_sent else stored(controlling), lists
        )
        raw_dependent = dependent_raw if dependent_sent else stored(dependent)
        if dependent.multiple:
            raw_values = raw_dependent if isinstance(raw_dependent, list) else ([] if raw_dependent in (None, "") else [raw_dependent])
        else:
            raw_values = [] if raw_dependent in (None, "") else [raw_dependent]
        dependent_values = [key for key in (_as_key(db, tenant_id, dependent.list_key, raw, lists) for raw in raw_values) if key]
        if not dependent_values:
            continue
        error_key = dependent.field_key if dependent_sent else controlling.field_key
        if controlling_value is None:
            raise _error(error_key, f"Choose {controlling.label.lower()} before {dependent.label.lower()}.")
        allowed = set((dependency.value_map or {}).get(controlling_value, []))
        refused = [key for key in dependent_values if key not in allowed]
        if refused:
            dependent_list = lists.get(dependent.list_key) or get_picklist(db, tenant_id, dependent.list_key)
            labels = {value.key: value.label for value in dependent_list.values}
            names = ", ".join(f"“{labels.get(key, key)}”" for key in refused)
            controlling_list = lists.get(controlling.list_key) or get_picklist(db, tenant_id, controlling.list_key)
            controlling_label = next(
                (value.label for value in controlling_list.values if value.key == controlling_value), controlling_value
            )
            raise _error(
                error_key,
                f"{names} cannot be used as {dependent.label.lower()} when {controlling.label.lower()} is “{controlling_label}”.",
            )
    return payload
