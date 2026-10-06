"use client";

import { FieldControl } from "@/components/fields/FieldControl";
import type { CustomModuleField, CustomModuleRecord } from "@/hooks/useModuleBuilder";
import { fieldTypeKey, type FieldShape } from "@/lib/fieldTypes";

/** A custom module field in the shape the one field system's controls read (13b §3.4). */
export function customModuleFieldShape(field: CustomModuleField): FieldShape {
  return {
    field_key: field.key,
    label: field.label,
    field_type: field.field_type,
    picklist_key: field.picklist_key,
    lookup_module_key: field.lookup_module_key,
    config: field.config,
    placeholder: field.placeholder,
    help_text: field.help_text,
    is_required: field.is_required,
  };
}

export function getInitialCustomModuleValues(
  fields: CustomModuleField[],
  record?: CustomModuleRecord | null,
) {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    const type = fieldTypeKey(field.field_type);
    values[field.key] =
      record?.values?.[field.key] ??
      field.default_value ??
      (type === "boolean" ? false : type === "multi_picklist" ? [] : "");
  }
  return values;
}

export function CustomModuleFieldInput({
  field,
  value,
  onChange,
  invalid = false,
  disabled = false,
  moduleKey,
}: {
  field: CustomModuleField;
  value: unknown;
  onChange: (value: unknown) => void;
  invalid?: boolean;
  disabled?: boolean;
  moduleKey?: string;
}) {
  return (
    <FieldControl
      field={customModuleFieldShape(field)}
      id={`custom-field-${field.key}`}
      value={value}
      onChange={onChange}
      moduleKey={moduleKey}
      disabled={disabled}
      ariaInvalid={invalid}
    />
  );
}
