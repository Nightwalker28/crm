"use client";

import CustomFieldInputs from "@/components/customFields/CustomFieldInputs";
import { OwnerSelect } from "@/components/forms/OwnerSelect";
import { FormSection } from "@/components/forms/RecordFormLayout";
import { TextField } from "@/components/forms/TextField";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch, SwitchThumb } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { isModuleFieldEnabled, type ModuleFieldConfig } from "@/hooks/useModuleFieldConfigs";
import { COUNTRIES } from "@/lib/countries";
import { inputIdLookup, ServerFieldError } from "@/components/forms/ServerFieldErrors";

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
  /** We buy from this account (E4). The same company can be a customer too. */
  is_vendor: boolean;
  /** Days to pay (E5): sets due dates on its invoices and bills. Blank uses the company default. */
  payment_terms_days: string;
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
  is_vendor: false,
  payment_terms_days: "",
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

/** Payload field → input id, for the server's field errors (H2). */
export const ORGANIZATION_FORM_INPUT_IDS: Record<string, string> = {
  org_name: "account-name",
  industry: "account-industry",
  website: "account-website",
  annual_revenue: "account-revenue",
  primary_email: "account-primary-email",
  secondary_email: "account-secondary-email",
  primary_phone: "account-primary-phone",
  secondary_phone: "account-secondary-phone",
  billing_address: "account-billing-address",
  billing_city: "account-billing-city",
  billing_state: "account-billing-state",
  billing_postal_code: "account-billing-postal",
  billing_country: "account-country",
  assigned_to: "account-owner",
  payment_terms_days: "account-payment-terms",
};
export const organizationFormInputIdFor = inputIdLookup("sales_organizations", ORGANIZATION_FORM_INPUT_IDS);

export function OrganizationFormMainFields({ value, onChange, customFields, customFieldValues, onCustomFieldChange, moduleFields, nameError, emailError }: Props) {
  const enabled = (key: string) => isModuleFieldEnabled(moduleFields, key);
  const update = (key: keyof OrganizationFormValue, nextValue: string) => onChange({ ...value, [key]: nextValue });
  return (
    <>
      <FormSection title="Account information" description="Identify the company and its primary commercial profile.">
        <FieldGroup columns={2}>
          {enabled("org_name") ? <TextField id="account-name" label="Account name" required value={value.org_name} onChange={(next) => update("org_name", next)} error={nameError} placeholder="Acme Inc." /> : null}
          {enabled("industry") ? <TextField id="account-industry" label="Industry" value={value.industry} onChange={(next) => update("industry", next)} placeholder="Technology" /> : null}
          {enabled("website") ? <TextField id="account-website" label="Website" type="url" value={value.website} onChange={(next) => update("website", next)} placeholder="https://acme.com" /> : null}
          {enabled("annual_revenue") ? <TextField id="account-revenue" label="Annual revenue" value={value.annual_revenue} onChange={(next) => update("annual_revenue", next)} placeholder="$10M - $25M" /> : null}
        </FieldGroup>
      </FormSection>
      <FormSection title="Contact details" description="Add the shared channels used to reach this account.">
        <FieldGroup columns={2}>
          {enabled("primary_email") ? <TextField id="account-primary-email" label="Primary email" required type="email" value={value.primary_email} onChange={(next) => update("primary_email", next)} error={emailError} placeholder="ops@acme.com" /> : null}
          {enabled("secondary_email") ? <TextField id="account-secondary-email" label="Secondary email" type="email" value={value.secondary_email} onChange={(next) => update("secondary_email", next)} /> : null}
          {enabled("primary_phone") ? <TextField id="account-primary-phone" label="Primary phone" type="tel" value={value.primary_phone} onChange={(next) => update("primary_phone", next)} /> : null}
          {enabled("secondary_phone") ? <TextField id="account-secondary-phone" label="Secondary phone" type="tel" value={value.secondary_phone} onChange={(next) => update("secondary_phone", next)} /> : null}
        </FieldGroup>
      </FormSection>
      <FormSection title="Billing address" description="Keep billing and transaction documents aligned to the correct address.">
        <FieldGroup columns={2}>
          {enabled("billing_address") ? <Field className="md:col-span-2"><FieldLabel htmlFor="account-billing-address">Address</FieldLabel><Textarea id="account-billing-address" rows={3} value={value.billing_address} onChange={(event) => update("billing_address", event.target.value)} /><ServerFieldError inputId="account-billing-address" /></Field> : null}
          {enabled("billing_city") ? <TextField id="account-billing-city" label="City" value={value.billing_city} onChange={(next) => update("billing_city", next)} /> : null}
          {enabled("billing_state") ? <TextField id="account-billing-state" label="State or province" value={value.billing_state} onChange={(next) => update("billing_state", next)} /> : null}
          {enabled("billing_postal_code") ? <TextField id="account-billing-postal" label="Postal code" value={value.billing_postal_code} onChange={(next) => update("billing_postal_code", next)} /> : null}
          {enabled("billing_country") ? <Field><FieldLabel htmlFor="account-country">Country</FieldLabel><Select value={value.billing_country || undefined} onValueChange={(billing_country) => onChange({ ...value, billing_country })}><SelectTrigger id="account-country"><SelectValue placeholder="Select country" /></SelectTrigger><SelectContent className="max-h-72">{COUNTRIES.map((country) => <SelectItem key={country} value={country}>{country}</SelectItem>)}</SelectContent></Select><ServerFieldError inputId="account-country" /></Field> : null}
        </FieldGroup>
      </FormSection>
      {customFields.length ? <FormSection title="Custom fields" description="Additional information configured for your workspace."><CustomFieldInputs definitions={customFields} values={customFieldValues} onChange={onCustomFieldChange} /></FormSection> : null}
    </>
  );
}

export function OrganizationFormSidebarFields({ value, onChange, moduleFields, mode }: Pick<Props, "value" | "onChange" | "moduleFields" | "mode">) {
  const enabled = (key: string) => isModuleFieldEnabled(moduleFields, key);
  return (
    <>
      <FormSection title="Ownership" description="Assign responsibility for this account.">
        {enabled("assigned_to") ? <Field><FieldLabel htmlFor="account-owner">Owner</FieldLabel><OwnerSelect id="account-owner" moduleKey="sales_organizations" action={mode} ownerId={value.assigned_to} ownerName={value.assigned_to_name} onChange={(assigned_to, assigned_to_name) => onChange({ ...value, assigned_to, assigned_to_name })} /><FieldDescription>New accounts default to you when no owner is selected.</FieldDescription><ServerFieldError inputId="account-owner" /></Field> : <p className="text-sm text-copy-muted">Ownership is not enabled for this module.</p>}
      </FormSection>
      <FormSection title="Billing and purchasing" description="Payment terms, and whether you buy from this account.">
        <Field orientation="horizontal">
          <Switch
            id="account-is-vendor"
            checked={value.is_vendor}
            onCheckedChange={(is_vendor) => onChange({ ...value, is_vendor })}
          >
            <SwitchThumb />
          </Switch>
          <FieldLabel htmlFor="account-is-vendor">Vendor</FieldLabel>
        </Field>
        <FieldDescription>Vendors can be chosen on purchase orders and as a product&apos;s preferred vendor.</FieldDescription>
        <Field>
          <FieldLabel htmlFor="account-payment-terms">Payment terms (days)</FieldLabel>
          <Input id="account-payment-terms" type="number" min={0} max={365} step={1} inputMode="numeric" value={value.payment_terms_days}
            onChange={(event) => onChange({ ...value, payment_terms_days: event.target.value })} />
          <FieldDescription>Sets the due date on this account&apos;s invoices and bills. Blank uses the company default.</FieldDescription>
        <ServerFieldError inputId="account-payment-terms" /></Field>
      </FormSection>
    </>
  );
}
