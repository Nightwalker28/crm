"use client";

import { OwnerSelect } from "@/components/forms/OwnerSelect";
import {
  LayoutDrivenQuickCreateFields,
  type LayoutDrivenQuickCreateFieldContext,
  QuickCreateField,
  makeQuickCreateInputId,
  quickCreateInputType,
  validateLayoutDrivenQuickCreate,
} from "@/components/forms/quickCreateLayout";
import type { OrganizationFormValue } from "@/components/organizations/OrganizationFormFields";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ResolvedRecordLayoutViewport } from "@/components/forms/ResolvedRecordLayout";
import type {
  ResolvedRecordLayout as ResolvedRecordLayoutContract,
  ResolvedRecordLayoutField,
} from "@/hooks/useResolvedRecordLayout";
import { COUNTRIES } from "@/lib/countries";

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

export function validateOrganizationQuickCreateLayout(
  layout: ResolvedRecordLayoutContract,
  value: OrganizationFormValue,
  customValues: Record<string, unknown>,
) {
  return validateLayoutDrivenQuickCreate(layout, value, customValues);
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
  function renderField(
    field: ResolvedRecordLayoutField,
    { inputId, error, aria, disabled }: LayoutDrivenQuickCreateFieldContext,
  ) {
    if (field.field_key === "assigned_to") {
      return (
        <QuickCreateField field={field} aria={aria} error={error}>
          <OwnerSelect
            id={inputId}
            label={field.label}
            moduleKey="sales_organizations"
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

    if (field.field_key === "billing_country") {
      return (
        <QuickCreateField field={field} aria={aria} error={error}>
          <Select
            value={value.billing_country || undefined}
            onValueChange={(billing_country) => onChange({ ...value, billing_country })}
            disabled={disabled}
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
            disabled={disabled}
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
      moduleKey="sales_organizations"
      layout={layout}
      inputId={organizationQuickCreateInputId}
      customValues={customValues}
      onCustomChange={onCustomChange}
      errors={errors}
      viewport={viewport}
      renderSystemField={renderField}
    />
  );
}
