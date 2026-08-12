from __future__ import annotations

import logging
from dataclasses import dataclass

from fastapi import HTTPException, status
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.modules.platform.models import RecordLayoutDefinition
from app.modules.platform.record_layout_schema import (
    RecordLayoutAdminStateResponse,
    RecordLayoutCatalogField,
    RecordLayoutDefinitionPayload,
    RecordLayoutFieldDefinition,
    RecordLayoutPreviewResponse,
    RecordLayoutSectionDefinition,
    RecordLayoutSurface,
    RecordLayoutValidationReport,
    ResolvedRecordLayoutField,
    ResolvedRecordLayoutResponse,
    ResolvedRecordLayoutSection,
)
from app.modules.platform.services.activity_logs import safe_log_activity
from app.modules.platform.services.custom_fields import list_custom_field_definitions
from app.modules.platform.services.module_fields import module_field_enabled_map


SUPPORTED_LAYOUT_MODULES = {"sales_leads"}
SUPPORTED_LAYOUT_SURFACES = {"quick_create", "detail"}

# Administration is deliberately narrower than the runtime. Phase 2 of workstream 09 only
# opens the surface the Lead Quick Create pilot proved; Details/Full Form stay on the
# product default until their own slice widens this set.
ADMIN_LAYOUT_MODULES = {"sales_leads"}
ADMIN_LAYOUT_SURFACES = {"quick_create"}

# Guidance thresholds for Quick Create. They produce warnings, never blocking errors: a
# tenant workflow that genuinely needs a long form is allowed, just told what it costs.
QUICK_CREATE_RECOMMENDED_MIN_FIELDS = 5
QUICK_CREATE_RECOMMENDED_MAX_FIELDS = 8
QUICK_CREATE_RECOMMENDED_MAX_SECTIONS = 2
QUICK_CREATE_SLOW_FIELD_TYPES = {"long_text", "file"}

LAYOUT_ENTITY_TYPE = "record_layout"

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


def collect_layout_errors(
    db: Session,
    *,
    tenant_id: int,
    definition: RecordLayoutDefinitionPayload,
) -> list[str]:
    """Blocking problems: a layout with any of these must never be stored or rendered."""

    module_key, surface = validate_module_and_surface(definition.module_key, definition.surface)
    catalog = _field_catalog(db, tenant_id=tenant_id, module_key=module_key)
    configured_fields = {field.field_key: field for section in definition.sections for field in section.fields}
    errors: list[str] = []

    unknown = sorted(set(configured_fields) - set(catalog))
    if unknown:
        errors.append(f"Unknown layout field keys: {', '.join(unknown)}")

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
            errors.append(
                f"Required Quick Create fields must remain visible and writable: {', '.join(missing_required)}"
            )

    for key, configured in sorted(configured_fields.items()):
        field = catalog.get(key)
        if field is None:
            continue
        if field.required and configured.required_override is False:
            errors.append(f"Required field cannot be made optional: {key}")
        if surface == "quick_create" and configured.required_override is True and (
            not configured.visible or configured.readonly is True
        ):
            errors.append(f"Required Quick Create field must remain visible and writable: {key}")
        if field.readonly and configured.readonly is False:
            errors.append(f"Read-only field cannot be made writable: {key}")

    if surface == "quick_create":
        writable = [
            key
            for key, configured in configured_fields.items()
            if configured.visible
            and configured.readonly is not True
            and not (catalog[key].readonly if key in catalog else False)
        ]
        if not writable:
            errors.append("A Quick Create layout needs at least one visible, writable field.")

    return list(dict.fromkeys(errors))


def collect_layout_warnings(
    db: Session,
    *,
    tenant_id: int,
    definition: RecordLayoutDefinitionPayload,
) -> list[str]:
    """Advisory guidance. A warning never blocks a publish — it explains a cost."""

    module_key, surface = validate_module_and_surface(definition.module_key, definition.surface)
    catalog = _field_catalog(db, tenant_id=tenant_id, module_key=module_key)
    enabled_states = module_field_enabled_map(db, tenant_id=tenant_id, module_key=module_key)
    warnings: list[str] = []

    def label_for(field_key: str) -> str:
        field = catalog.get(field_key)
        return field.label if field else field_key

    for section in sorted(definition.sections, key=lambda item: item.position):
        if not section.fields:
            warnings.append(f"Section “{section.label}” has no fields and will not render.")

    configured = [(section, field) for section in definition.sections for field in section.fields]
    for _section, field in sorted(configured, key=lambda item: item[1].field_key):
        definition_field = catalog.get(field.field_key)
        if definition_field is None:
            continue
        if not field.visible:
            warnings.append(f"“{definition_field.label}” is hidden, so it stays in the layout but is not rendered.")
        elif enabled_states.get(field.field_key, True) is False and not definition_field.required:
            warnings.append(
                f"“{definition_field.label}” is turned off in Field Config and will not render until it is enabled."
            )

    if surface != "quick_create":
        return list(dict.fromkeys(warnings))

    visible_fields = [field for _section, field in configured if field.visible]
    if len(visible_fields) > QUICK_CREATE_RECOMMENDED_MAX_FIELDS:
        warnings.append(
            f"Quick Create shows {len(visible_fields)} fields. "
            f"{QUICK_CREATE_RECOMMENDED_MIN_FIELDS}–{QUICK_CREATE_RECOMMENDED_MAX_FIELDS} keeps it quick; "
            "the full form stays available under More details."
        )

    slow_fields = sorted(
        {
            label_for(field.field_key)
            for field in visible_fields
            if (catalog.get(field.field_key).field_type if field.field_key in catalog else None)
            in QUICK_CREATE_SLOW_FIELD_TYPES
        }
    )
    if slow_fields:
        warnings.append(
            f"Long-form fields ({', '.join(f'“{label}”' for label in slow_fields)}) slow Quick Create down. "
            "Consider leaving them to the full form."
        )

    populated_sections = [section for section in definition.sections if section.fields]
    if len(populated_sections) > QUICK_CREATE_RECOMMENDED_MAX_SECTIONS:
        warnings.append(
            f"Quick Create has {len(populated_sections)} sections. One or two read better in a narrow panel."
        )

    if any(section.region == "sidebar" and section.fields for section in definition.sections):
        warnings.append("Quick Create is a narrow surface, so sidebar sections stack below the main fields.")

    if any(section.collapsed_by_default and section.fields for section in definition.sections):
        warnings.append("Collapsed sections hide fields behind an extra click during Quick Create.")

    readonly_visible = sorted(
        {
            label_for(field.field_key)
            for field in visible_fields
            if field.readonly is True or (catalog.get(field.field_key).readonly if field.field_key in catalog else False)
        }
    )
    if readonly_visible:
        warnings.append(
            f"Read-only fields ({', '.join(f'“{label}”' for label in readonly_visible)}) cannot be filled in "
            "during Quick Create."
        )

    return list(dict.fromkeys(warnings))


def validate_layout_definition(
    db: Session,
    *,
    tenant_id: int,
    definition: RecordLayoutDefinitionPayload,
) -> RecordLayoutDefinitionPayload:
    errors = collect_layout_errors(db, tenant_id=tenant_id, definition=definition)
    if errors:
        raise ValueError("; ".join(errors))
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


# --- Administration (workstream 09, backend Phase 2) -------------------------------------
#
# Model: one published tenant default per (tenant, module, surface). A publish replaces it
# immediately and bumps `version`; there is no draft row, so there is no ambiguous
# half-published state to resolve at runtime. Preview validates a candidate without writing
# anything, and reset deletes the tenant row so the system default takes over again.


def validate_admin_module_and_surface(module_key: str, surface: str) -> tuple[str, RecordLayoutSurface]:
    normalized_module = module_key.strip()
    normalized_surface = surface.strip()
    if normalized_module not in ADMIN_LAYOUT_MODULES:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Record layout administration is not available for this module",
        )
    if normalized_surface not in ADMIN_LAYOUT_SURFACES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="This record layout surface cannot be configured yet",
        )
    return validate_module_and_surface(normalized_module, normalized_surface)


def _catalog_entries(
    catalog: dict[str, RuntimeFieldDefinition],
    *,
    enabled_states: dict[str, bool],
    surface: str,
) -> list[RecordLayoutCatalogField]:
    entries: list[RecordLayoutCatalogField] = []
    for field in sorted(catalog.values(), key=lambda item: (item.field_source != "system", item.label.lower())):
        locked_reason: str | None = None
        if field.required and surface == "quick_create":
            locked_reason = "Required by the domain, so it must stay visible and editable here."
        elif field.readonly:
            locked_reason = "Managed by the system and always read-only."
        entries.append(
            RecordLayoutCatalogField(
                field_key=field.field_key,
                label=field.label,
                field_type=field.field_type,
                field_source=field.field_source,  # type: ignore[arg-type]
                required=field.required,
                readonly=field.readonly,
                enabled=enabled_states.get(field.field_key, True),
                locked=field.required and surface == "quick_create",
                locked_reason=locked_reason,
            )
        )
    return entries


def _normalized_definition(definition: RecordLayoutDefinitionPayload) -> RecordLayoutDefinitionPayload:
    """Renumber positions to a dense 0..n-1 sequence so stored JSON is canonical."""

    sections = []
    for section_index, section in enumerate(sorted(definition.sections, key=lambda item: item.position)):
        fields = [
            field.model_copy(update={"position": field_index})
            for field_index, field in enumerate(sorted(section.fields, key=lambda item: item.position))
        ]
        sections.append(section.model_copy(update={"position": section_index, "fields": fields}))
    return definition.model_copy(update={"sections": sections})


def _validation_report(
    db: Session,
    *,
    tenant_id: int,
    definition: RecordLayoutDefinitionPayload,
) -> RecordLayoutValidationReport:
    errors = collect_layout_errors(db, tenant_id=tenant_id, definition=definition)
    warnings = collect_layout_warnings(db, tenant_id=tenant_id, definition=definition)
    return RecordLayoutValidationReport(valid=not errors, errors=errors, warnings=warnings)


def _system_definition(
    surface: str,
    catalog: dict[str, RuntimeFieldDefinition],
) -> RecordLayoutDefinitionPayload:
    """The product default exactly as the runtime resolver would fall back to it."""

    seed = LEAD_LAYOUT_SEEDS.get(surface)
    if seed is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No system layout is available for this surface",
        )
    definition = seed.model_copy(deep=True)
    if surface == "quick_create":
        definition = _append_required_quick_create_fields(definition, catalog)
    if surface == "detail":
        definition = _append_detail_custom_fields(definition, catalog)
    return _normalized_definition(definition)


def _admin_state(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    surface: RecordLayoutSurface,
) -> RecordLayoutAdminStateResponse:
    catalog = _field_catalog(db, tenant_id=tenant_id, module_key=module_key)
    enabled_states = module_field_enabled_map(db, tenant_id=tenant_id, module_key=module_key)
    system_definition = _system_definition(surface, catalog)

    record = _load_default_layout(db, tenant_id=tenant_id, module_key=module_key, surface=surface)
    definition = system_definition
    source = "system"
    layout_id: int | None = None
    expected_version: int | None = None
    updated_at = None
    unreadable_warning: str | None = None

    if record is not None:
        layout_id = record.id
        expected_version = record.version
        updated_at = record.updated_at
        try:
            definition = _normalized_definition(_parse_stored_layout(record))
            source = "tenant"
        except ValidationError:
            # The builder still needs something editable. Show the system default and say so;
            # publishing from here replaces the unreadable row rather than merging into it.
            unreadable_warning = (
                "The stored layout could not be read, so the system default is shown. "
                "Publishing replaces the stored layout."
            )
            logger.warning(
                "Invalid stored record layout in admin state; showing system default",
                extra={"tenant_id": tenant_id, "module_key": module_key, "surface": surface},
            )

    validation = _validation_report(db, tenant_id=tenant_id, definition=definition)
    if unreadable_warning:
        validation = validation.model_copy(update={"warnings": [unreadable_warning, *validation.warnings]})

    return RecordLayoutAdminStateResponse(
        module_key=module_key,
        surface=surface,
        layout_id=layout_id,
        source=source,  # type: ignore[arg-type]
        version=definition.version if source == "tenant" else system_definition.version,
        expected_version=expected_version,
        updated_at=updated_at,
        definition=definition,
        system_definition=system_definition,
        available_fields=_catalog_entries(catalog, enabled_states=enabled_states, surface=surface),
        validation=validation,
    )


def get_admin_record_layout(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    surface: str,
) -> RecordLayoutAdminStateResponse:
    module_key, normalized_surface = validate_admin_module_and_surface(module_key, surface)
    return _admin_state(db, tenant_id=tenant_id, module_key=module_key, surface=normalized_surface)


def _assert_definition_matches_path(
    definition: RecordLayoutDefinitionPayload,
    *,
    module_key: str,
    surface: str,
) -> None:
    if definition.module_key.strip() != module_key or definition.surface.strip() != surface:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="The layout definition does not match the module and surface being configured",
        )


def preview_record_layout(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    surface: str,
    definition: RecordLayoutDefinitionPayload,
) -> RecordLayoutPreviewResponse:
    """Validate and resolve a candidate. Never writes — this is the 'before you publish' view."""

    module_key, normalized_surface = validate_admin_module_and_surface(module_key, surface)
    _assert_definition_matches_path(definition, module_key=module_key, surface=normalized_surface)

    candidate = _normalized_definition(definition)
    validation = _validation_report(db, tenant_id=tenant_id, definition=candidate)
    if not validation.valid:
        return RecordLayoutPreviewResponse(validation=validation, resolved=None)

    catalog = _field_catalog(db, tenant_id=tenant_id, module_key=module_key)
    record = _load_default_layout(db, tenant_id=tenant_id, module_key=module_key, surface=normalized_surface)
    sections, resolution_warnings = _resolve_sections(
        candidate,
        catalog=catalog,
        enabled_states=module_field_enabled_map(db, tenant_id=tenant_id, module_key=module_key),
    )
    resolved = ResolvedRecordLayoutResponse(
        layout_id=record.id if record is not None else None,
        module_key=module_key,
        surface=normalized_surface,
        name=candidate.name,
        source="tenant",
        # What the version would become once this candidate is published.
        version=(record.version + 1) if record is not None else 1,
        can_customize=False,
        sections=sections,
        warnings=list(dict.fromkeys(resolution_warnings)),
    )
    return RecordLayoutPreviewResponse(validation=validation, resolved=resolved)


def publish_record_layout(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int | None,
    module_key: str,
    surface: str,
    definition: RecordLayoutDefinitionPayload,
    expected_version: int | None,
) -> RecordLayoutAdminStateResponse:
    module_key, normalized_surface = validate_admin_module_and_surface(module_key, surface)
    _assert_definition_matches_path(definition, module_key=module_key, surface=normalized_surface)

    candidate = _normalized_definition(definition)
    validation = _validation_report(db, tenant_id=tenant_id, definition=candidate)
    if not validation.valid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "message": "This layout cannot be published.",
                "errors": validation.errors,
                "warnings": validation.warnings,
            },
        )

    record = _load_default_layout(db, tenant_id=tenant_id, module_key=module_key, surface=normalized_surface)
    current_version = record.version if record is not None else None
    if expected_version != current_version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "This layout changed since you opened it. Reload to see the current version.",
                "current_version": current_version,
            },
        )

    sections_json = [section.model_dump(mode="json") for section in candidate.sections]
    before_state = (
        {"name": record.name, "version": record.version, "sections": record.sections} if record is not None else None
    )
    if record is None:
        record = RecordLayoutDefinition(
            tenant_id=tenant_id,
            module_key=module_key,
            surface=normalized_surface,
            name=candidate.name,
            is_default=True,
            version=1,
            sections=sections_json,
        )
        db.add(record)
    else:
        record.name = candidate.name
        record.sections = sections_json
        record.version = record.version + 1
    db.commit()
    db.refresh(record)

    safe_log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key=module_key,
        entity_type=LAYOUT_ENTITY_TYPE,
        entity_id=f"{module_key}:{normalized_surface}",
        action="publish",
        description=f"Published the {normalized_surface} layout (version {record.version})",
        before_state=before_state,
        after_state={"name": record.name, "version": record.version, "sections": record.sections},
    )
    return _admin_state(db, tenant_id=tenant_id, module_key=module_key, surface=normalized_surface)


def reset_record_layout(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int | None,
    module_key: str,
    surface: str,
) -> RecordLayoutAdminStateResponse:
    """Drop the tenant default so the system layout takes over again. Idempotent."""

    module_key, normalized_surface = validate_admin_module_and_surface(module_key, surface)
    record = _load_default_layout(db, tenant_id=tenant_id, module_key=module_key, surface=normalized_surface)
    if record is not None:
        before_state = {"name": record.name, "version": record.version, "sections": record.sections}
        db.delete(record)
        db.commit()
        safe_log_activity(
            db,
            tenant_id=tenant_id,
            actor_user_id=actor_user_id,
            module_key=module_key,
            entity_type=LAYOUT_ENTITY_TYPE,
            entity_id=f"{module_key}:{normalized_surface}",
            action="reset",
            description=f"Reset the {normalized_surface} layout to the system default",
            before_state=before_state,
            after_state=None,
        )
    return _admin_state(db, tenant_id=tenant_id, module_key=module_key, surface=normalized_surface)
