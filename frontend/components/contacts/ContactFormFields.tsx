"use client";

import CustomFieldInputs from "@/components/customFields/CustomFieldInputs";
import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { FormSection } from "@/components/forms/RecordFormLayout";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isModuleFieldEnabled, type ModuleFieldConfig } from "@/hooks/useModuleFieldConfigs";
import { COUNTRIES } from "@/lib/countries";

export type ContactFormValue = {
  first_name: string;
  last_name: string;
  primary_email: string;
  contact_telephone: string;
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
  first_name: "",
  last_name: "",
  primary_email: "",
  contact_telephone: "",
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

const REGIONS = ["APAC", "EMEA", "NA", "LATAM"];
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

export function ContactFormMainFields({ value, onChange, customFields, customFieldValues, onCustomFieldChange, moduleFields, emailError }: Props) {
  const enabled = (key: string) => isModuleFieldEnabled(moduleFields, key);
  const update = (key: keyof ContactFormValue, nextValue: string) => onChange({ ...value, [key]: nextValue });

  return (
    <>
      <FormSection title="Basic information" description="Identify the contact and their role.">
        <div className="grid gap-4 md:grid-cols-2">
          {enabled("first_name") ? <TextField id="contact-first-name" label="First name" value={value.first_name} onChange={(next) => update("first_name", next)} /> : null}
          {enabled("last_name") ? <TextField id="contact-last-name" label="Last name" value={value.last_name} onChange={(next) => update("last_name", next)} /> : null}
          {enabled("current_title") ? <TextField id="contact-job-title" label="Job title" value={value.current_title} onChange={(next) => update("current_title", next)} /> : null}
          {enabled("linkedin_url") ? <TextField id="contact-linkedin" label="LinkedIn URL" type="url" value={value.linkedin_url} onChange={(next) => update("linkedin_url", next)} placeholder="https://linkedin.com/in/..." /> : null}
        </div>
      </FormSection>

      <FormSection title="Contact details" description="Add the primary channels used to reach this contact.">
        <div className="grid gap-4 md:grid-cols-2">
          {enabled("primary_email") ? (
            <Field data-invalid={Boolean(emailError)}>
              <FieldLabel htmlFor="contact-primary-email">Email <RequiredMark /></FieldLabel>
              <Input id="contact-primary-email" type="email" value={value.primary_email} onChange={(event) => update("primary_email", event.target.value)} aria-invalid={Boolean(emailError)} placeholder="person@company.com" />
              {emailError ? <FieldError>{emailError}</FieldError> : null}
            </Field>
          ) : null}
          {enabled("contact_telephone") ? <TextField id="contact-phone" label="Phone" type="tel" value={value.contact_telephone} onChange={(next) => update("contact_telephone", next)} placeholder="+94 77 123 4567" /> : null}
        </div>
        {enabled("email_opt_out") ? (
          <label className="mt-4 flex items-start gap-3 rounded-md border border-line-subtle bg-surface-muted px-4 py-3 text-sm text-copy-secondary">
            <input type="checkbox" checked={value.email_opt_out} onChange={(event) => onChange({ ...value, email_opt_out: event.target.checked })} className="mt-0.5 h-4 w-4 rounded border-line-strong bg-app" />
            <span><span className="block font-medium text-copy-primary">Email opt-out</span><span className="mt-0.5 block text-xs text-copy-muted">Prevent routine marketing email actions for this contact.</span></span>
          </label>
        ) : null}
      </FormSection>

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
      <div className="grid gap-4">
        {enabled("organization_id") ? (
          <Field>
            <FieldLabel>Account</FieldLabel>
            <LinkedRecordPicker
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
          </Field>
        ) : null}
        {enabled("assigned_to") ? (
          <Field>
            <FieldLabel>Owner</FieldLabel>
            <LinkedRecordPicker
              recordType="user"
              valueId={value.assigned_to}
              displayValue={value.assigned_to_name}
              onDisplayValueChange={(assigned_to_name) => onChange({ ...value, assigned_to: null, assigned_to_name })}
              onSelect={(option) => onChange({ ...value, assigned_to: option.id, assigned_to_name: option.label })}
              onClear={() => onChange({ ...value, assigned_to: null, assigned_to_name: "" })}
              placeholder={mode === "create" ? "Search owners (defaults to you)" : "Search owners"}
              queryKeyPrefix="contact-owner"
              noResultsText="No active users matched this search."
              sourceModuleKey="sales_contacts"
              sourceAction={mode}
              allowClear={mode === "create"}
            />
            <FieldDescription>New contacts default to you when no owner is selected.</FieldDescription>
          </Field>
        ) : null}
        {enabled("region") ? (
          <Field>
            <FieldLabel>Region</FieldLabel>
            <Select value={value.region || undefined} onValueChange={(region) => onChange({ ...value, region })}>
              <SelectTrigger><SelectValue placeholder="Select region" /></SelectTrigger>
              <SelectContent>{REGIONS.map((region) => <SelectItem key={region} value={region}>{region}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        ) : null}
        {enabled("country") ? (
          <Field>
            <FieldLabel>Country</FieldLabel>
            <Select value={value.country || undefined} onValueChange={(country) => onChange({ ...value, country })}>
              <SelectTrigger><SelectValue placeholder="Select country" /></SelectTrigger>
              <SelectContent className="max-h-72">{COUNTRIES.map((country) => <SelectItem key={country} value={country}>{country}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        ) : null}
      </div>
    </FormSection>
  );
}

function TextField({ id, label, value, onChange, type = "text", placeholder }: { id: string; label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string }) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </Field>
  );
}
