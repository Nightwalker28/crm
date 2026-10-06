"use client";

import CustomFieldInputs from "@/components/customFields/CustomFieldInputs";
import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { OwnerSelect } from "@/components/forms/OwnerSelect";
import { FormSection } from "@/components/forms/RecordFormLayout";
import { TextField } from "@/components/forms/TextField";
import { OpportunityStageSelect } from "@/components/opportunities/OpportunityStageSelect";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBaseCurrency, useCompanyCurrencies } from "@/hooks/useCompanyCurrencies";
import { PicklistField } from "@/components/picklists/PicklistSelect";
import { isModuleFieldEnabled, type ModuleFieldConfig } from "@/hooks/useModuleFieldConfigs";
import { inputIdLookup, ServerFieldError } from "@/components/forms/ServerFieldErrors";

export type OpportunityFormValue = {
  opportunity_name: string;
  contact_id: number | null;
  contact_name: string;
  organization_id: number | null;
  organization_name: string;
  assigned_to: number | null;
  assigned_to_name: string;
  sales_stage: string;
  start_date: string;
  expected_close_date: string;
  probability_percent: string;
  amount: string;
  /** Empty takes the company's base currency (13b §3.5). */
  currency_type: string;
  deal_type: string;
  source: string;
  next_step: string;
  lost_reason: string;
};

export const EMPTY_OPPORTUNITY_FORM: OpportunityFormValue = {
  opportunity_name: "", contact_id: null, contact_name: "", organization_id: null,
  organization_name: "", assigned_to: null, assigned_to_name: "", sales_stage: "", start_date: "",
  expected_close_date: "", probability_percent: "", amount: "", currency_type: "",
  deal_type: "", source: "", next_step: "", lost_reason: "",
};

type CustomFieldDefinition = React.ComponentProps<typeof CustomFieldInputs>["definitions"];
type Props = {
  value: OpportunityFormValue;
  onChange: (value: OpportunityFormValue) => void;
  customFields: CustomFieldDefinition;
  customFieldValues: Record<string, unknown>;
  onCustomFieldChange: (fieldKey: string, value: unknown) => void;
  moduleFields: ModuleFieldConfig[];
  nameError?: string | null;
  /** "Choose an account or a contact": shown on both pickers. */
  partyError?: string | null;
  mode: "create" | "edit";
};

/** Payload field → input id, for the server's field errors (H2). */
export const OPPORTUNITY_FORM_INPUT_IDS: Record<string, string> = {
  opportunity_name: "deal-name",
  contact_id: "deal-contact",
  organization_id: "deal-account",
  amount: "deal-amount",
  currency_type: "deal-currency",
  probability_percent: "deal-probability",
  start_date: "deal-start-date",
  expected_close_date: "deal-close-date",
  deal_type: "deal-type",
  source: "deal-source",
  next_step: "deal-next-step",
  lost_reason: "deal-lost-reason",
  sales_stage: "deal-stage",
  pipeline_stage_id: "deal-stage",
  assigned_to: "deal-owner",
};
export const opportunityFormInputIdFor = inputIdLookup("sales_opportunities", OPPORTUNITY_FORM_INPUT_IDS);

export function OpportunityFormMainFields({ value, onChange, customFields, customFieldValues, onCustomFieldChange, moduleFields, nameError, partyError }: Props) {
  const enabled = (key: string) => isModuleFieldEnabled(moduleFields, key);
  const update = (key: keyof OpportunityFormValue, next: string) => onChange({ ...value, [key]: next });
  const currencies = useCompanyCurrencies(true);
  const baseCurrency = useBaseCurrency();
  const currency = value.currency_type || baseCurrency.data || currencies.data?.[0] || "";
  return <>
    <FormSection title="Deal basics" description="A deal belongs to an account, a contact, or both.">
      <FieldGroup columns={2}>
        {enabled("opportunity_name") ? <TextField id="deal-name" label="Deal name" required className="md:col-span-2" value={value.opportunity_name} onChange={(next) => update("opportunity_name", next)} error={nameError} placeholder="Acme platform rollout" /> : null}
        {enabled("organization_id") ? <Field data-invalid={Boolean(partyError)}><FieldLabel htmlFor="deal-account">Account</FieldLabel><LinkedRecordPicker inputId="deal-account" recordType="organization" valueId={value.organization_id} displayValue={value.organization_name} onDisplayValueChange={(organization_name) => onChange({ ...value, organization_id: null, organization_name })} onSelect={(option) => onChange({ ...value, organization_id: option.id, organization_name: option.label })} onClear={() => onChange({ ...value, organization_id: null, organization_name: "" })} placeholder="Search accounts" queryKeyPrefix="deal-form-account" noResultsText="No accounts matched this search." ariaInvalid={Boolean(partyError)} />{partyError ? <FieldError>{partyError}</FieldError> : null}<ServerFieldError inputId="deal-account" /></Field> : null}
        {enabled("contact_id") ? <Field data-invalid={Boolean(partyError)}><FieldLabel htmlFor="deal-contact">Contact</FieldLabel><LinkedRecordPicker inputId="deal-contact" recordType="contact" valueId={value.contact_id} displayValue={value.contact_name} onDisplayValueChange={(contact_name) => onChange({ ...value, contact_id: null, contact_name })} onSelect={(option) => onChange({ ...value, contact_id: option.id, contact_name: option.label, organization_id: value.organization_id ?? option.organization_id ?? null, organization_name: value.organization_id ? value.organization_name : option.organization_name ?? value.organization_name })} onClear={() => onChange({ ...value, contact_id: null, contact_name: "" })} placeholder="Search contacts" queryKeyPrefix="deal-form-contact" noResultsText="No contacts matched this search." ariaInvalid={Boolean(partyError)} /><FieldDescription>The primary contact. Choosing one fills an empty account with the contact&rsquo;s.</FieldDescription><ServerFieldError inputId="deal-contact" /></Field> : null}
      </FieldGroup>
    </FormSection>
    <FormSection title="Value and timing" description="The amount, confidence and dates the forecast uses.">
      <FieldGroup columns={2}>
        {enabled("amount") ? <TextField id="deal-amount" label="Amount" type="number" min="0" step="0.01" value={value.amount} onChange={(next) => update("amount", next)} inputMode="decimal" /> : null}
        {enabled("currency_type") ? <Field><FieldLabel htmlFor="deal-currency">Currency</FieldLabel><Select value={currency} onValueChange={(currency_type) => onChange({ ...value, currency_type })}><SelectTrigger id="deal-currency"><SelectValue placeholder="Select currency" /></SelectTrigger><SelectContent>{Array.from(new Set([currency, ...(currencies.data ?? [])].filter(Boolean))).map((code) => <SelectItem key={code} value={code}>{code}</SelectItem>)}</SelectContent></Select><ServerFieldError inputId="deal-currency" /></Field> : null}
        {enabled("probability_percent") ? <TextField id="deal-probability" label="Probability" type="number" min="0" max="100" step="1" value={value.probability_percent} onChange={(next) => update("probability_percent", next)} description="Leave empty to use the stage's probability." /> : null}
        {enabled("expected_close_date") ? <TextField id="deal-close-date" label="Expected close date" type="date" value={value.expected_close_date} onChange={(next) => update("expected_close_date", next)} /> : null}
        {enabled("start_date") ? <TextField id="deal-start-date" label="Start date" type="date" value={value.start_date} onChange={(next) => update("start_date", next)} /> : null}
      </FieldGroup>
    </FormSection>
    <FormSection title="Qualification" description="Where the deal came from and what happens next.">
      <FieldGroup columns={2}>
        {enabled("deal_type") ? <PicklistField id="deal-type" listKey="deal_type" label="Type" value={value.deal_type} onChange={(next) => update("deal_type", next)} /> : null}
        {enabled("source") ? <PicklistField id="deal-source" listKey="lead_source" label="Source" value={value.source} onChange={(next) => update("source", next)} /> : null}
        {enabled("next_step") ? <TextField id="deal-next-step" label="Next step" className="md:col-span-2" value={value.next_step} onChange={(next) => update("next_step", next)} placeholder="Send the proposal by Friday" /> : null}
        {enabled("lost_reason") && value.lost_reason ? <PicklistField id="deal-lost-reason" listKey="lost_reason" label="Lost reason" value={value.lost_reason} onChange={(next) => update("lost_reason", next)} /> : null}
      </FieldGroup>
    </FormSection>
    {customFields.length ? <FormSection title="Custom fields" description="Additional deal information configured for your workspace."><CustomFieldInputs definitions={customFields} values={customFieldValues} onChange={onCustomFieldChange} /></FormSection> : null}
  </>;
}

export function OpportunityFormSidebarFields({ value, onChange, moduleFields, mode }: Pick<Props, "value" | "onChange" | "moduleFields" | "mode">) {
  const enabled = (key: string) => isModuleFieldEnabled(moduleFields, key);
  return <>
    <FormSection title="Pipeline" description="Set the stage used in pipeline reporting.">{enabled("sales_stage") ? <Field><FieldLabel htmlFor="deal-stage">Stage</FieldLabel><OpportunityStageSelect id="deal-stage" value={value.sales_stage} onChange={(sales_stage) => onChange({ ...value, sales_stage })} /><ServerFieldError inputId="deal-stage" /></Field> : <p className="text-sm text-copy-muted">Pipeline stage is not enabled.</p>}</FormSection>
    <FormSection title="Ownership" description="Assign responsibility for moving this deal forward.">{enabled("assigned_to") ? <Field><FieldLabel htmlFor="deal-owner">Owner</FieldLabel><OwnerSelect id="deal-owner" moduleKey="sales_opportunities" action={mode} ownerId={value.assigned_to} ownerName={value.assigned_to_name} onChange={(assigned_to, assigned_to_name) => onChange({ ...value, assigned_to, assigned_to_name })} /><FieldDescription>New deals default to you when no owner is selected.</FieldDescription><ServerFieldError inputId="deal-owner" /></Field> : <p className="text-sm text-copy-muted">Ownership is not enabled.</p>}</FormSection>
  </>;
}
