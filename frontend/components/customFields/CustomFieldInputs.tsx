"use client";

import { useEffect } from "react";

import { Checkbox, CheckboxIndicator } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Textarea } from "@/components/ui/textarea";
import type { CustomFieldDefinition } from "@/hooks/useModuleCustomFields";

type CustomFieldInputProps = {
  definition: CustomFieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  error?: string | null;
};

export function CustomFieldInput({ definition: field, value, onChange, disabled = false, error }: CustomFieldInputProps) {
  useEffect(() => {
    if (field.field_type === "boolean" && field.is_required && value === undefined) {
      onChange(false);
    }
  }, [field.field_type, field.is_required, onChange, value]);

  const inputId = `custom-field-${field.module_key}-${field.field_key}`;
  const descriptionId = field.help_text ? `${inputId}-description` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  if (field.field_type === "long_text") {
    return (
      <Field data-invalid={Boolean(error)}>
        <FieldLabel htmlFor={inputId}>
          {field.label} {field.is_required ? <RequiredMark /> : null}
        </FieldLabel>
        <Textarea
          id={inputId}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder ?? ""}
          required={field.is_required}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          rows={3}
        />
        {field.help_text ? <FieldDescription id={descriptionId}>{field.help_text}</FieldDescription> : null}
        {error ? <FieldError id={errorId}>{error}</FieldError> : null}
      </Field>
    );
  }

  if (field.field_type === "boolean") {
    return (
      <Field data-invalid={Boolean(error)}>
        <FieldLabel htmlFor={inputId}>
          {field.label} {field.is_required ? <RequiredMark /> : null}
        </FieldLabel>
        <label htmlFor={inputId} className="flex cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line-default bg-surface px-3 py-2 text-sm text-copy-secondary has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
          <span>Enabled</span>
          <Checkbox
            id={inputId}
            checked={value === true}
            onCheckedChange={(checked) => onChange(checked === true)}
            className="flex size-4 items-center justify-center rounded border border-line-strong bg-surface text-primary"
            aria-required={field.is_required}
            disabled={disabled}
            aria-describedby={describedBy}
            aria-invalid={Boolean(error)}
          >
            <CheckboxIndicator className="size-3" />
          </Checkbox>
        </label>
        {field.help_text ? <FieldDescription id={descriptionId}>{field.help_text}</FieldDescription> : null}
        {error ? <FieldError id={errorId}>{error}</FieldError> : null}
      </Field>
    );
  }

  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={inputId}>
        {field.label} {field.is_required ? <RequiredMark /> : null}
      </FieldLabel>
      <Input
        id={inputId}
        type={field.field_type === "number" || field.field_type === "date" ? field.field_type : "text"}
        value={value == null ? "" : String(value)}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.placeholder ?? ""}
        required={field.is_required}
        disabled={disabled}
        aria-describedby={describedBy}
        aria-invalid={Boolean(error)}
        step={field.field_type === "number" ? "any" : undefined}
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
};

export default function CustomFieldInputs({ definitions, values, onChange }: Props) {
  if (!definitions.length) return null;

  return (
    <div className="rounded-[var(--radius-card)] border border-line-default bg-surface-muted px-4 py-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-copy-primary">Configured fields</h3>
        <p className="mt-1 text-p-sm text-copy-muted">These fields are managed by a workspace administrator.</p>
      </div>

      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        {definitions.map((field) => (
          <div key={field.id} className={field.field_type === "long_text" ? "sm:col-span-2" : undefined}>
            <CustomFieldInput
              definition={field}
              value={values[field.field_key]}
              onChange={(value) => onChange(field.field_key, value)}
            />
          </div>
        ))}
      </FieldGroup>
    </div>
  );
}
