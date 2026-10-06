"use client";

import CustomFieldInputs from "@/components/customFields/CustomFieldInputs";
import { FieldValue } from "@/components/fields/FieldValue";
import { ReadOnlyFieldSection } from "@/components/forms/ReadOnlyRecordLayout";
import { FormSection } from "@/components/forms/RecordFormLayout";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { isWideType } from "@/lib/fieldTypes";

/**
 * A module's custom fields on its form (13b §3.4, F3.2): every module that takes custom fields
 * shows the same section, and nothing when the tenant has added none.
 */
export function RecordCustomFieldsSection({
  moduleKey,
  values,
  onChange,
  disabled,
}: {
  moduleKey: string;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const { data: definitions } = useModuleCustomFields(moduleKey);
  if (!definitions?.length) return null;
  return (
    <FormSection title="Custom fields" description="Additional information configured for your workspace.">
      <CustomFieldInputs
        definitions={definitions}
        values={values}
        onChange={(fieldKey, value) => onChange({ ...values, [fieldKey]: value })}
        disabled={disabled}
      />
    </FormSection>
  );
}

/** The same fields, read-only, on a record or document page. */
export function RecordCustomFieldsFacts({ moduleKey, values, title = "Custom fields" }: { moduleKey: string; values?: Record<string, unknown> | null; title?: string }) {
  const { data: definitions } = useModuleCustomFields(moduleKey);
  if (!definitions?.length) return null;
  return (
    <ReadOnlyFieldSection
      title={title}
      fields={definitions.map((definition) => ({
        key: definition.field_key,
        label: definition.label,
        fieldType: definition.field_type,
        value: values?.[definition.field_key],
        width: isWideType(definition.field_type) ? "full" : "half",
        display: <FieldValue field={definition} value={values?.[definition.field_key]} />,
      }))}
    />
  );
}
