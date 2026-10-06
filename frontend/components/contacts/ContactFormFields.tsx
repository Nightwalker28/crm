"use client";

import CustomFieldInputs from "@/components/customFields/CustomFieldInputs";
import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { OwnerSelect } from "@/components/forms/OwnerSelect";
import { FormSection } from "@/components/forms/RecordFormLayout";
import { TextField } from "@/components/forms/TextField";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { isModuleFieldEnabled, type ModuleFieldConfig } from "@/hooks/useModuleFieldConfigs";
import { PicklistField } from "@/components/picklists/PicklistSelect";
import { inputIdLookup, ServerFieldError } from "@/components/forms/ServerFieldErrors";
import { AddressFields, addressFrom, type AddressValue } from "@/components/forms/AddressFields";

export type ContactFormValue = {
  salutation: string;
  first_name: string;
  last_name: string;
  primary_email: string;
  /** The work phone; the column keeps its first name (13b §3.5). */
  contact_telephone: string;
  mobile_phone: string;
  mailing_address: string;
  mailing_street2: string;
  mailing_city: string;
  mailing_state: string;
  mailing_postal_code: string;
  linkedin_url: string;
  current_title: string;
  region: string;
  country: string;
  email_opt_out: boolean;
  organization_id: number | null;
  organization_name: string;
  assigned_to: number | null;
  assigned_to_name: string;
};

export const EMPTY_CONTACT_FORM: ContactFormValue = {
  salutation: "",
  first_name: "",
  last_name: "",
  primary_email: "",
  contact_telephone: "",
  mobile_phone: "",
  mailing_address: "",
  mailing_street2: "",
  mailing_city: "",
  mailing_state: "",
  mailing_postal_code: "",
  linkedin_url: "",
  current_title: "",
  region: "",
  country: "",
  email_opt_out: false,
  organization_id: null,
  organization_name: "",
  assigned_to: null,
  assigned_to_name: "",
};

/** The mailing address as one value; its country is the contact's `country`. */
export function contactMailingAddress(value: ContactFormValue): AddressValue {
  return { ...addressFrom(value, "mailing"), country: value.country };
}

function withMailingAddress(value: ContactFormValue, address: AddressValue): ContactFormValue {
  return {
    ...value,
    mailing_address: address.address,
    mailing_street2: address.street2,
    mailing_city: address.city,
    mailing_state: address.state,
    mailing_postal_code: address.postal_code,
    country: address.country,
  };
}

type CustomFieldDefinition = React.ComponentProps<typeof CustomFieldInputs>["definitions"];

type Props = {
  value: ContactFormValue;
  onChange: (value: ContactFormValue) => void;
  customFields: CustomFieldDefinition;
  customFieldValues: Record<string, unknown>;
  onCustomFieldChange: (fieldKey: string, value: unknown) => void;
  moduleFields: ModuleFieldConfig[];
  emailError?: string | null;
  mode: "create" | "edit";
};

/** Payload field → input id, for the server's field errors (H2). */
export const CONTACT_FORM_INPUT_IDS: Record<string, string> = {
  salutation: "contact-salutation",
  first_name: "contact-first-name",
  last_name: "contact-last-name",
  current_title: "contact-job-title",
  linkedin_url: "contact-linkedin",
  primary_email: "contact-primary-email",
  contact_telephone: "contact-phone",
  mobile_phone: "contact-mobile",
  mailing_address: "contact-mailing-address",
  mailing_street2: "contact-mailing-street2",
  mailing_city: "contact-mailing-city",
  mailing_state: "contact-mailing-state",
  mailing_postal_code: "contact-mailing-postal-code",
  organization_id: "contact-account",
  assigned_to: "contact-owner",
  region: "contact-region",
  country: "contact-mailing-country",
};
export const contactFormInputIdFor = inputIdLookup("sales_contacts", CONTACT_FORM_INPUT_IDS);

export function ContactFormMainFields({ value, onChange, customFields, customFieldValues, onCustomFieldChange, moduleFields, emailError }: Props) {
  const enabled = (key: string) => isModuleFieldEnabled(moduleFields, key);
  const update = (key: keyof ContactFormValue, nextValue: string) => onChange({ ...value, [key]: nextValue });

  return (
    <>
      <FormSection title="Basic information" description="Identify the contact and their role.">
        <FieldGroup columns={2}>
          {enabled("salutation") ? <PicklistField id="contact-salutation" listKey="salutation" label="Salutation" value={value.salutation} onChange={(next) => update("salutation", next)} /> : null}
          {enabled("first_name") ? <TextField id="contact-first-name" label="First name" value={value.first_name} onChange={(next) => update("first_name", next)} /> : null}
          {enabled("last_name") ? <TextField id="contact-last-name" label="Last name" value={value.last_name} onChange={(next) => update("last_name", next)} /> : null}
          {enabled("current_title") ? <TextField id="contact-job-title" label="Job title" value={value.current_title} onChange={(next) => update("current_title", next)} /> : null}
          {enabled("linkedin_url") ? <TextField id="contact-linkedin" label="LinkedIn URL" type="url" value={value.linkedin_url} onChange={(next) => update("linkedin_url", next)} placeholder="https://linkedin.com/in/..." /> : null}
        </FieldGroup>
      </FormSection>

      <FormSection title="Contact details" description="An email or a phone number is required.">
        <FieldGroup columns={2}>
          {enabled("primary_email") ? (
            <TextField id="contact-primary-email" label="Email" type="email" value={value.primary_email} onChange={(next) => update("primary_email", next)} error={emailError} placeholder="person@company.com" />
          ) : null}
          {enabled("contact_telephone") ? <TextField id="contact-phone" label="Work phone" type="tel" value={value.contact_telephone} onChange={(next) => update("contact_telephone", next)} placeholder="+94 11 123 4567" /> : null}
          {enabled("mobile_phone") ? <TextField id="contact-mobile" label="Mobile" type="tel" value={value.mobile_phone} onChange={(next) => update("mobile_phone", next)} placeholder="+94 77 123 4567" /> : null}
        </FieldGroup>
        {enabled("email_opt_out") ? (
          <label className="mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-line-subtle px-4 py-3 text-sm text-copy-secondary transition-colors hover:bg-surface-muted">
            <Checkbox
              checked={value.email_opt_out}
              onCheckedChange={(checked) => onChange({ ...value, email_opt_out: checked === true })}
              className="mt-0.5"
              aria-label="Email opt-out"
            />
            <span><span className="block font-medium text-copy-primary">Email opt-out</span><span className="mt-0.5 block text-xs text-copy-muted">Prevent routine marketing email actions for this contact.</span></span>
          </label>
        ) : null}
      </FormSection>

      {enabled("mailing_address") ? (
        <FormSection title="Mailing address" description="Where post for this contact goes.">
          <AddressFields idPrefix="contact-mailing" value={contactMailingAddress(value)} onChange={(address) => onChange(withMailingAddress(value, address))} />
        </FormSection>
      ) : null}

      {customFields.length ? (
        <FormSection title="Custom fields" description="Additional information configured for your workspace.">
          <CustomFieldInputs definitions={customFields} values={customFieldValues} onChange={onCustomFieldChange} />
        </FormSection>
      ) : null}
    </>
  );
}

export function ContactFormSidebarFields({ value, onChange, moduleFields, mode }: Pick<Props, "value" | "onChange" | "moduleFields" | "mode">) {
  const enabled = (key: string) => isModuleFieldEnabled(moduleFields, key);
  return (
    <FormSection title="Account and ownership" description="Connect the contact to the right account and internal owner.">
      <FieldGroup>
        {enabled("organization_id") ? (
          <Field>
            <FieldLabel htmlFor="contact-account">Account</FieldLabel>
            <LinkedRecordPicker inputId="contact-account"
              recordType="organization"
              valueId={value.organization_id}
              displayValue={value.organization_name}
              onDisplayValueChange={(organization_name) => onChange({ ...value, organization_id: null, organization_name })}
              onSelect={(option) => onChange({ ...value, organization_id: option.id, organization_name: option.label })}
              onClear={() => onChange({ ...value, organization_id: null, organization_name: "" })}
              placeholder="Search accounts"
              queryKeyPrefix="contact-account"
              noResultsText="No accounts matched this search."
            />
          <ServerFieldError inputId="contact-account" /></Field>
        ) : null}
        {enabled("assigned_to") ? (
          <Field>
            <FieldLabel htmlFor="contact-owner">Owner</FieldLabel>
            <OwnerSelect
              id="contact-owner"
              moduleKey="sales_contacts"
              action={mode}
              ownerId={value.assigned_to}
              ownerName={value.assigned_to_name}
              onChange={(assigned_to, assigned_to_name) =>
                onChange({ ...value, assigned_to, assigned_to_name })
              }
            />
            <FieldDescription>New contacts default to you when no owner is selected.</FieldDescription>
          <ServerFieldError inputId="contact-owner" /></Field>
        ) : null}
        {enabled("region") ? (
          <PicklistField id="contact-region" listKey="region" label="Region" value={value.region} onChange={(region) => onChange({ ...value, region })} />
        ) : null}
      </FieldGroup>
    </FormSection>
  );
}
