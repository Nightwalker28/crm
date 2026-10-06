"use client";

import CustomFieldInputs from "@/components/customFields/CustomFieldInputs";
import { OwnerSelect } from "@/components/forms/OwnerSelect";
import { FormSection } from "@/components/forms/RecordFormLayout";
import { TextField } from "@/components/forms/TextField";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch, SwitchThumb } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { isModuleFieldEnabled, type ModuleFieldConfig } from "@/hooks/useModuleFieldConfigs";
import { useBaseCurrency } from "@/hooks/useCompanyCurrencies";
import { PicklistField } from "@/components/picklists/PicklistSelect";
import { inputIdLookup, ServerFieldError } from "@/components/forms/ServerFieldErrors";
import { AddressFields, addressFrom, flatAddress } from "@/components/forms/AddressFields";

export type OrganizationFormValue = {
  org_name: string;
  primary_email: string;
  secondary_email: string;
  website: string;
  primary_phone: string;
  secondary_phone: string;
  industry: string;
  account_type: string;
  /** In the company's base currency (13a A4). */
  annual_revenue: string;
  employee_count: string;
  billing_address: string;
  billing_street2: string;
  billing_city: string;
  billing_state: string;
  billing_postal_code: string;
  billing_country: string;
  shipping_address: string;
  shipping_street2: string;
  shipping_city: string;
  shipping_state: string;
  shipping_postal_code: string;
  shipping_country: string;
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
  account_type: "",
  annual_revenue: "",
  employee_count: "",
  billing_address: "",
  billing_street2: "",
  billing_city: "",
  billing_state: "",
  billing_postal_code: "",
  billing_country: "",
  shipping_address: "",
  shipping_street2: "",
  shipping_city: "",
  shipping_state: "",
  shipping_postal_code: "",
  shipping_country: "",
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
  account_type: "account-type",
  website: "account-website",
  annual_revenue: "account-revenue",
  employee_count: "account-employees",
  primary_email: "account-primary-email",
  secondary_email: "account-secondary-email",
  primary_phone: "account-primary-phone",
  secondary_phone: "account-secondary-phone",
  ...Object.fromEntries(
    ["billing", "shipping"].flatMap((prefix) =>
      ["address", "street2", "city", "state", "postal_code", "country"].map((part) => [
        `${prefix}_${part}`,
        `account-${prefix}-${part.replace("_", "-")}`,
      ]),
    ),
  ),
  assigned_to: "account-owner",
  payment_terms_days: "account-payment-terms",
};
export const organizationFormInputIdFor = inputIdLookup("sales_organizations", ORGANIZATION_FORM_INPUT_IDS);

export function OrganizationFormMainFields({ value, onChange, customFields, customFieldValues, onCustomFieldChange, moduleFields, nameError, emailError }: Props) {
  const enabled = (key: string) => isModuleFieldEnabled(moduleFields, key);
  const baseCurrency = useBaseCurrency().data;
  const update = (key: keyof OrganizationFormValue, nextValue: string) => onChange({ ...value, [key]: nextValue });
  return (
    <>
      <FormSection title="Account information" description="Identify the company and its primary commercial profile.">
        <FieldGroup columns={2}>
          {enabled("org_name") ? <TextField id="account-name" label="Account name" required value={value.org_name} onChange={(next) => update("org_name", next)} error={nameError} placeholder="Acme Inc." /> : null}
          {enabled("industry") ? <PicklistField id="account-industry" listKey="industry" label="Industry" value={value.industry} onChange={(next) => update("industry", next)} /> : null}
          {enabled("website") ? <TextField id="account-website" label="Website" type="url" value={value.website} onChange={(next) => update("website", next)} placeholder="https://acme.com" /> : null}
          {enabled("account_type") ? <PicklistField id="account-type" listKey="account_type" label="Type" value={value.account_type} onChange={(next) => update("account_type", next)} /> : null}
          {enabled("annual_revenue") ? <TextField id="account-revenue" label={baseCurrency ? `Annual revenue (${baseCurrency})` : "Annual revenue"} type="number" inputMode="decimal" min="0" step="0.01" value={value.annual_revenue} onChange={(next) => update("annual_revenue", next)} /> : null}
          {enabled("employee_count") ? <TextField id="account-employees" label="Employees" type="number" inputMode="numeric" min="0" step="1" value={value.employee_count} onChange={(next) => update("employee_count", next)} /> : null}
        </FieldGroup>
      </FormSection>
      <FormSection title="Contact details" description="Add the shared channels used to reach this account.">
        <FieldGroup columns={2}>
          {enabled("primary_email") ? <TextField id="account-primary-email" label="Primary email" type="email" value={value.primary_email} onChange={(next) => update("primary_email", next)} error={emailError} placeholder="ops@acme.com" /> : null}
          {enabled("secondary_email") ? <TextField id="account-secondary-email" label="Secondary email" type="email" value={value.secondary_email} onChange={(next) => update("secondary_email", next)} /> : null}
          {enabled("primary_phone") ? <TextField id="account-primary-phone" label="Primary phone" type="tel" value={value.primary_phone} onChange={(next) => update("primary_phone", next)} /> : null}
          {enabled("secondary_phone") ? <TextField id="account-secondary-phone" label="Secondary phone" type="tel" value={value.secondary_phone} onChange={(next) => update("secondary_phone", next)} /> : null}
        </FieldGroup>
      </FormSection>
      {enabled("billing_address") ? (
        <FormSection title="Billing address" description="Copied onto this account's quotes, orders and invoices.">
          <AddressFields idPrefix="account-billing" value={addressFrom(value, "billing")} onChange={(billing) => onChange({ ...value, ...flatAddress("billing", billing) })} />
        </FormSection>
      ) : null}
      {enabled("shipping_address") ? (
        <FormSection
          title="Shipping address"
          description="Where orders ship. Left blank, documents ship to the billing address."
          action={<Button type="button" variant="ghost" size="sm" onClick={() => onChange({ ...value, ...flatAddress("shipping", addressFrom(value, "billing")) })}>Same as billing</Button>}
        >
          <AddressFields idPrefix="account-shipping" value={addressFrom(value, "shipping")} onChange={(shipping) => onChange({ ...value, ...flatAddress("shipping", shipping) })} />
        </FormSection>
      ) : null}
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
