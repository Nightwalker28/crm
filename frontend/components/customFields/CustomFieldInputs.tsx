"use client";

import { useEffect } from "react";

import { FieldControl } from "@/components/fields/FieldControl";
import { useServerFieldError } from "@/components/forms/ServerFieldErrors";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { RequiredMark } from "@/components/ui/RequiredMark";
import type { CustomFieldDefinition } from "@/hooks/useModuleCustomFields";
import { fieldTypeKey, isWideType } from "@/lib/fieldTypes";

type CustomFieldInputProps = {
  definition: CustomFieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  error?: string | null;
};

/** One custom field in a form: label, the type's control, help and the server's error (H2). */
export function CustomFieldInput({ definition: field, value, onChange, disabled = false, error: clientError }: CustomFieldInputProps) {
  // A required Yes/No shows No until it is answered, so No is what the form holds and sends.
  const isRequiredBoolean = fieldTypeKey(field.field_type) === "boolean" && field.is_required;
  useEffect(() => {
    if (isRequiredBoolean && value === undefined) onChange(false);
  }, [isRequiredBoolean, onChange, value]);

  const inputId = `custom-field-${field.module_key}-${field.field_key}`;
  const serverError = useServerFieldError(inputId);
  const error = clientError || serverError;
  const descriptionId = field.help_text ? `${inputId}-description` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={inputId}>
        {field.label} {field.is_required ? <RequiredMark /> : null}
      </FieldLabel>
      <FieldControl
        field={field}
        id={inputId}
        value={value}
        onChange={onChange}
        moduleKey={field.module_key}
        disabled={disabled}
        ariaInvalid={Boolean(error)}
        ariaDescribedBy={describedBy}
      />
      {field.help_text ? <FieldDescription id={descriptionId}>{field.help_text}</FieldDescription> : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </Field>
  );
}

type Props = {
  definitions: CustomFieldDefinition[];
  values: Record<string, unknown>;
  onChange: (fieldKey: string, value: unknown) => void;
  disabled?: boolean;
};

export default function CustomFieldInputs({ definitions, values, onChange, disabled }: Props) {
  if (!definitions.length) return null;

  return (
    <FieldGroup className="grid gap-4 md:grid-cols-2">
      {definitions.map((field) => (
        <div key={field.id} className={isWideType(field.field_type) ? "sm:col-span-2" : undefined}>
          <CustomFieldInput
            definition={field}
            value={values[field.field_key]}
            onChange={(value) => onChange(field.field_key, value)}
            disabled={disabled}
          />
        </div>
      ))}
    </FieldGroup>
  );
}
