from __future__ import annotations

import logging
from dataclasses import dataclass

from fastapi import HTTPException, status
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.modules.platform.models import RecordLayoutDefinition
from app.modules.platform.record_layout_schema import (
    RecordLayoutDefinitionPayload,
    RecordLayoutFieldDefinition,
    RecordLayoutSectionDefinition,
    RecordLayoutSurface,
    ResolvedRecordLayoutField,
    ResolvedRecordLayoutResponse,
    ResolvedRecordLayoutSection,
)
from app.modules.platform.services.custom_fields import list_custom_field_definitions
from app.modules.platform.services.module_fields import module_field_enabled_map


SUPPORTED_LAYOUT_MODULES = {"sales_leads"}
SUPPORTED_LAYOUT_SURFACES = {"quick_create", "detail"}
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RuntimeFieldDefinition:
    field_key: str
    label: str
    field_type: str
    required: bool = False
    readonly: bool = False
    field_source: str = "system"
    placeholder: str | None = None
    help_text: str | None = None


LEAD_SYSTEM_FIELDS = {
    item.field_key: item
    for item in (
        RuntimeFieldDefinition("first_name", "First name", "text"),
        RuntimeFieldDefinition("last_name", "Last name", "text"),
        RuntimeFieldDefinition("company", "Company", "text"),
        RuntimeFieldDefinition("primary_email", "Email", "email", required=True),
        RuntimeFieldDefinition("phone", "Phone", "phone"),
        RuntimeFieldDefinition("title", "Job title", "text"),
        RuntimeFieldDefinition("source", "Source", "text"),
        RuntimeFieldDefinition("status", "Status", "select"),
        RuntimeFieldDefinition("notes", "Notes", "long_text"),
        RuntimeFieldDefinition("assigned_to", "Owner", "user_reference"),
        RuntimeFieldDefinition("team_id", "Team", "team_reference"),
        RuntimeFieldDefinition("next_follow_up_at", "Next follow-up", "datetime"),
        RuntimeFieldDefinition("tags", "Tags", "tags"),
    )
}


LEAD_LAYOUT_SEEDS: dict[str, RecordLayoutDefinitionPayload] = {
    "quick_create": RecordLayoutDefinitionPayload(
        module_key="sales_leads",
        surface="quick_create",
        name="Lead Quick Create",
        version=1,
        sections=[
            RecordLayoutSectionDefinition(
                id="contact",
                label="Contact",
                position=0,
                region="main",
                fields=[
                    RecordLayoutFieldDefinition(field_key="first_name", position=0, width="half"),
                    RecordLayoutFieldDefinition(field_key="last_name", position=1, width="half"),
                    RecordLayoutFieldDefinition(field_key="company", position=2, width="full"),
                    RecordLayoutFieldDefinition(field_key="primary_email", position=3, width="full"),
                    RecordLayoutFieldDefinition(field_key="phone", position=4, width="half"),
                ],
            ),
            RecordLayoutSectionDefinition(
                id="qualification",
                label="Qualification",
                position=1,
                region="main",
                fields=[
                    RecordLayoutFieldDefinition(field_key="status", position=0, width="half"),
                    RecordLayoutFieldDefinition(field_key="assigned_to", position=1, width="half"),
                ],
            ),
        ],
    ),
    "detail": RecordLayoutDefinitionPayload(
        module_key="sales_leads",
        surface="detail",
        name="Lead Details",
        version=1,
        sections=[
            RecordLayoutSectionDefinition(
                id="contact",
                label="Contact",
                position=0,
                region="main",
                fields=[
                    RecordLayoutFieldDefinition(field_key="primary_email", position=0, width="half"),
                    RecordLayoutFieldDefinition(field_key="phone", position=1, width="half"),
                    RecordLayoutFieldDefinition(field_key="company", position=2, width="half"),
                    RecordLayoutFieldDefinition(field_key="title", position=3, width="half"),
                ],
            ),
            RecordLayoutSectionDefinition(
                id="qualification",
                label="Qualification",
                position=1,
                region="main",
                fields=[
                    RecordLayoutFieldDefinition(field_key="source", position=0, width="half"),
                    RecordLayoutFieldDefinition(field_key="status", position=1, width="half"),
                    RecordLayoutFieldDefinition(field_key="assigned_to", position=2, width="half"),
                    RecordLayoutFieldDefinition(field_key="team_id", position=3, width="half"),
                    RecordLayoutFieldDefinition(field_key="next_follow_up_at", position=4, width="full"),
                    RecordLayoutFieldDefinition(field_key="tags", position=5, width="full"),
                    RecordLayoutFieldDefinition(field_key="notes", position=6, width="full"),
                ],
            ),
        ],
    ),
}


def validate_module_and_surface(module_key: str, surface: str) -> tuple[str, RecordLayoutSurface]:
    normalized_module = module_key.strip()
    normalized_surface = surface.strip()
    if normalized_module not in SUPPORTED_LAYOUT_MODULES:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record layouts are not available for this module")
    if normalized_surface not in SUPPORTED_LAYOUT_SURFACES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Unsupported record layout surface")
    return normalized_module, normalized_surface  # type: ignore[return-value]


def _field_catalog(db: Session, *, tenant_id: int, module_key: str) -> dict[str, RuntimeFieldDefinition]:
    if module_key != "sales_leads":
        return {}
    catalog = dict(LEAD_SYSTEM_FIELDS)
    for definition in list_custom_field_definitions(
        db,
        tenant_id=tenant_id,
        module_key=module_key,
        include_inactive=False,
    ):
        field_key = f"custom:{definition.field_key}"
        catalog[field_key] = RuntimeFieldDefinition(
            field_key=field_key,
            label=definition.label,
            field_type=definition.field_type,
            required=bool(definition.is_required),
            field_source="custom_field",
            placeholder=definition.placeholder,
            help_text=definition.help_text,
        )
    return catalog


def validate_layout_definition(
    db: Session,
    *,
    tenant_id: int,
    definition: RecordLayoutDefinitionPayload,
) -> RecordLayoutDefinitionPayload:
    module_key, surface = validate_module_and_surface(definition.module_key, definition.surface)
    catalog = _field_catalog(db, tenant_id=tenant_id, module_key=module_key)
    configured_fields = {field.field_key: field for section in definition.sections for field in section.fields}
    unknown = sorted(set(configured_fields) - set(catalog))
    if unknown:
        raise ValueError(f"Unknown layout field keys: {', '.join(unknown)}")

    if surface == "quick_create":
        missing_required = sorted(
            key
            for key, field in catalog.items()
            if field.required
            and (
                key not in configured_fields
                or not configured_fields[key].visible
                or configured_fields[key].readonly is True
            )
        )
        if missing_required:
            raise ValueError(f"Required Quick Create fields must remain visible and writable: {', '.join(missing_required)}")

    for key, configured in configured_fields.items():
        field = catalog[key]
        if field.required and configured.required_override is False:
            raise ValueError(f"Required field cannot be made optional: {key}")
        if surface == "quick_create" and configured.required_override is True and (
            not configured.visible or configured.readonly is True
        ):
            raise ValueError(f"Required Quick Create field must remain visible and writable: {key}")
        if field.readonly and configured.readonly is False:
            raise ValueError(f"Read-only field cannot be made writable: {key}")
    return definition


def _load_default_layout(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    surface: str,
) -> RecordLayoutDefinition | None:
    return (
        db.query(RecordLayoutDefinition)
        .filter(
            RecordLayoutDefinition.tenant_id == tenant_id,
            RecordLayoutDefinition.module_key == module_key,
            RecordLayoutDefinition.surface == surface,
            RecordLayoutDefinition.is_default.is_(True),
        )
        .order_by(RecordLayoutDefinition.id.asc())
        .first()
    )


def _parse_stored_layout(record: RecordLayoutDefinition) -> RecordLayoutDefinitionPayload:
    return RecordLayoutDefinitionPayload(
        module_key=record.module_key,
        surface=record.surface,
        name=record.name,
        version=record.version,
        sections=record.sections,
    )


def _append_required_quick_create_fields(
    definition: RecordLayoutDefinitionPayload,
    catalog: dict[str, RuntimeFieldDefinition],
) -> RecordLayoutDefinitionPayload:
    included = {field.field_key for section in definition.sections for field in section.fields}
    required_custom = [
        field
        for field in catalog.values()
        if field.field_source == "custom_field" and field.required and field.field_key not in included
    ]
    if not required_custom:
        return definition
    sections = list(definition.sections)
    sections.append(
        RecordLayoutSectionDefinition(
            id="required_custom_fields",
            label="Required fields",
            position=max(section.position for section in sections) + 1,
            region="main",
            fields=[
                RecordLayoutFieldDefinition(field_key=field.field_key, position=index, width="full")
                for index, field in enumerate(required_custom)
            ],
        )
    )
    return definition.model_copy(update={"sections": sections})


def _append_detail_custom_fields(
    definition: RecordLayoutDefinitionPayload,
    catalog: dict[str, RuntimeFieldDefinition],
) -> RecordLayoutDefinitionPayload:
    custom_fields = [field for field in catalog.values() if field.field_source == "custom_field"]
    if not custom_fields:
        return definition
    sections = list(definition.sections)
    sections.append(
        RecordLayoutSectionDefinition(
            id="custom_fields",
            label="Custom fields",
            position=max(section.position for section in sections) + 1,
            region="main",
            collapsed_by_default=True,
            fields=[
                RecordLayoutFieldDefinition(field_key=field.field_key, position=index, width="half")
                for index, field in enumerate(custom_fields)
            ],
        )
    )
    return definition.model_copy(update={"sections": sections})


def _resolve_sections(
    definition: RecordLayoutDefinitionPayload,
    *,
    catalog: dict[str, RuntimeFieldDefinition],
    enabled_states: dict[str, bool],
) -> tuple[list[ResolvedRecordLayoutSection], list[str]]:
    warnings: list[str] = []
    resolved_sections: list[ResolvedRecordLayoutSection] = []
    for section in sorted(definition.sections, key=lambda item: item.position):
        resolved_fields: list[ResolvedRecordLayoutField] = []
        for configured in sorted(section.fields, key=lambda item: item.position):
            field = catalog.get(configured.field_key)
            if field is None:
                warnings.append(f"Omitted stale field reference: {configured.field_key}")
                continue
            enabled_key = configured.field_key
            if enabled_states.get(enabled_key, True) is False and not (
                definition.surface == "quick_create" and field.required
            ):
                continue
            resolved_fields.append(
                ResolvedRecordLayoutField(
                    field_key=configured.field_key,
                    label=field.label,
                    field_type=field.field_type,
                    field_source=field.field_source,  # type: ignore[arg-type]
                    position=configured.position,
                    width=configured.width,
                    visible=configured.visible,
                    required=field.required or configured.required_override is True,
                    readonly=definition.surface == "detail" or field.readonly or configured.readonly is True,
                    placeholder=field.placeholder,
                    help_text=field.help_text,
                )
            )
        if resolved_fields:
            resolved_sections.append(
                ResolvedRecordLayoutSection(
                    id=section.id,
                    label=section.label,
                    position=section.position,
                    region=section.region,
                    collapsed_by_default=section.collapsed_by_default,
                    fields=resolved_fields,
                )
            )
    return resolved_sections, warnings


def resolve_record_layout(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    surface: str,
) -> ResolvedRecordLayoutResponse:
    module_key, normalized_surface = validate_module_and_surface(module_key, surface)
    fallback = LEAD_LAYOUT_SEEDS.get(normalized_surface)
    if fallback is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No system layout is available for this surface")

    catalog = _field_catalog(db, tenant_id=tenant_id, module_key=module_key)
    record = _load_default_layout(
        db,
        tenant_id=tenant_id,
        module_key=module_key,
        surface=normalized_surface,
    )
    definition = fallback
    source = "system"
    layout_id = None
    warnings: list[str] = []
    if record is not None:
        try:
            definition = _parse_stored_layout(record)
            source = "tenant"
            layout_id = record.id
        except ValidationError:
            warnings.append("Stored layout is invalid; using the system fallback")
            logger.warning(
                "Invalid stored record layout; using system fallback",
                extra={"tenant_id": tenant_id, "module_key": module_key, "surface": normalized_surface},
            )

    if source == "system" and normalized_surface == "quick_create":
        definition = _append_required_quick_create_fields(definition, catalog)
    if source == "system" and normalized_surface == "detail":
        definition = _append_detail_custom_fields(definition, catalog)

    sections, resolution_warnings = _resolve_sections(
        definition,
        catalog=catalog,
        enabled_states=module_field_enabled_map(db, tenant_id=tenant_id, module_key=module_key),
    )
    warnings.extend(resolution_warnings)
    if resolution_warnings:
        logger.warning(
            "Stale record layout fields were omitted",
            extra={"tenant_id": tenant_id, "module_key": module_key, "surface": normalized_surface},
        )

    if normalized_surface == "quick_create":
        writable_visible_keys = {
            field.field_key
            for section in sections
            for field in section.fields
            if field.visible and not field.readonly
        }
        missing_required = sorted(
            key for key, field in catalog.items() if field.required and key not in writable_visible_keys
        )
        unusable_required_overrides = sorted(
            field.field_key
            for section in sections
            for field in section.fields
            if field.required and (not field.visible or field.readonly)
        )
        missing_required.extend(
            key for key in unusable_required_overrides if key not in missing_required
        )
        if missing_required:
            warnings.append("Stored layout omitted required fields; using the system fallback")
            logger.warning(
                "Stored record layout omitted required fields; using system fallback",
                extra={"tenant_id": tenant_id, "module_key": module_key, "surface": normalized_surface},
            )
            definition = _append_required_quick_create_fields(fallback, catalog)
            sections, fallback_warnings = _resolve_sections(
                definition,
                catalog=catalog,
                enabled_states=module_field_enabled_map(db, tenant_id=tenant_id, module_key=module_key),
            )
            warnings.extend(fallback_warnings)
            source = "system"
            layout_id = None

    return ResolvedRecordLayoutResponse(
        layout_id=layout_id,
        module_key=module_key,
        surface=normalized_surface,
        name=definition.name,
        source=source,  # type: ignore[arg-type]
        version=definition.version,
        can_customize=False,
        sections=sections,
        warnings=list(dict.fromkeys(warnings)),
    )
