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
import type { OrganizationFormValue } from "@/components/organizations/OrganizationFormFields";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CustomFieldDefinition } from "@/hooks/useModuleCustomFields";
import type {
  ResolvedRecordLayout as ResolvedRecordLayoutContract,
  ResolvedRecordLayoutField,
} from "@/hooks/useResolvedRecordLayout";
import { COUNTRIES } from "@/lib/countries";

const CUSTOM_FIELD_TYPES = new Set<CustomFieldDefinition["field_type"]>([
  "text",
  "long_text",
  "number",
  "date",
  "boolean",
]);

const TEXT_FIELD_KEYS = [
  "org_name",
  "primary_email",
  "secondary_email",
  "primary_phone",
  "secondary_phone",
  "website",
  "industry",
  "annual_revenue",
  "billing_city",
  "billing_state",
  "billing_postal_code",
] as const;

export const organizationQuickCreateInputId = makeQuickCreateInputId(
  "account-quick-create",
  "sales_organizations",
);

type Props = {
  layout: ResolvedRecordLayoutContract;
  value: OrganizationFormValue;
  onChange: (value: OrganizationFormValue) => void;
  customValues: Record<string, unknown>;
  onCustomChange: (fieldKey: string, value: unknown) => void;
  errors?: Record<string, string | null | undefined>;
  viewport?: ResolvedRecordLayoutViewport;
};

function resolvedOrganizationFieldValue(
  field: ResolvedRecordLayoutField,
  value: OrganizationFormValue,
  customValues: Record<string, unknown>,
) {
  if (field.field_key.startsWith("custom:")) {
    return customValues[field.field_key.slice("custom:".length)];
  }
  if (field.field_key in value) return value[field.field_key as keyof OrganizationFormValue];
  return undefined;
}

export function validateOrganizationQuickCreateLayout(
  layout: ResolvedRecordLayoutContract,
  value: OrganizationFormValue,
  customValues: Record<string, unknown>,
) {
  return validateQuickCreateLayout(layout, (field) =>
    resolvedOrganizationFieldValue(field, value, customValues),
  );
}

export function OrganizationQuickCreateLayoutFields({
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
      module_key: "sales_organizations",
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

    const inputId = organizationQuickCreateInputId(field.field_key);
    const error = errors[field.field_key] ?? null;
    const aria = quickCreateFieldAria(field, inputId, error);

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
            disabled={field.readonly}
            queryKeyPrefix="account-quick-create-owner"
            noResultsText="No active users matched this search."
            sourceModuleKey="sales_organizations"
            sourceAction="create"
            ariaDescribedBy={aria.describedBy}
            ariaInvalid={aria.invalid}
          />
        </QuickCreateField>
      );
    }

    if (field.field_key === "billing_country") {
      return (
        <QuickCreateField field={field} aria={aria} error={error}>
          <Select
            value={value.billing_country || undefined}
            onValueChange={(billing_country) => onChange({ ...value, billing_country })}
            disabled={field.readonly}
            required={field.required}
          >
            <SelectTrigger
              id={inputId}
              className="w-full"
              aria-invalid={aria.invalid}
              aria-describedby={aria.describedBy}
            >
              <SelectValue placeholder="Select country" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {COUNTRIES.map((country) => (
                <SelectItem key={country} value={country}>{country}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </QuickCreateField>
      );
    }

    if (field.field_key === "billing_address") {
      return (
        <QuickCreateField field={field} aria={aria} error={error}>
          <Textarea
            id={inputId}
            rows={3}
            required={field.required}
            disabled={field.readonly}
            aria-invalid={aria.invalid}
            aria-describedby={aria.describedBy}
            value={value.billing_address}
            placeholder={field.placeholder ?? ""}
            onChange={(event) => onChange({ ...value, billing_address: event.target.value })}
          />
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
          required={field.required}
          disabled={field.readonly}
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
