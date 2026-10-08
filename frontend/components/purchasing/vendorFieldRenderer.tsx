"use client";

import { useState } from "react";

import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { referenceNameKey, type RecordFormFieldContext, type RecordFormValue } from "@/components/forms/RecordForm";
import { QuickCreateField } from "@/components/forms/quickCreateLayout";
import { OrganizationQuickCreate } from "@/components/organizations/OrganizationQuickCreate";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import type { ResolvedRecordLayoutField } from "@/hooks/useResolvedRecordLayout";

/**
 * `vendor_id` on a purchase order or bill (13b Phase 4e): an Account flagged as a vendor, so
 * the picker offers vendors only, where the generic account reference would offer every one.
 */
export function vendorFieldRenderer(value: RecordFormValue) {
  return function renderField(field: ResolvedRecordLayoutField, context: RecordFormFieldContext) {
    if (field.field_key !== "vendor_id") return undefined;
    return <VendorField field={field} context={context} value={value} />;
  };
}

/** The picker, with *Create vendor "…"* when the user may create accounts (13b Phase 5). */
function VendorField({
  field,
  context,
  value,
}: {
  field: ResolvedRecordLayoutField;
  context: RecordFormFieldContext;
  value: RecordFormValue;
}) {
  const { inputId, aria, error, disabled, set } = context;
  const nameKey = referenceNameKey(field.field_key);
  const { modules } = useAccessibleModules();
  const canCreate = modules.some((module) => module.name === "sales_organizations" && module.actions?.can_create);
  const [creating, setCreating] = useState<string | null>(null);

  return (
    <QuickCreateField field={field} aria={aria} error={error}>
      <LinkedRecordPicker
        inputId={inputId}
        recordType="vendor"
        valueId={(value.vendor_id as number | null | undefined) ?? null}
        displayValue={String(value[nameKey] ?? "")}
        onDisplayValueChange={(name) => set({ vendor_id: null, [nameKey]: name })}
        onSelect={(option) => set({ vendor_id: option.id, [nameKey]: option.label })}
        onClear={() => set({ vendor_id: null, [nameKey]: "" })}
        placeholder={field.placeholder ?? "Search vendors"}
        disabled={disabled}
        ariaDescribedBy={aria.describedBy}
        ariaInvalid={aria.invalid}
        createOption={canCreate ? { label: (text) => `Create vendor "${text}"`, onCreate: setCreating } : undefined}
        suggestOnFocus
      />
      {canCreate ? (
        <OrganizationQuickCreate
          open={creating !== null}
          onOpenChange={(open) => { if (!open) setCreating(null); }}
          embedded
          context={{
            relationshipIntent: "vendor",
            defaults: { org_name: creating ?? "", is_vendor: true },
          }}
          onCreated={(organizationId, name) => {
            if (organizationId !== null) set({ vendor_id: organizationId, [nameKey]: name });
          }}
        />
      ) : null}
    </QuickCreateField>
  );
}
