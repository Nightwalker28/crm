"use client";

import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { QuickCreateField, makeQuickCreateInputId, validateLayoutDrivenQuickCreate } from "@/components/forms/quickCreateLayout";
import { RecordForm, type RecordFormFieldContext } from "@/components/forms/RecordForm";
import type { ResolvedRecordLayoutViewport } from "@/components/forms/ResolvedRecordLayout";
import type { OpportunityFormValue } from "@/components/opportunities/OpportunityFormFields";
import { OpportunityStageSelect } from "@/components/opportunities/OpportunityStageSelect";
import type {
  ResolvedRecordLayout as ResolvedRecordLayoutContract,
  ResolvedRecordLayoutField,
} from "@/hooks/useResolvedRecordLayout";

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
  action?: "create" | "edit";
};

export function validateOpportunityQuickCreateLayout(
  layout: ResolvedRecordLayoutContract,
  value: OpportunityFormValue,
  customValues: Record<string, unknown>,
) {
  return validateLayoutDrivenQuickCreate(layout, value, customValues);
}

/**
 * The deal's own controls for `RecordForm`, shared by quick create and the full form: the
 * stage comes from the deal's pipeline, and picking a contact fills the account it belongs to.
 */
export function opportunityFieldRenderer({
  value,
  onChange,
  contactOrganizationFilter = null,
  action = "create",
}: {
  value: OpportunityFormValue;
  onChange: (value: OpportunityFormValue) => void;
  contactOrganizationFilter?: number | null;
  action?: "create" | "edit";
}) {
  return function renderField(field: ResolvedRecordLayoutField, context: RecordFormFieldContext) {
    const { inputId, error, aria, disabled } = context;
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
    if (field.field_key === "contact_id") {
      return (
        <QuickCreateField field={field} aria={aria} error={error}>
          <LinkedRecordPicker
            inputId={inputId}
            recordType="contact"
            valueId={value.contact_id}
            displayValue={value.contact_name}
            onDisplayValueChange={(contact_name) => onChange({ ...value, contact_id: null, contact_name })}
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
            sourceAction={action}
            ariaDescribedBy={aria.describedBy}
            ariaInvalid={aria.invalid}
          />
        </QuickCreateField>
      );
    }
    return undefined;
  };
}

/**
 * Deal forms through `RecordForm` (13b Phase 4e). The deal's own rules stay here: the stage
 * comes from the deal's pipeline, and picking a contact fills the account it belongs to.
 */
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
  action = "create",
}: Props) {
  const renderField = opportunityFieldRenderer({ value, onChange, contactOrganizationFilter, action });

  return (
    <RecordForm
      moduleKey="sales_opportunities"
      layout={layout}
      value={value}
      onChange={onChange}
      customValues={customValues}
      onCustomChange={onCustomChange}
      inputId={opportunityQuickCreateInputId}
      action={action}
      errors={errors}
      lockedFieldKeys={lockedFieldKeys}
      viewport={viewport}
      renderField={renderField}
    />
  );
}
