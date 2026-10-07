"use client";

import type { ContactFormValue } from "@/components/contacts/ContactFormFields";
import { makeQuickCreateInputId, validateLayoutDrivenQuickCreate } from "@/components/forms/quickCreateLayout";
import { RecordForm } from "@/components/forms/RecordForm";
import type { ResolvedRecordLayoutViewport } from "@/components/forms/ResolvedRecordLayout";
import type { ResolvedRecordLayout as ResolvedRecordLayoutContract } from "@/hooks/useResolvedRecordLayout";

export const contactQuickCreateInputId = makeQuickCreateInputId("contact-quick-create", "sales_contacts");

type Props = {
  layout: ResolvedRecordLayoutContract;
  value: ContactFormValue;
  onChange: (value: ContactFormValue) => void;
  customValues: Record<string, unknown>;
  onCustomChange: (fieldKey: string, value: unknown) => void;
  errors?: Record<string, string | null | undefined>;
  /**
   * Relationship keys the calling context already knows. They render read-only with an
   * explanation instead of asking the user to pick something the CRM just told them.
   */
  lockedFieldKeys?: readonly string[];
  viewport?: ResolvedRecordLayoutViewport;
};

export function validateContactQuickCreateLayout(
  layout: ResolvedRecordLayoutContract,
  value: ContactFormValue,
  customValues: Record<string, unknown>,
) {
  return validateLayoutDrivenQuickCreate(layout, value, customValues);
}

/** Contact quick create: every field draws from its type through `RecordForm` (13b Phase 4e). */
export function ContactQuickCreateLayoutFields({
  layout,
  value,
  onChange,
  customValues,
  onCustomChange,
  errors = {},
  lockedFieldKeys = [],
  viewport = "auto",
}: Props) {
  return (
    <RecordForm
      moduleKey="sales_contacts"
      layout={layout}
      value={value}
      onChange={onChange}
      customValues={customValues}
      onCustomChange={onCustomChange}
      inputId={contactQuickCreateInputId}
      errors={errors}
      lockedFieldKeys={lockedFieldKeys}
      viewport={viewport}
    />
  );
}
