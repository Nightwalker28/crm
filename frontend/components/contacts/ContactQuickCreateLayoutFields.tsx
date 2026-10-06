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
import type { ContactFormValue } from "@/components/contacts/ContactFormFields";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type {
  ResolvedRecordLayout as ResolvedRecordLayoutContract,
  ResolvedRecordLayoutField,
} from "@/hooks/useResolvedRecordLayout";
import type { ResolvedRecordLayoutViewport } from "@/components/forms/ResolvedRecordLayout";


const TEXT_FIELD_KEYS = [
  "first_name",
  "last_name",
  "primary_email",
  "contact_telephone",
  "mobile_phone",
  "current_title",
  "linkedin_url",
  "mailing_address",
  "mailing_street2",
  "mailing_city",
  "mailing_state",
  "mailing_postal_code",
] as const;

const PICKLIST_FIELD_KEYS = ["salutation", "region", "country"] as const;

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

export function validateContactQuickCreateLayout(
  layout: ResolvedRecordLayoutContract,
  value: ContactFormValue,
  customValues: Record<string, unknown>,
) {
  return validateLayoutDrivenQuickCreate(layout, value, customValues);
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
  function renderField(
    field: ResolvedRecordLayoutField,
    { inputId, error, aria, disabled }: LayoutDrivenQuickCreateFieldContext,
  ) {
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
          <OwnerSelect
            id={inputId}
            label={field.label}
            moduleKey="sales_contacts"
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

    const picklistKey = PICKLIST_FIELD_KEYS.find((key) => key === field.field_key);
    if (picklistKey) {
      const key = picklistKey;
      return (
        <QuickCreatePicklistField
          field={field}
          context={{ inputId, error, aria, disabled }}
          value={value[key]}
          onChange={(next) => onChange({ ...value, [key]: next })}
        />
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
    <LayoutDrivenQuickCreateFields
      moduleKey="sales_contacts"
      layout={layout}
      inputId={contactQuickCreateInputId}
      customValues={customValues}
      onCustomChange={onCustomChange}
      errors={errors}
      lockedFieldKeys={lockedFieldKeys}
      viewport={viewport}
      renderSystemField={renderField}
    />
  );
}
