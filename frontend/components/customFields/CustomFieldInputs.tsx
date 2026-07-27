"use client";

import { useEffect } from "react";

import { Checkbox, CheckboxIndicator } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Textarea } from "@/components/ui/textarea";
import type { CustomFieldDefinition } from "@/hooks/useModuleCustomFields";

type Props = {
  definitions: CustomFieldDefinition[];
  values: Record<string, unknown>;
  onChange: (fieldKey: string, value: unknown) => void;
};

export default function CustomFieldInputs({ definitions, values, onChange }: Props) {
  useEffect(() => {
    for (const field of definitions) {
      if (field.field_type === "boolean" && field.is_required && values[field.field_key] === undefined) {
        onChange(field.field_key, false);
      }
    }
  }, [definitions, onChange, values]);

  if (!definitions.length) return null;

  return (
    <div className="rounded-[var(--radius-card)] border border-line-default bg-surface-muted px-4 py-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-copy-primary">Configured fields</h3>
        <p className="mt-1 text-sm leading-6 text-copy-muted">These fields are managed by a workspace administrator.</p>
      </div>

      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        {definitions.map((field) => {
          const value = values[field.field_key];
          const inputId = `custom-field-${field.module_key}-${field.field_key}`;
          const descriptionId = field.help_text ? `${inputId}-description` : undefined;

          if (field.field_type === "long_text") {
            return (
              <Field key={field.id} className="sm:col-span-2">
                <FieldLabel htmlFor={inputId}>
                  {field.label} {field.is_required ? <RequiredMark /> : null}
                </FieldLabel>
                <Textarea
                  id={inputId}
                  value={typeof value === "string" ? value : ""}
                  onChange={(event) => onChange(field.field_key, event.target.value)}
                  placeholder={field.placeholder ?? ""}
                  required={field.is_required}
                  aria-describedby={descriptionId}
                  rows={3}
                />
                {field.help_text ? <FieldDescription id={descriptionId}>{field.help_text}</FieldDescription> : null}
              </Field>
            );
          }

          if (field.field_type === "boolean") {
            return (
              <Field key={field.id}>
                <FieldLabel htmlFor={inputId}>
                  {field.label} {field.is_required ? <RequiredMark /> : null}
                </FieldLabel>
                <label htmlFor={inputId} className="flex cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line-default bg-surface px-3 py-2 text-sm text-copy-secondary">
                  <span>Enabled</span>
                  <Checkbox
                    id={inputId}
                    checked={value === true}
                    onCheckedChange={(checked) => onChange(field.field_key, checked === true)}
                    className="flex size-4 items-center justify-center rounded border border-line-strong bg-surface text-primary"
                    aria-required={field.is_required}
                    aria-describedby={descriptionId}
                  >
                    <CheckboxIndicator className="size-3" />
                  </Checkbox>
                </label>
                {field.help_text ? <FieldDescription id={descriptionId}>{field.help_text}</FieldDescription> : null}
              </Field>
            );
          }

          return (
            <Field key={field.id}>
              <FieldLabel htmlFor={inputId}>
                {field.label} {field.is_required ? <RequiredMark /> : null}
              </FieldLabel>
              <Input
                id={inputId}
                type={field.field_type === "number" || field.field_type === "date" ? field.field_type : "text"}
                value={value == null ? "" : String(value)}
                onChange={(event) => onChange(field.field_key, event.target.value)}
                placeholder={field.placeholder ?? ""}
                required={field.is_required}
                aria-describedby={descriptionId}
                step={field.field_type === "number" ? "any" : undefined}
              />
              {field.help_text ? <FieldDescription id={descriptionId}>{field.help_text}</FieldDescription> : null}
            </Field>
          );
        })}
      </FieldGroup>
    </div>
  );
}
