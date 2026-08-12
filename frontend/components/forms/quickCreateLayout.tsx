"use client";

import type { ReactNode } from "react";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { RequiredMark } from "@/components/ui/RequiredMark";
import type {
  ResolvedRecordLayout as ResolvedRecordLayoutContract,
  ResolvedRecordLayoutField,
} from "@/hooks/useResolvedRecordLayout";

/**
 * The parts of a layout-driven Quick Create form that are the same for every module:
 * element ids, required-field validation, and the label/description/error frame around a
 * control. What each field key actually renders stays with the module, because that is where
 * the domain lives.
 */

export function makeQuickCreateInputId(prefix: string, moduleKey: string) {
  return (fieldKey: string) =>
    fieldKey.startsWith("custom:")
      ? `custom-field-${moduleKey}-${fieldKey.slice("custom:".length)}`
      : `${prefix}-${fieldKey}`;
}

export function isEmptyRequiredValue(value: unknown) {
  return value === null
    || value === undefined
    || (typeof value === "string" && !value.trim())
    || (Array.isArray(value) && value.length === 0);
}

/**
 * Requiredness comes from the resolved layout, which the backend derives from the domain
 * field catalog. A surface may add format checks on top, never a different set of required
 * fields — that is the rule that keeps quick and full create in agreement.
 */
export function validateQuickCreateLayout(
  layout: ResolvedRecordLayoutContract,
  resolveValue: (field: ResolvedRecordLayoutField) => unknown,
) {
  const errors: Record<string, string> = {};
  for (const section of [...layout.sections].sort((left, right) => left.position - right.position)) {
    for (const field of [...section.fields].sort((left, right) => left.position - right.position)) {
      if (!field.visible || !field.required || field.readonly) continue;
      if (isEmptyRequiredValue(resolveValue(field))) {
        errors[field.field_key] = `${field.label} is required.`;
      }
    }
  }
  return errors;
}

export function layoutHasVisibleField(layout: ResolvedRecordLayoutContract, fieldKey: string) {
  return layout.sections.some((section) =>
    section.fields.some((field) => field.field_key === fieldKey && field.visible),
  );
}

/** The `<input type>` a layout field type maps to, for the plain text-ish controls. */
export function quickCreateInputType(fieldType: string) {
  if (fieldType === "email") return "email";
  if (fieldType === "phone") return "tel";
  if (fieldType === "url") return "url";
  if (fieldType === "date") return "date";
  if (fieldType === "datetime") return "datetime-local";
  return "text";
}

export type QuickCreateFieldAria = {
  id: string;
  descriptionId?: string;
  errorId?: string;
  describedBy?: string;
  invalid: boolean;
};

export function quickCreateFieldAria(
  field: ResolvedRecordLayoutField,
  inputId: string,
  error?: string | null,
): QuickCreateFieldAria {
  const descriptionId = field.help_text ? `${inputId}-description` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return {
    id: inputId,
    descriptionId,
    errorId,
    describedBy: [descriptionId, errorId].filter(Boolean).join(" ") || undefined,
    invalid: Boolean(error),
  };
}

/** Label, required marker, help text, and error message around a module's own control. */
export function QuickCreateField({
  field,
  aria,
  error,
  children,
}: {
  field: ResolvedRecordLayoutField;
  aria: QuickCreateFieldAria;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={aria.id}>
        {field.label} {field.required ? <RequiredMark /> : null}
      </FieldLabel>
      {children}
      {field.help_text ? <FieldDescription id={aria.descriptionId}>{field.help_text}</FieldDescription> : null}
      {error ? <FieldError id={aria.errorId}>{error}</FieldError> : null}
    </Field>
  );
}

export function invalidFieldKeys(errors: Record<string, string | null | undefined>) {
  return Object.entries(errors).filter(([, error]) => Boolean(error)).map(([fieldKey]) => fieldKey);
}
