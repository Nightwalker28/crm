from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


RecordLayoutSurface = Literal["quick_create", "detail", "full_form"]
RecordLayoutRegion = Literal["main", "sidebar"]
RecordLayoutWidth = Literal["full", "half"]


class StrictLayoutModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RecordLayoutFieldDefinition(StrictLayoutModel):
    field_key: str = Field(min_length=1, max_length=150)
    position: int = Field(ge=0)
    width: RecordLayoutWidth = "full"
    visible: bool = True
    required_override: bool | None = None
    readonly: bool | None = None


class RecordLayoutSectionDefinition(StrictLayoutModel):
    id: str = Field(min_length=1, max_length=100, pattern=r"^[a-z][a-z0-9_-]*$")
    label: str = Field(min_length=1, max_length=150)
    position: int = Field(ge=0)
    region: RecordLayoutRegion = "main"
    collapsed_by_default: bool = False
    fields: list[RecordLayoutFieldDefinition] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def validate_field_order(self):
        positions = [field.position for field in self.fields]
        if len(positions) != len(set(positions)):
            raise ValueError("Field positions must be unique within a section")
        return self


class RecordLayoutDefinitionPayload(StrictLayoutModel):
    module_key: str = Field(min_length=1, max_length=100)
    surface: RecordLayoutSurface
    name: str = Field(min_length=1, max_length=150)
    version: int = Field(default=1, ge=1)
    sections: list[RecordLayoutSectionDefinition] = Field(min_length=1, max_length=30)

    @model_validator(mode="after")
    def validate_unique_structure(self):
        section_ids = [section.id for section in self.sections]
        if len(section_ids) != len(set(section_ids)):
            raise ValueError("Section ids must be unique")
        section_positions = [section.position for section in self.sections]
        if len(section_positions) != len(set(section_positions)):
            raise ValueError("Section positions must be unique")
        field_keys = [field.field_key for section in self.sections for field in section.fields]
        if len(field_keys) != len(set(field_keys)):
            raise ValueError("A field may appear only once in a layout")
        return self


class ResolvedRecordLayoutField(StrictLayoutModel):
    field_key: str
    label: str
    field_type: str
    field_source: Literal["system", "custom_field"]
    position: int
    width: RecordLayoutWidth
    visible: bool
    required: bool
    readonly: bool
    placeholder: str | None = None
    help_text: str | None = None


class ResolvedRecordLayoutSection(StrictLayoutModel):
    id: str
    label: str
    position: int
    region: RecordLayoutRegion
    collapsed_by_default: bool
    fields: list[ResolvedRecordLayoutField]


class ResolvedRecordLayoutResponse(StrictLayoutModel):
    layout_id: int | None = None
    module_key: str
    surface: RecordLayoutSurface
    name: str
    source: Literal["system", "tenant"]
    version: int
    can_customize: bool = False
    sections: list[ResolvedRecordLayoutSection]
    warnings: list[str] = Field(default_factory=list)


# --- Administration (workstream 09, backend Phase 2) -------------------------------------
#
# These schemas back the tenant layout builder. They are deliberately kept out of the
# generated runtime contract slice (`/api/v1/record-layouts`); the admin surface lives under
# `/api/v1/admin/record-layouts` so widening the builder does not churn the runtime contract.


class RecordLayoutCatalogField(StrictLayoutModel):
    """A field an administrator may place on the surface, with its non-negotiable constraints."""

    field_key: str
    label: str
    field_type: str
    field_source: Literal["system", "custom_field"]
    required: bool
    readonly: bool
    enabled: bool
    locked: bool
    locked_reason: str | None = None


class RecordLayoutValidationReport(StrictLayoutModel):
    """Blocking errors and advisory warnings are separate lists, never merged."""

    valid: bool
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class RecordLayoutAdminStateResponse(StrictLayoutModel):
    module_key: str
    surface: RecordLayoutSurface
    layout_id: int | None = None
    source: Literal["system", "tenant"]
    version: int
    # Echoes the stored version so the builder can send it back as `expected_version`.
    # `null` means no tenant layout is stored and the system default is being shown.
    expected_version: int | None = None
    updated_at: datetime | None = None
    definition: RecordLayoutDefinitionPayload
    system_definition: RecordLayoutDefinitionPayload
    available_fields: list[RecordLayoutCatalogField]
    validation: RecordLayoutValidationReport


class RecordLayoutPreviewRequest(StrictLayoutModel):
    definition: RecordLayoutDefinitionPayload


class RecordLayoutPreviewResponse(StrictLayoutModel):
    validation: RecordLayoutValidationReport
    # Null when the candidate has blocking errors: there is nothing truthful to preview.
    resolved: ResolvedRecordLayoutResponse | None = None


class RecordLayoutPublishRequest(StrictLayoutModel):
    definition: RecordLayoutDefinitionPayload
    # The version the builder loaded. `null` asserts "no tenant layout existed".
    expected_version: int | None = None
