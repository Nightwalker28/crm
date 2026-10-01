"use client";

import type { ReactNode } from "react";

import { CustomFieldInput } from "@/components/customFields/CustomFieldInputs";
import {
  ResolvedRecordLayout,
  type ResolvedRecordLayoutViewport,
} from "@/components/forms/ResolvedRecordLayout";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { RequiredMark } from "@/components/ui/RequiredMark";
import type { CustomFieldDefinition } from "@/hooks/useModuleCustomFields";
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

const QUICK_CREATE_CUSTOM_FIELD_TYPES = new Set<CustomFieldDefinition["field_type"]>([
  "text",
  "long_text",
  "number",
  "date",
  "boolean",
]);

export function resolveQuickCreateFieldValue<TForm extends Record<string, unknown>>(
  field: ResolvedRecordLayoutField,
  value: TForm,
  customValues: Record<string, unknown>,
) {
  if (field.field_key.startsWith("custom:")) {
    return customValues[field.field_key.slice("custom:".length)];
  }
  return value[field.field_key];
}

export function validateLayoutDrivenQuickCreate<TForm extends Record<string, unknown>>(
  layout: ResolvedRecordLayoutContract,
  value: TForm,
  customValues: Record<string, unknown>,
) {
  return validateQuickCreateLayout(layout, (field) =>
    resolveQuickCreateFieldValue(field, value, customValues),
  );
}

export type LayoutDrivenQuickCreateFieldContext = {
  inputId: string;
  aria: QuickCreateFieldAria;
  error: string | null;
  disabled: boolean;
};

/**
 * The shared layout/custom-field layer for every Quick Create. Domain fields remain module
 * renderers: this owns the frame that the CRM-evolution rollout will repeat, not their rules.
 */
export function LayoutDrivenQuickCreateFields({
  moduleKey,
  layout,
  inputId,
  customValues,
  onCustomChange,
  errors = {},
  lockedFieldKeys = [],
  viewport = "auto",
  renderSystemField,
}: {
  moduleKey: string;
  layout: ResolvedRecordLayoutContract;
  inputId: (fieldKey: string) => string;
  customValues: Record<string, unknown>;
  onCustomChange: (fieldKey: string, value: unknown) => void;
  errors?: Record<string, string | null | undefined>;
  lockedFieldKeys?: readonly string[];
  viewport?: ResolvedRecordLayoutViewport;
  renderSystemField: (
    field: ResolvedRecordLayoutField,
    context: LayoutDrivenQuickCreateFieldContext,
  ) => ReactNode;
}) {
  const locked = new Set(lockedFieldKeys);

  function renderField(field: ResolvedRecordLayoutField) {
    const error = errors[field.field_key] ?? null;
    if (field.field_source === "custom_field" && field.field_key.startsWith("custom:")) {
      const fieldType = field.field_type as CustomFieldDefinition["field_type"];
      if (!QUICK_CREATE_CUSTOM_FIELD_TYPES.has(fieldType)) return null;
      const fieldKey = field.field_key.slice("custom:".length);
      return (
        <CustomFieldInput
          definition={{
            id: 0,
            module_key: moduleKey,
            field_key: fieldKey,
            label: field.label,
            field_type: fieldType,
            placeholder: field.placeholder,
            help_text: field.help_text,
            is_required: field.required,
            is_active: true,
            sort_order: field.position,
          }}
          value={customValues[fieldKey]}
          onChange={(nextValue) => onCustomChange(fieldKey, nextValue)}
          disabled={field.readonly}
          error={error}
        />
      );
    }

    const resolvedInputId = inputId(field.field_key);
    return renderSystemField(field, {
      inputId: resolvedInputId,
      aria: quickCreateFieldAria(field, resolvedInputId, error),
      error,
      disabled: field.readonly || locked.has(field.field_key),
    });
  }

  return (
    <ResolvedRecordLayout
      layout={layout}
      renderField={renderField}
      viewport={viewport}
      invalidFieldKeys={invalidFieldKeys(errors)}
    />
  );
}
