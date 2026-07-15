"use client";

import CustomFieldInputs from "@/components/customFields/CustomFieldInputs";
import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { FormSection } from "@/components/forms/RecordFormLayout";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { isModuleFieldEnabled, type ModuleFieldConfig } from "@/hooks/useModuleFieldConfigs";
import { COUNTRIES } from "@/lib/countries";

export type OrganizationFormValue = {
  org_name: string;
  primary_email: string;
  secondary_email: string;
  website: string;
  primary_phone: string;
  secondary_phone: string;
  industry: string;
  annual_revenue: string;
  billing_address: string;
  billing_city: string;
  billing_state: string;
  billing_postal_code: string;
  billing_country: string;
  assigned_to: number | null;
  assigned_to_name: string;
};

export const EMPTY_ORGANIZATION_FORM: OrganizationFormValue = {
  org_name: "",
  primary_email: "",
  secondary_email: "",
  website: "",
  primary_phone: "",
  secondary_phone: "",
  industry: "",
  annual_revenue: "",
  billing_address: "",
  billing_city: "",
  billing_state: "",
  billing_postal_code: "",
  billing_country: "",
  assigned_to: null,
  assigned_to_name: "",
};

type CustomFieldDefinition = React.ComponentProps<typeof CustomFieldInputs>["definitions"];
type Props = {
  value: OrganizationFormValue;
  onChange: (value: OrganizationFormValue) => void;
  customFields: CustomFieldDefinition;
  customFieldValues: Record<string, unknown>;
  onCustomFieldChange: (fieldKey: string, value: unknown) => void;
  moduleFields: ModuleFieldConfig[];
  nameError?: string | null;
  emailError?: string | null;
  mode: "create" | "edit";
};

export function OrganizationFormMainFields({ value, onChange, customFields, customFieldValues, onCustomFieldChange, moduleFields, nameError, emailError }: Props) {
  const enabled = (key: string) => isModuleFieldEnabled(moduleFields, key);
  const update = (key: keyof OrganizationFormValue, nextValue: string) => onChange({ ...value, [key]: nextValue });
  return (
    <>
      <FormSection title="Account information" description="Identify the company and its primary commercial profile.">
        <div className="grid gap-4 md:grid-cols-2">
          {enabled("org_name") ? <RequiredTextField id="account-name" label="Account name" value={value.org_name} onChange={(next) => update("org_name", next)} error={nameError} placeholder="Acme Inc." /> : null}
          {enabled("industry") ? <TextField id="account-industry" label="Industry" value={value.industry} onChange={(next) => update("industry", next)} placeholder="Technology" /> : null}
          {enabled("website") ? <TextField id="account-website" label="Website" type="url" value={value.website} onChange={(next) => update("website", next)} placeholder="https://acme.com" /> : null}
          {enabled("annual_revenue") ? <TextField id="account-revenue" label="Annual revenue" value={value.annual_revenue} onChange={(next) => update("annual_revenue", next)} placeholder="$10M - $25M" /> : null}
        </div>
      </FormSection>
      <FormSection title="Contact details" description="Add the shared channels used to reach this account.">
        <div className="grid gap-4 md:grid-cols-2">
          {enabled("primary_email") ? <RequiredTextField id="account-primary-email" label="Primary email" type="email" value={value.primary_email} onChange={(next) => update("primary_email", next)} error={emailError} placeholder="ops@acme.com" /> : null}
          {enabled("secondary_email") ? <TextField id="account-secondary-email" label="Secondary email" type="email" value={value.secondary_email} onChange={(next) => update("secondary_email", next)} /> : null}
          {enabled("primary_phone") ? <TextField id="account-primary-phone" label="Primary phone" type="tel" value={value.primary_phone} onChange={(next) => update("primary_phone", next)} /> : null}
          {enabled("secondary_phone") ? <TextField id="account-secondary-phone" label="Secondary phone" type="tel" value={value.secondary_phone} onChange={(next) => update("secondary_phone", next)} /> : null}
        </div>
      </FormSection>
      <FormSection title="Billing address" description="Keep billing and transaction documents aligned to the correct address.">
        <div className="grid gap-4 md:grid-cols-2">
          {enabled("billing_address") ? <Field className="md:col-span-2"><FieldLabel htmlFor="account-billing-address">Address</FieldLabel><Textarea id="account-billing-address" rows={3} value={value.billing_address} onChange={(event) => update("billing_address", event.target.value)} /></Field> : null}
          {enabled("billing_city") ? <TextField id="account-billing-city" label="City" value={value.billing_city} onChange={(next) => update("billing_city", next)} /> : null}
          {enabled("billing_state") ? <TextField id="account-billing-state" label="State or province" value={value.billing_state} onChange={(next) => update("billing_state", next)} /> : null}
          {enabled("billing_postal_code") ? <TextField id="account-billing-postal" label="Postal code" value={value.billing_postal_code} onChange={(next) => update("billing_postal_code", next)} /> : null}
          {enabled("billing_country") ? <Field><FieldLabel>Country</FieldLabel><Select value={value.billing_country || undefined} onValueChange={(billing_country) => onChange({ ...value, billing_country })}><SelectTrigger><SelectValue placeholder="Select country" /></SelectTrigger><SelectContent className="max-h-72">{COUNTRIES.map((country) => <SelectItem key={country} value={country}>{country}</SelectItem>)}</SelectContent></Select></Field> : null}
        </div>
      </FormSection>
      {customFields.length ? <FormSection title="Custom fields" description="Additional information configured for your workspace."><CustomFieldInputs definitions={customFields} values={customFieldValues} onChange={onCustomFieldChange} /></FormSection> : null}
    </>
  );
}

export function OrganizationFormSidebarFields({ value, onChange, moduleFields, mode }: Pick<Props, "value" | "onChange" | "moduleFields" | "mode">) {
  const enabled = (key: string) => isModuleFieldEnabled(moduleFields, key);
  return (
    <FormSection title="Ownership" description="Assign responsibility for this account.">
      {enabled("assigned_to") ? <Field><FieldLabel>Owner</FieldLabel><LinkedRecordPicker recordType="user" valueId={value.assigned_to} displayValue={value.assigned_to_name} onDisplayValueChange={(assigned_to_name) => onChange({ ...value, assigned_to: null, assigned_to_name })} onSelect={(option) => onChange({ ...value, assigned_to: option.id, assigned_to_name: option.label })} onClear={() => onChange({ ...value, assigned_to: null, assigned_to_name: "" })} placeholder={mode === "create" ? "Search owners (defaults to you)" : "Search owners"} queryKeyPrefix="account-owner" noResultsText="No active users matched this search." sourceModuleKey="sales_organizations" sourceAction={mode} allowClear={mode === "create"} /><FieldDescription>New accounts default to you when no owner is selected.</FieldDescription></Field> : <p className="text-sm text-copy-muted">Ownership is not enabled for this module.</p>}
    </FormSection>
  );
}

function RequiredTextField({ id, label, value, onChange, error, type = "text", placeholder }: { id: string; label: string; value: string; onChange: (value: string) => void; error?: string | null; type?: string; placeholder?: string }) {
  return <Field data-invalid={Boolean(error)}><FieldLabel htmlFor={id}>{label} <RequiredMark /></FieldLabel><Input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} placeholder={placeholder} />{error ? <FieldError>{error}</FieldError> : null}</Field>;
}

function TextField({ id, label, value, onChange, type = "text", placeholder }: { id: string; label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string }) {
  return <Field><FieldLabel htmlFor={id}>{label}</FieldLabel><Input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></Field>;
}
