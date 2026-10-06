"use client";

import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { OwnerSelect } from "@/components/forms/OwnerSelect";
import {
  LayoutDrivenQuickCreateFields,
  type LayoutDrivenQuickCreateFieldContext,
  QuickCreateField,
  QuickCreatePicklistField,
  makeQuickCreateInputId,
  quickCreateInputType,
  validateLayoutDrivenQuickCreate,
} from "@/components/forms/quickCreateLayout";
import type { OpportunityFormValue } from "@/components/opportunities/OpportunityFormFields";
import { OpportunityStageSelect } from "@/components/opportunities/OpportunityStageSelect";
import { FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ResolvedRecordLayoutViewport } from "@/components/forms/ResolvedRecordLayout";
import type {
  ResolvedRecordLayout as ResolvedRecordLayoutContract,
  ResolvedRecordLayoutField,
} from "@/hooks/useResolvedRecordLayout";

const TEXT_FIELD_KEYS = ["opportunity_name", "expected_close_date", "amount", "next_step"] as const;

export const opportunityQuickCreateInputId = makeQuickCreateInputId(
  "deal-quick-create",
  "sales_opportunities",
);

type Props = {
  layout: ResolvedRecordLayoutContract;
  value: OpportunityFormValue;
  onChange: (value: OpportunityFormValue) => void;
  customValues: Record<string, unknown>;
  onCustomChange: (fieldKey: string, value: unknown) => void;
  errors?: Record<string, string | null | undefined>;
  /** Relationship keys the source record already established. Shown, but not re-asked. */
  lockedFieldKeys?: readonly string[];
  /** Restricts the contact picker to one account when the deal was started from it. */
  contactOrganizationFilter?: number | null;
  viewport?: ResolvedRecordLayoutViewport;
};

export function validateOpportunityQuickCreateLayout(
  layout: ResolvedRecordLayoutContract,
  value: OpportunityFormValue,
  customValues: Record<string, unknown>,
) {
  return validateLayoutDrivenQuickCreate(layout, value, customValues);
}

export function OpportunityQuickCreateLayoutFields({
  layout,
  value,
  onChange,
  customValues,
  onCustomChange,
  errors = {},
  lockedFieldKeys = [],
  contactOrganizationFilter = null,
  viewport = "auto",
}: Props) {
  function renderField(
    field: ResolvedRecordLayoutField,
    { inputId, error, aria, disabled }: LayoutDrivenQuickCreateFieldContext,
  ) {
    if (field.field_key === "contact_id") {
      return (
        <QuickCreateField field={field} aria={aria} error={error}>
          <LinkedRecordPicker
            inputId={inputId}
            recordType="contact"
            valueId={value.contact_id}
            displayValue={value.contact_name}
            onDisplayValueChange={(contact_name) =>
              onChange({ ...value, contact_id: null, contact_name })
            }
            onSelect={(option) =>
              onChange({
                ...value,
                contact_id: option.id,
                contact_name: option.label,
                // Picking a contact fills the account it already belongs to, unless the
                // surface was opened from an account that already set one.
                organization_id: value.organization_id ?? option.organization_id ?? null,
                organization_name: value.organization_id
                  ? value.organization_name
                  : option.organization_name ?? value.organization_name,
              })
            }
            onClear={() => onChange({ ...value, contact_id: null, contact_name: "" })}
            placeholder={field.placeholder ?? "Search contacts"}
            disabled={disabled}
            filters={contactOrganizationFilter ? { organizationId: contactOrganizationFilter } : undefined}
            queryKeyPrefix="deal-quick-create-contact"
            noResultsText={
              contactOrganizationFilter
                ? "No contacts on this account matched this search."
                : "No contacts matched this search."
            }
            sourceModuleKey="sales_opportunities"
            sourceAction="create"
            ariaDescribedBy={aria.describedBy}
            ariaInvalid={aria.invalid}
          />
          {!field.help_text && !error ? (
            <FieldDescription>Every deal stays linked to an existing contact.</FieldDescription>
          ) : null}
        </QuickCreateField>
      );
    }

    if (field.field_key === "organization_id") {
      return (
        <QuickCreateField field={field} aria={aria} error={error}>
          <LinkedRecordPicker
            inputId={inputId}
            recordType="organization"
            valueId={value.organization_id}
            displayValue={value.organization_name}
            onDisplayValueChange={(organization_name) =>
              onChange({ ...value, organization_id: null, organization_name })
            }
            onSelect={(option) =>
              onChange({ ...value, organization_id: option.id, organization_name: option.label })
            }
            onClear={() => onChange({ ...value, organization_id: null, organization_name: "" })}
            placeholder={field.placeholder ?? "Search accounts"}
            disabled={disabled}
            queryKeyPrefix="deal-quick-create-account"
            noResultsText="No accounts matched this search."
            sourceModuleKey="sales_opportunities"
            sourceAction="create"
            ariaDescribedBy={aria.describedBy}
            ariaInvalid={aria.invalid}
          />
        </QuickCreateField>
      );
    }

    if (field.field_key === "assigned_to") {
      return (
        <QuickCreateField field={field} aria={aria} error={error}>
          <OwnerSelect
            id={inputId}
            label={field.label}
            moduleKey="sales_opportunities"
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

    if (field.field_key === "sales_stage") {
      return (
        <QuickCreateField field={field} aria={aria} error={error}>
          <OpportunityStageSelect
            id={inputId}
            value={value.sales_stage}
            onChange={(sales_stage) => onChange({ ...value, sales_stage })}
            disabled={disabled}
            required={field.required}
            className="w-full"
            ariaInvalid={aria.invalid}
            ariaDescribedBy={aria.describedBy}
          />
        </QuickCreateField>
      );
    }

    if (field.field_key === "deal_type" || field.field_key === "source" || field.field_key === "lost_reason") {
      const key = field.field_key;
      return (
        <QuickCreatePicklistField field={field} context={{ inputId, error, aria, disabled }} value={value[key]}
          onChange={(next) => onChange({ ...value, [key]: next })} />
      );
    }

    const textKey = TEXT_FIELD_KEYS.find((key) => key === field.field_key);
    if (!textKey) return null;
    return (
      <QuickCreateField field={field} aria={aria} error={error}>
        <Input
          id={inputId}
          type={quickCreateInputType(field.field_type)}
          inputMode={textKey === "amount" ? "decimal" : undefined}
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
      moduleKey="sales_opportunities"
      layout={layout}
      inputId={opportunityQuickCreateInputId}
      customValues={customValues}
      onCustomChange={onCustomChange}
      errors={errors}
      lockedFieldKeys={lockedFieldKeys}
      viewport={viewport}
      renderSystemField={renderField}
    />
  );
}
