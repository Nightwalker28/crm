"use client";

import CustomFieldInputs from "@/components/customFields/CustomFieldInputs";
import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { FormSection } from "@/components/forms/RecordFormLayout";
import { getOpportunityStageLabel, OPPORTUNITY_STAGE_ORDER } from "@/components/opportunities/opportunityStages";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCompanyCurrencies } from "@/hooks/useCompanyCurrencies";
import { isModuleFieldEnabled, type ModuleFieldConfig } from "@/hooks/useModuleFieldConfigs";

export type OpportunityFormValue = {
  opportunity_name: string;
  client: string;
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
  total_cost_of_project: string;
  currency_type: string;
  campaign_type: string;
  total_leads: string;
  cpl: string;
  target_geography: string;
  target_audience: string;
  domain_cap: string;
  tactics: string;
  delivery_format: string;
  attachments: string[];
};

export const EMPTY_OPPORTUNITY_FORM: OpportunityFormValue = {
  opportunity_name: "", client: "", contact_id: null, contact_name: "", organization_id: null,
  organization_name: "", assigned_to: null, assigned_to_name: "", sales_stage: "lead", start_date: "",
  expected_close_date: "", probability_percent: "", total_cost_of_project: "", currency_type: "USD",
  campaign_type: "", total_leads: "", cpl: "", target_geography: "", target_audience: "", domain_cap: "",
  tactics: "", delivery_format: "", attachments: [],
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
  contactError?: string | null;
  mode: "create" | "edit";
};

export function OpportunityFormMainFields({ value, onChange, customFields, customFieldValues, onCustomFieldChange, moduleFields, nameError, contactError }: Props) {
  const enabled = (key: string) => isModuleFieldEnabled(moduleFields, key);
  const update = (key: keyof OpportunityFormValue, next: string) => onChange({ ...value, [key]: next });
  const currencies = useCompanyCurrencies(true);
  return <>
    <FormSection title="Deal basics" description="Connect the deal to the customer records that provide its commercial context.">
      <div className="grid gap-4 md:grid-cols-2">
        {enabled("opportunity_name") ? <Field data-invalid={Boolean(nameError)} className="md:col-span-2"><FieldLabel htmlFor="deal-name">Deal name <RequiredMark /></FieldLabel><Input id="deal-name" value={value.opportunity_name} onChange={(event) => update("opportunity_name", event.target.value)} aria-invalid={Boolean(nameError)} placeholder="Acme platform rollout" />{nameError ? <FieldError>{nameError}</FieldError> : null}</Field> : null}
        {enabled("contact_id") ? <Field data-invalid={Boolean(contactError)}><FieldLabel>Contact <RequiredMark /></FieldLabel><LinkedRecordPicker recordType="contact" valueId={value.contact_id} displayValue={value.contact_name} onDisplayValueChange={(contact_name) => onChange({ ...value, contact_id: null, contact_name, client: contact_name })} onSelect={(option) => onChange({ ...value, contact_id: option.id, contact_name: option.label, client: option.label, organization_id: option.organization_id ?? value.organization_id, organization_name: option.organization_name ?? value.organization_name })} onClear={() => onChange({ ...value, contact_id: null, contact_name: "", client: "" })} placeholder="Search contacts" queryKeyPrefix="deal-form-contact" noResultsText="No contacts matched this search." />{contactError ? <FieldError>{contactError}</FieldError> : <FieldDescription>Every deal must remain linked to an existing contact.</FieldDescription>}</Field> : null}
        {enabled("organization_id") ? <Field><FieldLabel>Account</FieldLabel><LinkedRecordPicker recordType="organization" valueId={value.organization_id} displayValue={value.organization_name} onDisplayValueChange={(organization_name) => onChange({ ...value, organization_id: null, organization_name })} onSelect={(option) => onChange({ ...value, organization_id: option.id, organization_name: option.label })} onClear={() => onChange({ ...value, organization_id: null, organization_name: "" })} placeholder="Search accounts" queryKeyPrefix="deal-form-account" noResultsText="No accounts matched this search." /></Field> : null}
      </div>
    </FormSection>
    <FormSection title="Value and timing" description="Capture the commercial value, confidence, and dates used for forecasting.">
      <div className="grid gap-4 md:grid-cols-2">
        {enabled("total_cost_of_project") ? <TextField id="deal-value" label="Deal value" value={value.total_cost_of_project} onChange={(next) => update("total_cost_of_project", next)} inputMode="decimal" /> : null}
        {enabled("currency_type") ? <Field><FieldLabel>Currency</FieldLabel><Select value={value.currency_type || "USD"} onValueChange={(currency_type) => onChange({ ...value, currency_type })}><SelectTrigger><SelectValue placeholder="Select currency" /></SelectTrigger><SelectContent>{(currencies.data ?? ["USD"]).map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}</SelectContent></Select></Field> : null}
        {enabled("probability_percent") ? <Field><FieldLabel htmlFor="deal-probability">Probability</FieldLabel><Input id="deal-probability" type="number" min="0" max="100" step="1" value={value.probability_percent} onChange={(event) => update("probability_percent", event.target.value)} /><FieldDescription>Enter a percentage from 0 to 100.</FieldDescription></Field> : null}
        {enabled("start_date") ? <TextField id="deal-start-date" label="Start date" type="date" value={value.start_date} onChange={(next) => update("start_date", next)} /> : null}
        {enabled("expected_close_date") ? <TextField id="deal-close-date" label="Expected close date" type="date" value={value.expected_close_date} onChange={(next) => update("expected_close_date", next)} /> : null}
      </div>
    </FormSection>
    <FormSection title="Campaign and delivery" description="Record delivery assumptions used by sales and operations.">
      <div className="grid gap-4 md:grid-cols-2">
        {enabled("campaign_type") ? <TextField id="deal-campaign-type" label="Campaign type" value={value.campaign_type} onChange={(next) => update("campaign_type", next)} /> : null}
        {enabled("delivery_format") ? <TextField id="deal-delivery-format" label="Delivery format" value={value.delivery_format} onChange={(next) => update("delivery_format", next)} /> : null}
        {enabled("total_leads") ? <TextField id="deal-total-leads" label="Total leads" value={value.total_leads} onChange={(next) => update("total_leads", next)} inputMode="numeric" /> : null}
        {enabled("cpl") ? <TextField id="deal-cpl" label="Cost per lead" value={value.cpl} onChange={(next) => update("cpl", next)} inputMode="decimal" /> : null}
        {enabled("target_geography") ? <TextField id="deal-geography" label="Target geography" value={value.target_geography} onChange={(next) => update("target_geography", next)} /> : null}
        {enabled("target_audience") ? <TextField id="deal-audience" label="Target audience" value={value.target_audience} onChange={(next) => update("target_audience", next)} /> : null}
        {enabled("domain_cap") ? <TextField id="deal-domain-cap" label="Domain cap" value={value.domain_cap} onChange={(next) => update("domain_cap", next)} /> : null}
        {enabled("tactics") ? <Field className="md:col-span-2"><FieldLabel htmlFor="deal-tactics">Tactics</FieldLabel><Textarea id="deal-tactics" rows={4} value={value.tactics} onChange={(event) => update("tactics", event.target.value)} /></Field> : null}
      </div>
    </FormSection>
    {customFields.length ? <FormSection title="Custom fields" description="Additional deal information configured for your workspace."><CustomFieldInputs definitions={customFields} values={customFieldValues} onChange={onCustomFieldChange} /></FormSection> : null}
  </>;
}

export function OpportunityFormSidebarFields({ value, onChange, moduleFields, mode }: Pick<Props, "value" | "onChange" | "moduleFields" | "mode">) {
  const enabled = (key: string) => isModuleFieldEnabled(moduleFields, key);
  return <>
    <FormSection title="Pipeline" description="Set the stage used in pipeline reporting.">{enabled("sales_stage") ? <Field><FieldLabel>Stage</FieldLabel><Select value={value.sales_stage || "lead"} onValueChange={(sales_stage) => onChange({ ...value, sales_stage })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{OPPORTUNITY_STAGE_ORDER.map((stage) => <SelectItem key={stage} value={stage}>{getOpportunityStageLabel(stage)}</SelectItem>)}</SelectContent></Select></Field> : <p className="text-sm text-copy-muted">Pipeline stage is not enabled.</p>}</FormSection>
    <FormSection title="Ownership" description="Assign responsibility for moving this deal forward.">{enabled("assigned_to") ? <Field><FieldLabel>Owner</FieldLabel><LinkedRecordPicker recordType="user" valueId={value.assigned_to} displayValue={value.assigned_to_name} onDisplayValueChange={(assigned_to_name) => onChange({ ...value, assigned_to: null, assigned_to_name })} onSelect={(option) => onChange({ ...value, assigned_to: option.id, assigned_to_name: option.label })} onClear={() => onChange({ ...value, assigned_to: null, assigned_to_name: "" })} placeholder={mode === "create" ? "Search owners (defaults to you)" : "Search owners"} queryKeyPrefix="deal-form-owner" noResultsText="No active users matched this search." sourceModuleKey="sales_opportunities" sourceAction={mode} allowClear={mode === "create"} /><FieldDescription>New deals default to you when no owner is selected.</FieldDescription></Field> : <p className="text-sm text-copy-muted">Ownership is not enabled.</p>}</FormSection>
  </>;
}

function TextField({ id, label, value, onChange, type = "text", inputMode }: { id: string; label: string; value: string; onChange: (value: string) => void; type?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"] }) {
  return <Field><FieldLabel htmlFor={id}>{label}</FieldLabel><Input id={id} type={type} inputMode={inputMode} value={value} onChange={(event) => onChange(event.target.value)} /></Field>;
}
