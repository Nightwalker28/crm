"use client";

import CustomFieldInputs from "@/components/customFields/CustomFieldInputs";
import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { FormSection } from "@/components/forms/RecordFormLayout";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { isModuleFieldEnabled, type ModuleFieldConfig } from "@/hooks/useModuleFieldConfigs";

export type LeadFormValue = {
  first_name: string;
  last_name: string;
  company: string;
  primary_email: string;
  phone: string;
  title: string;
  source: string;
  status: string;
  notes: string;
  assigned_to: number | null;
  assigned_to_name: string;
};

export const EMPTY_LEAD_FORM: LeadFormValue = {
  first_name: "",
  last_name: "",
  company: "",
  primary_email: "",
  phone: "",
  title: "",
  source: "",
  status: "new",
  notes: "",
  assigned_to: null,
  assigned_to_name: "",
};

export const LEAD_STATUSES = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "unqualified", label: "Unqualified" },
  { value: "converted", label: "Converted" },
];

type CustomFieldDefinition = React.ComponentProps<typeof CustomFieldInputs>["definitions"];

type Props = {
  value: LeadFormValue;
  onChange: (value: LeadFormValue) => void;
  customFields: CustomFieldDefinition;
  customFieldValues: Record<string, unknown>;
  onCustomFieldChange: (fieldKey: string, value: unknown) => void;
  moduleFields: ModuleFieldConfig[];
  emailError?: string | null;
};

export function LeadFormMainFields({ value, onChange, customFields, customFieldValues, onCustomFieldChange, moduleFields, emailError }: Props) {
  const enabled = (key: string) => isModuleFieldEnabled(moduleFields, key);
  const update = (key: keyof LeadFormValue, nextValue: string) => onChange({ ...value, [key]: nextValue });

  return (
    <>
      <FormSection title="Basic information" description="Identify the person and the company they represent.">
        <div className="grid gap-4 md:grid-cols-2">
          {enabled("first_name") ? <TextField label="First name" value={value.first_name} onChange={(next) => update("first_name", next)} /> : null}
          {enabled("last_name") ? <TextField label="Last name" value={value.last_name} onChange={(next) => update("last_name", next)} /> : null}
          {enabled("company") ? <TextField label="Company" value={value.company} onChange={(next) => update("company", next)} /> : null}
          {enabled("title") ? <TextField label="Job title" value={value.title} onChange={(next) => update("title", next)} /> : null}
        </div>
      </FormSection>

      <FormSection title="Contact details" description="Add the best details for follow-up and qualification.">
        <div className="grid gap-4 md:grid-cols-2">
          {enabled("primary_email") ? (
            <Field data-invalid={Boolean(emailError)}>
              <FieldLabel htmlFor="lead-primary-email">Email <RequiredMark /></FieldLabel>
              <Input id="lead-primary-email" type="email" value={value.primary_email} onChange={(event) => update("primary_email", event.target.value)} aria-invalid={Boolean(emailError)} placeholder="person@company.com" />
              {emailError ? <FieldError>{emailError}</FieldError> : null}
            </Field>
          ) : null}
          {enabled("phone") ? <TextField label="Phone" type="tel" value={value.phone} onChange={(next) => update("phone", next)} /> : null}
        </div>
      </FormSection>

      {enabled("notes") ? (
        <FormSection title="Notes" description="Capture context that will help the next person follow up.">
          <Field>
            <FieldLabel htmlFor="lead-notes">Notes</FieldLabel>
            <Textarea id="lead-notes" rows={6} value={value.notes} onChange={(event) => update("notes", event.target.value)} />
          </Field>
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

export function LeadFormSidebarFields({ value, onChange, moduleFields, mode }: Pick<Props, "value" | "onChange" | "moduleFields"> & { mode: "create" | "edit" }) {
  const enabled = (key: string) => isModuleFieldEnabled(moduleFields, key);
  return (
    <FormSection title="Qualification" description="Set the lead's current state and acquisition source.">
      <div className="grid gap-4">
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
              queryKeyPrefix="lead-owner"
              noResultsText="No active users matched this search."
              sourceModuleKey="sales_leads"
              sourceAction={mode}
            />
          </Field>
        ) : null}
        {enabled("status") ? (
          <Field>
            <FieldLabel>Status</FieldLabel>
            <Select value={value.status} onValueChange={(status) => onChange({ ...value, status })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{LEAD_STATUSES.map((status) => <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        ) : null}
        {enabled("source") ? <TextField label="Source" value={value.source} onChange={(source) => onChange({ ...value, source })} placeholder="Referral, website, event…" /> : null}
      </div>
    </FormSection>
  );
}

function TextField({ label, value, onChange, type = "text", placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string }) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </Field>
  );
}
