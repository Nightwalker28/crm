"use client";

import { CustomFieldInput } from "@/components/customFields/CustomFieldInputs";
import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import RecordTagInput from "@/components/crm/RecordTagInput";
import {
  ResolvedRecordLayout,
  type ResolvedRecordLayoutViewport,
} from "@/components/forms/ResolvedRecordLayout";
import { LEAD_STATUSES, type LeadFormValue } from "@/components/leads/LeadFormFields";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CustomFieldDefinition } from "@/hooks/useModuleCustomFields";
import type {
  ResolvedRecordLayout as ResolvedRecordLayoutContract,
  ResolvedRecordLayoutField,
} from "@/hooks/useResolvedRecordLayout";

const CUSTOM_FIELD_TYPES = new Set<CustomFieldDefinition["field_type"]>([
  "text",
  "long_text",
  "number",
  "date",
  "boolean",
]);

type Props = {
  layout: ResolvedRecordLayoutContract;
  value: LeadFormValue;
  onChange: (value: LeadFormValue) => void;
  customValues: Record<string, unknown>;
  onCustomChange: (fieldKey: string, value: unknown) => void;
  errors?: Record<string, string | null | undefined>;
  /** Only the layout builder sets this, to preview the narrow-screen result. */
  viewport?: ResolvedRecordLayoutViewport;
};

function resolvedLeadFieldValue(
  field: ResolvedRecordLayoutField,
  value: LeadFormValue,
  customValues: Record<string, unknown>,
) {
  if (field.field_key.startsWith("custom:")) {
    return customValues[field.field_key.slice("custom:".length)];
  }
  if (field.field_key in value) return value[field.field_key as keyof LeadFormValue];
  return undefined;
}

function isEmptyRequiredValue(value: unknown) {
  return value === null
    || value === undefined
    || (typeof value === "string" && !value.trim())
    || (Array.isArray(value) && value.length === 0);
}

export function validateLeadQuickCreateLayout(
  layout: ResolvedRecordLayoutContract,
  value: LeadFormValue,
  customValues: Record<string, unknown>,
) {
  const errors: Record<string, string> = {};
  for (const section of [...layout.sections].sort((left, right) => left.position - right.position)) {
    for (const field of [...section.fields].sort((left, right) => left.position - right.position)) {
      if (!field.visible || !field.required || field.readonly) continue;
      if (isEmptyRequiredValue(resolvedLeadFieldValue(field, value, customValues))) {
        errors[field.field_key] = `${field.label} is required.`;
      }
    }
  }
  return errors;
}

export function leadQuickCreateInputId(fieldKey: string) {
  return fieldKey.startsWith("custom:")
    ? `custom-field-sales_leads-${fieldKey.slice("custom:".length)}`
    : `lead-quick-create-${fieldKey}`;
}

export function LeadQuickCreateLayoutFields({
  layout,
  value,
  onChange,
  customValues,
  onCustomChange,
  errors = {},
  viewport = "auto",
}: Props) {
  function renderCustomField(field: ResolvedRecordLayoutField) {
    const fieldType = field.field_type as CustomFieldDefinition["field_type"];
    if (!CUSTOM_FIELD_TYPES.has(fieldType)) return null;
    const fieldKey = field.field_key.slice("custom:".length);
    const definition: CustomFieldDefinition = {
      id: 0,
      module_key: "sales_leads",
      field_key: fieldKey,
      label: field.label,
      field_type: fieldType,
      placeholder: field.placeholder,
      help_text: field.help_text,
      is_required: field.required,
      is_active: true,
      sort_order: field.position,
    };
    return (
      <CustomFieldInput
        definition={definition}
        value={customValues[fieldKey]}
        onChange={(nextValue) => onCustomChange(fieldKey, nextValue)}
        disabled={field.readonly}
        error={errors[field.field_key]}
      />
    );
  }

  function renderField(field: ResolvedRecordLayoutField) {
    if (field.field_source === "custom_field" && field.field_key.startsWith("custom:")) {
      return renderCustomField(field);
    }

    const inputId = leadQuickCreateInputId(field.field_key);
    const error = errors[field.field_key];
    const descriptionId = field.help_text ? `${inputId}-description` : undefined;
    const errorId = error ? `${inputId}-error` : undefined;
    const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;
    const requiredMark = field.required ? <RequiredMark /> : null;
    const commonInputProps = {
      id: inputId,
      required: field.required,
      disabled: field.readonly,
      "aria-invalid": Boolean(error),
      "aria-describedby": describedBy,
    };

    if (field.field_key === "status") {
      return (
        <Field data-invalid={Boolean(error)}>
          <FieldLabel htmlFor={inputId}>{field.label} {requiredMark}</FieldLabel>
          <Select
            value={value.status}
            onValueChange={(status) => onChange({ ...value, status })}
            disabled={field.readonly}
            required={field.required}
          >
            <SelectTrigger id={inputId} className="w-full" aria-invalid={Boolean(error)} aria-describedby={describedBy}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEAD_STATUSES.map((status) => (
                <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {error ? <FieldError id={errorId}>{error}</FieldError> : null}
        </Field>
      );
    }

    if (field.field_key === "assigned_to") {
      return (
        <Field data-invalid={Boolean(error)}>
          <FieldLabel htmlFor={inputId}>{field.label} {requiredMark}</FieldLabel>
          <LinkedRecordPicker
            inputId={inputId}
            recordType="user"
            valueId={value.assigned_to}
            displayValue={value.assigned_to_name}
            onDisplayValueChange={(assigned_to_name) => onChange({ ...value, assigned_to: null, assigned_to_name })}
            onSelect={(option) => onChange({ ...value, assigned_to: option.id, assigned_to_name: option.label })}
            onClear={() => onChange({ ...value, assigned_to: null, assigned_to_name: "" })}
            placeholder={field.placeholder ?? "Search owners (defaults to you)"}
            disabled={field.readonly}
            queryKeyPrefix="lead-quick-create-owner"
            noResultsText="No active users matched this search."
            sourceModuleKey="sales_leads"
            sourceAction="create"
            ariaDescribedBy={describedBy}
            ariaInvalid={Boolean(error)}
          />
          {field.help_text ? <FieldDescription id={`${inputId}-description`}>{field.help_text}</FieldDescription> : null}
          {error ? <FieldError id={`${inputId}-error`}>{error}</FieldError> : null}
        </Field>
      );
    }

    if (field.field_key === "team_id") {
      return (
        <Field data-invalid={Boolean(error)}>
          <FieldLabel htmlFor={inputId}>{field.label} {requiredMark}</FieldLabel>
          <LinkedRecordPicker
            inputId={inputId}
            recordType="team"
            valueId={value.team_id}
            displayValue={value.team_name}
            onDisplayValueChange={(team_name) => onChange({ ...value, team_id: null, team_name })}
            onSelect={(option) => onChange({ ...value, team_id: option.id, team_name: option.label })}
            onClear={() => onChange({ ...value, team_id: null, team_name: "" })}
            placeholder={field.placeholder ?? "Search teams (defaults to yours)"}
            disabled={field.readonly}
            queryKeyPrefix="lead-quick-create-team"
            noResultsText="No teams matched this search."
            sourceModuleKey="sales_leads"
            sourceAction="create"
            ariaDescribedBy={describedBy}
            ariaInvalid={Boolean(error)}
          />
          {error ? <FieldError id={`${inputId}-error`}>{error}</FieldError> : null}
        </Field>
      );
    }

    if (field.field_key === "tags") {
      return (
        <Field data-invalid={Boolean(error)}>
          <FieldLabel htmlFor={inputId}>{field.label} {requiredMark}</FieldLabel>
          <RecordTagInput
            inputId={inputId}
            value={value.tags}
            onChange={(tags) => onChange({ ...value, tags })}
            moduleKey="sales_leads"
            action="create"
            disabled={field.readonly}
            ariaDescribedBy={describedBy}
            ariaInvalid={Boolean(error)}
          />
          {error ? <FieldError id={`${inputId}-error`}>{error}</FieldError> : null}
        </Field>
      );
    }

    if (field.field_key === "notes") {
      return (
        <Field data-invalid={Boolean(error)}>
          <FieldLabel htmlFor={inputId}>{field.label} {requiredMark}</FieldLabel>
          <Textarea
            {...commonInputProps}
            rows={3}
            value={value.notes}
            placeholder={field.placeholder ?? ""}
            onChange={(event) => onChange({ ...value, notes: event.target.value })}
          />
          {field.help_text ? <FieldDescription id={`${inputId}-description`}>{field.help_text}</FieldDescription> : null}
          {error ? <FieldError id={errorId}>{error}</FieldError> : null}
        </Field>
      );
    }

    const textKeys = ["first_name", "last_name", "company", "primary_email", "phone", "title", "source", "next_follow_up_at"] as const;
    const textKey = textKeys.find((key) => key === field.field_key);
    if (!textKey) return null;
    const inputType = field.field_type === "email"
      ? "email"
      : field.field_type === "phone"
        ? "tel"
        : field.field_type === "datetime"
          ? "datetime-local"
          : "text";
    return (
      <Field data-invalid={Boolean(error)}>
        <FieldLabel htmlFor={inputId}>{field.label} {requiredMark}</FieldLabel>
        <Input
          {...commonInputProps}
          type={inputType}
          value={value[textKey]}
          placeholder={field.placeholder ?? ""}
          onChange={(event) => onChange({ ...value, [textKey]: event.target.value })}
        />
        {field.help_text ? <FieldDescription id={`${inputId}-description`}>{field.help_text}</FieldDescription> : null}
        {error ? <FieldError id={errorId}>{error}</FieldError> : null}
      </Field>
    );
  }

  return (
    <ResolvedRecordLayout
      layout={layout}
      renderField={renderField}
      viewport={viewport}
      invalidFieldKeys={Object.entries(errors).filter(([, error]) => Boolean(error)).map(([fieldKey]) => fieldKey)}
    />
  );
}
