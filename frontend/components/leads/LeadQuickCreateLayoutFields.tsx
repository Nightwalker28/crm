"use client";

import { makeQuickCreateInputId, validateLayoutDrivenQuickCreate } from "@/components/forms/quickCreateLayout";
import { RecordForm } from "@/components/forms/RecordForm";
import type { ResolvedRecordLayoutViewport } from "@/components/forms/ResolvedRecordLayout";
import { type LeadFormValue, useLeadStatusDefault } from "@/components/leads/LeadFormFields";
import type { ResolvedRecordLayout as ResolvedRecordLayoutContract } from "@/hooks/useResolvedRecordLayout";

type Props = {
  layout: ResolvedRecordLayoutContract;
  value: LeadFormValue;
  onChange: (value: LeadFormValue) => void;
  customValues: Record<string, unknown>;
  onCustomChange: (fieldKey: string, value: unknown) => void;
  errors?: Record<string, string | null | undefined>;
  /** Only the layout builder sets this, to preview the narrow-screen result. */
  viewport?: ResolvedRecordLayoutViewport;
};

export function validateLeadQuickCreateLayout(
  layout: ResolvedRecordLayoutContract,
  value: LeadFormValue,
  customValues: Record<string, unknown>,
) {
  return validateLayoutDrivenQuickCreate(layout, value, customValues);
}

export const leadQuickCreateInputId = makeQuickCreateInputId("lead-quick-create", "sales_leads");

/** Lead quick create: every field draws from its type through `RecordForm` (13b Phase 4e). */
export function LeadQuickCreateLayoutFields({ layout, value, onChange, customValues, onCustomChange, errors = {}, viewport = "auto" }: Props) {
  useLeadStatusDefault(value.status, (status) => onChange({ ...value, status }));
  return (
    <RecordForm
      moduleKey="sales_leads"
      layout={layout}
      value={value}
      onChange={onChange}
      customValues={customValues}
      onCustomChange={onCustomChange}
      inputId={leadQuickCreateInputId}
      errors={errors}
      viewport={viewport}
    />
  );
}
