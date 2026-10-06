"use client";

import { useEffect } from "react";

import CustomFieldInputs from "@/components/customFields/CustomFieldInputs";
import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { OwnerSelect } from "@/components/forms/OwnerSelect";
import RecordTagInput from "@/components/crm/RecordTagInput";
import { FormSection } from "@/components/forms/RecordFormLayout";
import { TextField } from "@/components/forms/TextField";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { isModuleFieldEnabled, type ModuleFieldConfig } from "@/hooks/useModuleFieldConfigs";
import { inputIdLookup, ServerFieldError } from "@/components/forms/ServerFieldErrors";
import { PicklistField } from "@/components/picklists/PicklistSelect";
import { picklistDefault, usePicklist } from "@/hooks/usePicklists";

export type LeadFormValue = {
  first_name: string;
  last_name: string;
  company: string;
  primary_email: string;
  phone: string;
  mobile_phone: string;
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
  mobile_phone: "",
  title: "",
  source: "",
  // Filled from the tenant's default lead status when the form opens; the server applies the
  // same default when none is sent.
  status: "",
  notes: "",
  assigned_to: null,
  assigned_to_name: "",
  next_follow_up_at: "",
  team_id: null,
  team_name: "",
  tags: [],
};

/** A new lead starts in the tenant's default status, as the server would put it. */
export function useLeadStatusDefault<T extends { status: string }>(value: T, onChange: (value: T) => void) {
  const { picklist } = usePicklist("lead_status");
  const fallback = picklistDefault(picklist);
  useEffect(() => {
    if (!value.status && fallback) onChange({ ...value, status: fallback });
  }, [fallback, onChange, value]);
}

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

/** Payload field → input id, for the server's field errors (H2). */
export const LEAD_FORM_INPUT_IDS: Record<string, string> = {
  first_name: "lead-first-name",
  last_name: "lead-last-name",
  company: "lead-company",
  title: "lead-job-title",
  primary_email: "lead-primary-email",
  phone: "lead-phone",
  mobile_phone: "lead-mobile",
  notes: "lead-notes",
  assigned_to: "lead-owner",
  team_id: "lead-team",
  status: "lead-status",
  source: "lead-source",
  next_follow_up_at: "lead-next-follow-up",
  tags: "lead-tags",
};
export const leadFormInputIdFor = inputIdLookup("sales_leads", LEAD_FORM_INPUT_IDS);

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

      <FormSection title="Contact details" description="An email or a phone number is required.">
        <FieldGroup columns={2}>
          {enabled("primary_email") ? (
            <TextField id="lead-primary-email" label="Email" type="email" value={value.primary_email} onChange={(next) => update("primary_email", next)} error={emailError} placeholder="person@company.com" />
          ) : null}
          {enabled("phone") ? <TextField id="lead-phone" label="Phone" type="tel" value={value.phone} onChange={(next) => update("phone", next)} /> : null}
          {enabled("mobile_phone") ? <TextField id="lead-mobile" label="Mobile" type="tel" value={value.mobile_phone} onChange={(next) => update("mobile_phone", next)} /> : null}
        </FieldGroup>
      </FormSection>

      {enabled("notes") ? (
        <FormSection title="Notes" description="Capture context that will help the next person follow up.">
          <Field>
            <FieldLabel htmlFor="lead-notes">Notes</FieldLabel>
            <Textarea id="lead-notes" rows={6} value={value.notes} onChange={(event) => update("notes", event.target.value)} />
          <ServerFieldError inputId="lead-notes" /></Field>
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
  useLeadStatusDefault(value, onChange);
  return (
    <FormSection title="Qualification" description="Set the lead's current state and acquisition source.">
      <FieldGroup>
        {enabled("assigned_to") ? (
          <Field>
            <FieldLabel htmlFor="lead-owner">Owner</FieldLabel>
            <OwnerSelect
              id="lead-owner"
              moduleKey="sales_leads"
              action={mode}
              ownerId={value.assigned_to}
              ownerName={value.assigned_to_name}
              onChange={(assigned_to, assigned_to_name) =>
                onChange({ ...value, assigned_to, assigned_to_name })
              }
            />
            <FieldDescription>New leads default to you when no owner is selected.</FieldDescription>
          <ServerFieldError inputId="lead-owner" /></Field>
        ) : null}
        {enabled("team_id") ? (
          <Field>
            <FieldLabel htmlFor="lead-team">Team</FieldLabel>
            <LinkedRecordPicker inputId="lead-team"
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
          <ServerFieldError inputId="lead-team" /></Field>
        ) : null}
        {enabled("status") ? (
          <PicklistField id="lead-status" listKey="lead_status" label="Status" required value={value.status} onChange={(status) => onChange({ ...value, status })} />
        ) : null}
        {enabled("source") ? (
          <PicklistField id="lead-source" listKey="lead_source" label="Source" value={value.source} onChange={(source) => onChange({ ...value, source })} />
        ) : null}
        {enabled("next_follow_up_at") ? (
          <Field>
            <FieldLabel htmlFor="lead-next-follow-up">Next follow-up</FieldLabel>
            <Input
              id="lead-next-follow-up"
              type="datetime-local"
              value={value.next_follow_up_at}
              onChange={(event) => onChange({ ...value, next_follow_up_at: event.target.value })}
            />
            <FieldDescription>Sets the lead&rsquo;s planning date. Reminder tasks can be created from the Activity tab.</FieldDescription>
          <ServerFieldError inputId="lead-next-follow-up" /></Field>
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
            <FieldDescription>Use existing workspace tags or create a new one while saving the lead.</FieldDescription>
          <ServerFieldError inputId="lead-tags" /></Field>
        ) : null}
      </FieldGroup>
    </FormSection>
  );
}
