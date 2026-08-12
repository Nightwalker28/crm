"use client";

import { CustomFieldInput } from "@/components/customFields/CustomFieldInputs";
import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import {
  ResolvedRecordLayout,
  type ResolvedRecordLayoutViewport,
} from "@/components/forms/ResolvedRecordLayout";
import {
  QuickCreateField,
  invalidFieldKeys,
  makeQuickCreateInputId,
  quickCreateFieldAria,
  quickCreateInputType,
  validateQuickCreateLayout,
} from "@/components/forms/quickCreateLayout";
import type { OpportunityFormValue } from "@/components/opportunities/OpportunityFormFields";
import {
  getOpportunityStageLabel,
  OPPORTUNITY_STAGE_ORDER,
} from "@/components/opportunities/opportunityStages";
import { FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

const TEXT_FIELD_KEYS = ["opportunity_name", "expected_close_date", "total_cost_of_project"] as const;

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

function resolvedOpportunityFieldValue(
  field: ResolvedRecordLayoutField,
  value: OpportunityFormValue,
  customValues: Record<string, unknown>,
) {
  if (field.field_key.startsWith("custom:")) {
    return customValues[field.field_key.slice("custom:".length)];
  }
  if (field.field_key in value) return value[field.field_key as keyof OpportunityFormValue];
  return undefined;
}

export function validateOpportunityQuickCreateLayout(
  layout: ResolvedRecordLayoutContract,
  value: OpportunityFormValue,
  customValues: Record<string, unknown>,
) {
  return validateQuickCreateLayout(layout, (field) =>
    resolvedOpportunityFieldValue(field, value, customValues),
  );
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
  const locked = new Set(lockedFieldKeys);

  function renderCustomField(field: ResolvedRecordLayoutField) {
    const fieldType = field.field_type as CustomFieldDefinition["field_type"];
    if (!CUSTOM_FIELD_TYPES.has(fieldType)) return null;
    const fieldKey = field.field_key.slice("custom:".length);
    const definition: CustomFieldDefinition = {
      id: 0,
      module_key: "sales_opportunities",
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

    const inputId = opportunityQuickCreateInputId(field.field_key);
    const error = errors[field.field_key] ?? null;
    const aria = quickCreateFieldAria(field, inputId, error);
    const isLocked = locked.has(field.field_key);
    const disabled = field.readonly || isLocked;

    if (field.field_key === "contact_id") {
      return (
        <QuickCreateField field={field} aria={aria} error={error}>
          <LinkedRecordPicker
            inputId={inputId}
            recordType="contact"
            valueId={value.contact_id}
            displayValue={value.contact_name}
            onDisplayValueChange={(contact_name) =>
              onChange({ ...value, contact_id: null, contact_name, client: contact_name })
            }
            onSelect={(option) =>
              onChange({
                ...value,
                contact_id: option.id,
                contact_name: option.label,
                client: option.label,
                // Picking a contact fills the account it already belongs to, unless the
                // surface was opened from an account that already set one.
                organization_id: value.organization_id ?? option.organization_id ?? null,
                organization_name: value.organization_id
                  ? value.organization_name
                  : option.organization_name ?? value.organization_name,
              })
            }
            onClear={() => onChange({ ...value, contact_id: null, contact_name: "", client: "" })}
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
          <LinkedRecordPicker
            inputId={inputId}
            recordType="user"
            valueId={value.assigned_to}
            displayValue={value.assigned_to_name}
            onDisplayValueChange={(assigned_to_name) =>
              onChange({ ...value, assigned_to: null, assigned_to_name })
            }
            onSelect={(option) =>
              onChange({ ...value, assigned_to: option.id, assigned_to_name: option.label })
            }
            onClear={() => onChange({ ...value, assigned_to: null, assigned_to_name: "" })}
            placeholder={field.placeholder ?? "Search owners (defaults to you)"}
            disabled={disabled}
            queryKeyPrefix="deal-quick-create-owner"
            noResultsText="No active users matched this search."
            sourceModuleKey="sales_opportunities"
            sourceAction="create"
            ariaDescribedBy={aria.describedBy}
            ariaInvalid={aria.invalid}
          />
        </QuickCreateField>
      );
    }

    if (field.field_key === "sales_stage") {
      return (
        <QuickCreateField field={field} aria={aria} error={error}>
          <Select
            value={value.sales_stage || "lead"}
            onValueChange={(sales_stage) => onChange({ ...value, sales_stage })}
            disabled={disabled}
            required={field.required}
          >
            <SelectTrigger
              id={inputId}
              className="w-full"
              aria-invalid={aria.invalid}
              aria-describedby={aria.describedBy}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPPORTUNITY_STAGE_ORDER.map((stage) => (
                <SelectItem key={stage} value={stage}>{getOpportunityStageLabel(stage)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </QuickCreateField>
      );
    }

    const textKey = TEXT_FIELD_KEYS.find((key) => key === field.field_key);
    if (!textKey) return null;
    return (
      <QuickCreateField field={field} aria={aria} error={error}>
        <Input
          id={inputId}
          type={quickCreateInputType(field.field_type)}
          inputMode={textKey === "total_cost_of_project" ? "decimal" : undefined}
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
    <ResolvedRecordLayout
      layout={layout}
      renderField={renderField}
      viewport={viewport}
      invalidFieldKeys={invalidFieldKeys(errors)}
    />
  );
}
