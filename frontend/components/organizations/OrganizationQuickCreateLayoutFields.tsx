"use client";

import { makeQuickCreateInputId, validateLayoutDrivenQuickCreate } from "@/components/forms/quickCreateLayout";
import { RecordForm } from "@/components/forms/RecordForm";
import type { ResolvedRecordLayoutViewport } from "@/components/forms/ResolvedRecordLayout";
import type { OrganizationFormValue } from "@/components/organizations/OrganizationFormFields";
import type { ResolvedRecordLayout as ResolvedRecordLayoutContract } from "@/hooks/useResolvedRecordLayout";

export const organizationQuickCreateInputId = makeQuickCreateInputId(
  "account-quick-create",
  "sales_organizations",
);

type Props = {
  layout: ResolvedRecordLayoutContract;
  value: OrganizationFormValue;
  onChange: (value: OrganizationFormValue) => void;
  customValues: Record<string, unknown>;
  onCustomChange: (fieldKey: string, value: unknown) => void;
  errors?: Record<string, string | null | undefined>;
  viewport?: ResolvedRecordLayoutViewport;
};

export function validateOrganizationQuickCreateLayout(
  layout: ResolvedRecordLayoutContract,
  value: OrganizationFormValue,
  customValues: Record<string, unknown>,
) {
  return validateLayoutDrivenQuickCreate(layout, value, customValues);
}

/** Account quick create: every field draws from its type through `RecordForm` (13b Phase 4e). */
export function OrganizationQuickCreateLayoutFields({ layout, value, onChange, customValues, onCustomChange, errors = {}, viewport = "auto" }: Props) {
  return (
    <RecordForm
      moduleKey="sales_organizations"
      layout={layout}
      value={value}
      onChange={onChange}
      customValues={customValues}
      onCustomChange={onCustomChange}
      inputId={organizationQuickCreateInputId}
      errors={errors}
      viewport={viewport}
    />
  );
}
