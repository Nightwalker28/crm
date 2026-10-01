"use client";

import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import RecordTagInput from "@/components/crm/RecordTagInput";
import { OwnerSelect } from "@/components/forms/OwnerSelect";
import type { ResolvedRecordLayoutViewport } from "@/components/forms/ResolvedRecordLayout";
import {
  LayoutDrivenQuickCreateFields,
  type LayoutDrivenQuickCreateFieldContext,
  QuickCreateField,
  makeQuickCreateInputId,
  quickCreateInputType,
  validateLayoutDrivenQuickCreate,
} from "@/components/forms/quickCreateLayout";
import { LEAD_STATUSES, type LeadFormValue } from "@/components/leads/LeadFormFields";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  ResolvedRecordLayout as ResolvedRecordLayoutContract,
  ResolvedRecordLayoutField,
} from "@/hooks/useResolvedRecordLayout";

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

export function validateLeadQuickCreateLayout(
  layout: ResolvedRecordLayoutContract,
  value: LeadFormValue,
  customValues: Record<string, unknown>,
) {
  return validateLayoutDrivenQuickCreate(layout, value, customValues);
}

export const leadQuickCreateInputId = makeQuickCreateInputId("lead-quick-create", "sales_leads");

export function LeadQuickCreateLayoutFields({
  layout,
  value,
  onChange,
  customValues,
  onCustomChange,
  errors = {},
  viewport = "auto",
}: Props) {
  function renderField(
    field: ResolvedRecordLayoutField,
    { inputId, error, aria, disabled }: LayoutDrivenQuickCreateFieldContext,
  ) {
    if (field.field_key === "status") {
      return (
        <QuickCreateField field={field} aria={aria} error={error}>
          <Select
            value={value.status}
            onValueChange={(status) => onChange({ ...value, status })}
            disabled={disabled}
            required={field.required}
          >
            <SelectTrigger id={inputId} className="w-full" aria-invalid={aria.invalid} aria-describedby={aria.describedBy}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEAD_STATUSES.map((status) => (
                <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </QuickCreateField>
      );
    }

    if (field.field_key === "assigned_to") {
      return (
        <QuickCreateField field={field} aria={aria} error={error}>
          <OwnerSelect
            id={inputId}
            label={field.label}
            moduleKey="sales_leads"
            action="create"
            ownerId={value.assigned_to}
            ownerName={value.assigned_to_name}
            onChange={(assigned_to, assigned_to_name) =>
              onChange({ ...value, assigned_to, assigned_to_name })
            }
            disabled={disabled}
            required={field.required}
            placeholder={field.placeholder}
            ariaDescribedBy={aria.describedBy}
            ariaInvalid={aria.invalid}
          />
        </QuickCreateField>
      );
    }

    if (field.field_key === "team_id") {
      return (
        <QuickCreateField field={field} aria={aria} error={error}>
          <LinkedRecordPicker
            inputId={inputId}
            recordType="team"
            valueId={value.team_id}
            displayValue={value.team_name}
            onDisplayValueChange={(team_name) => onChange({ ...value, team_id: null, team_name })}
            onSelect={(option) => onChange({ ...value, team_id: option.id, team_name: option.label })}
            onClear={() => onChange({ ...value, team_id: null, team_name: "" })}
            placeholder={field.placeholder ?? "Search teams (defaults to yours)"}
            disabled={disabled}
            queryKeyPrefix="lead-quick-create-team"
            noResultsText="No teams matched this search."
            sourceModuleKey="sales_leads"
            sourceAction="create"
            ariaDescribedBy={aria.describedBy}
            ariaInvalid={aria.invalid}
          />
        </QuickCreateField>
      );
    }

    if (field.field_key === "tags") {
      return (
        <QuickCreateField field={field} aria={aria} error={error}>
          <RecordTagInput
            inputId={inputId}
            value={value.tags}
            onChange={(tags) => onChange({ ...value, tags })}
            moduleKey="sales_leads"
            action="create"
            disabled={disabled}
            ariaDescribedBy={aria.describedBy}
            ariaInvalid={aria.invalid}
          />
        </QuickCreateField>
      );
    }

    if (field.field_key === "notes") {
      return (
        <QuickCreateField field={field} aria={aria} error={error}>
          <Textarea
            id={inputId}
            required={field.required}
            disabled={disabled}
            aria-invalid={aria.invalid}
            aria-describedby={aria.describedBy}
            rows={3}
            value={value.notes}
            placeholder={field.placeholder ?? ""}
            onChange={(event) => onChange({ ...value, notes: event.target.value })}
          />
        </QuickCreateField>
      );
    }

    const textKeys = ["first_name", "last_name", "company", "primary_email", "phone", "title", "source", "next_follow_up_at"] as const;
    const textKey = textKeys.find((key) => key === field.field_key);
    if (!textKey) return null;
    return (
      <QuickCreateField field={field} aria={aria} error={error}>
        <Input
          id={inputId}
          type={quickCreateInputType(field.field_type)}
          required={field.required}
          disabled={disabled}
          aria-invalid={aria.invalid}
          aria-describedby={aria.describedBy}
          value={value[textKey]}
          placeholder={field.placeholder ?? ""}
          onChange={(event) => onChange({ ...value, [textKey]: event.target.value })}
        />
      </QuickCreateField>
    );
  }

  return (
    <LayoutDrivenQuickCreateFields
      moduleKey="sales_leads"
      layout={layout}
      inputId={leadQuickCreateInputId}
      customValues={customValues}
      onCustomChange={onCustomChange}
      errors={errors}
      viewport={viewport}
      renderSystemField={renderField}
    />
  );
}
