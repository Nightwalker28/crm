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
import type { ContactFormValue } from "@/components/contacts/ContactFormFields";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CustomFieldDefinition } from "@/hooks/useModuleCustomFields";
import { COUNTRIES } from "@/lib/countries";
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

const REGIONS = ["APAC", "EMEA", "NA", "LATAM"];

const TEXT_FIELD_KEYS = [
  "first_name",
  "last_name",
  "primary_email",
  "contact_telephone",
  "current_title",
  "linkedin_url",
] as const;

export const contactQuickCreateInputId = makeQuickCreateInputId("contact-quick-create", "sales_contacts");

type Props = {
  layout: ResolvedRecordLayoutContract;
  value: ContactFormValue;
  onChange: (value: ContactFormValue) => void;
  customValues: Record<string, unknown>;
  onCustomChange: (fieldKey: string, value: unknown) => void;
  errors?: Record<string, string | null | undefined>;
  /**
   * Relationship keys the calling context already knows. They render read-only with an
   * explanation instead of asking the user to pick something the CRM just told them.
   */
  lockedFieldKeys?: readonly string[];
  viewport?: ResolvedRecordLayoutViewport;
};

function resolvedContactFieldValue(
  field: ResolvedRecordLayoutField,
  value: ContactFormValue,
  customValues: Record<string, unknown>,
) {
  if (field.field_key.startsWith("custom:")) {
    return customValues[field.field_key.slice("custom:".length)];
  }
  if (field.field_key in value) return value[field.field_key as keyof ContactFormValue];
  return undefined;
}

export function validateContactQuickCreateLayout(
  layout: ResolvedRecordLayoutContract,
  value: ContactFormValue,
  customValues: Record<string, unknown>,
) {
  return validateQuickCreateLayout(layout, (field) =>
    resolvedContactFieldValue(field, value, customValues),
  );
}

export function ContactQuickCreateLayoutFields({
  layout,
  value,
  onChange,
  customValues,
  onCustomChange,
  errors = {},
  lockedFieldKeys = [],
  viewport = "auto",
}: Props) {
  const locked = new Set(lockedFieldKeys);

  function renderCustomField(field: ResolvedRecordLayoutField) {
    const fieldType = field.field_type as CustomFieldDefinition["field_type"];
    if (!CUSTOM_FIELD_TYPES.has(fieldType)) return null;
    const fieldKey = field.field_key.slice("custom:".length);
    const definition: CustomFieldDefinition = {
      id: 0,
      module_key: "sales_contacts",
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

    const inputId = contactQuickCreateInputId(field.field_key);
    const error = errors[field.field_key] ?? null;
    const aria = quickCreateFieldAria(field, inputId, error);
    const isLocked = locked.has(field.field_key);
    const disabled = field.readonly || isLocked;

    if (field.field_key === "organization_id") {
      return (
        <QuickCreateField
          field={field}
          aria={aria}
          error={error}
        >
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
            queryKeyPrefix="contact-quick-create-account"
            noResultsText="No accounts matched this search."
            sourceModuleKey="sales_contacts"
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
            queryKeyPrefix="contact-quick-create-owner"
            noResultsText="No active users matched this search."
            sourceModuleKey="sales_contacts"
            sourceAction="create"
            ariaDescribedBy={aria.describedBy}
            ariaInvalid={aria.invalid}
          />
        </QuickCreateField>
      );
    }

    if (field.field_key === "region" || field.field_key === "country") {
      const options = field.field_key === "region" ? REGIONS : COUNTRIES;
      const selected = field.field_key === "region" ? value.region : value.country;
      return (
        <QuickCreateField field={field} aria={aria} error={error}>
          <Select
            value={selected || undefined}
            onValueChange={(next) => onChange({ ...value, [field.field_key]: next })}
            disabled={disabled}
            required={field.required}
          >
            <SelectTrigger
              id={inputId}
              className="w-full"
              aria-invalid={aria.invalid}
              aria-describedby={aria.describedBy}
            >
              <SelectValue placeholder={`Select ${field.label.toLocaleLowerCase()}`} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {options.map((option) => (
                <SelectItem key={option} value={option}>{option}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </QuickCreateField>
      );
    }

    if (field.field_key === "email_opt_out") {
      return (
        <QuickCreateField field={field} aria={aria} error={error}>
          <label className="flex items-start gap-3 text-sm text-copy-secondary">
            <Checkbox
              id={inputId}
              checked={value.email_opt_out}
              onCheckedChange={(checked) => onChange({ ...value, email_opt_out: checked === true })}
              disabled={disabled} className="mt-0.5"
              aria-describedby={aria.describedBy}
            />
            <span>Prevent routine marketing email actions for this contact.</span>
          </label>
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
