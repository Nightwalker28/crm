"use client";

import CustomFieldInputs from "@/components/customFields/CustomFieldInputs";
import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import RecordTagInput from "@/components/crm/RecordTagInput";
import { FormSection } from "@/components/forms/RecordFormLayout";
import { TextField } from "@/components/forms/TextField";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
  next_follow_up_at: string;
  team_id: number | null;
  team_name: string;
  tags: string[];
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
  next_follow_up_at: "",
  team_id: null,
  team_name: "",
  tags: [],
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
        <FieldGroup columns={2}>
          {enabled("first_name") ? <TextField id="lead-first-name" label="First name" value={value.first_name} onChange={(next) => update("first_name", next)} /> : null}
          {enabled("last_name") ? <TextField id="lead-last-name" label="Last name" value={value.last_name} onChange={(next) => update("last_name", next)} /> : null}
          {enabled("company") ? <TextField id="lead-company" label="Company" value={value.company} onChange={(next) => update("company", next)} /> : null}
          {enabled("title") ? <TextField id="lead-job-title" label="Job title" value={value.title} onChange={(next) => update("title", next)} /> : null}
        </FieldGroup>
      </FormSection>

      <FormSection title="Contact details" description="Add the best details for follow-up and qualification.">
        <FieldGroup columns={2}>
          {enabled("primary_email") ? (
            <TextField id="lead-primary-email" label="Email" required type="email" value={value.primary_email} onChange={(next) => update("primary_email", next)} error={emailError} placeholder="person@company.com" />
          ) : null}
          {enabled("phone") ? <TextField id="lead-phone" label="Phone" type="tel" value={value.phone} onChange={(next) => update("phone", next)} /> : null}
        </FieldGroup>
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
      <FieldGroup>
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
        {enabled("team_id") ? (
          <Field>
            <FieldLabel>Team</FieldLabel>
            <LinkedRecordPicker
              recordType="team"
              valueId={value.team_id}
              displayValue={value.team_name}
              onDisplayValueChange={(team_name) => onChange({ ...value, team_id: null, team_name })}
              onSelect={(option) => onChange({ ...value, team_id: option.id, team_name: option.label })}
              onClear={() => onChange({ ...value, team_id: null, team_name: "" })}
              placeholder={mode === "create" ? "Search teams (defaults to yours)" : "Search teams"}
              queryKeyPrefix="lead-team"
              noResultsText="No teams matched this search."
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
        {enabled("source") ? <TextField id="lead-source" label="Source" value={value.source} onChange={(source) => onChange({ ...value, source })} placeholder="Referral, website, event…" /> : null}
        {enabled("next_follow_up_at") ? (
          <Field>
            <FieldLabel htmlFor="lead-next-follow-up">Next follow-up</FieldLabel>
            <Input
              id="lead-next-follow-up"
              type="datetime-local"
              value={value.next_follow_up_at}
              onChange={(event) => onChange({ ...value, next_follow_up_at: event.target.value })}
            />
            <FieldDescription>Sets the Lead planning date. Reminder tasks can be created from the Activity tab.</FieldDescription>
          </Field>
        ) : null}
        {enabled("tags") ? (
          <Field>
            <FieldLabel htmlFor="lead-tags">Tags</FieldLabel>
            <RecordTagInput
              inputId="lead-tags"
              value={value.tags}
              onChange={(tags) => onChange({ ...value, tags })}
              moduleKey="sales_leads"
              action={mode}
            />
            <FieldDescription>Use existing workspace tags or create a new one while saving the Lead.</FieldDescription>
          </Field>
        ) : null}
      </FieldGroup>
    </FormSection>
  );
}
