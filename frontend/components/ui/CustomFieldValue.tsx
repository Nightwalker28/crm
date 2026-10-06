"use client";

import { FieldValue } from "@/components/fields/FieldValue";
import { EmptyValue } from "@/components/ui/EmptyValue";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { getCustomFieldKeyFromColumn } from "@/lib/moduleViewConfigs";

type Props = {
  column: string;
  values?: Record<string, unknown> | null;
  /** The module the row belongs to; its field definitions say how to draw the value. */
  moduleKey: string;
};

/**
 * A custom field's value in a list cell, drawn by its type (13b §3.4). It renders content
 * only — `RecordTable` supplies the `td`, so this must not wrap one of its own.
 */
export function CustomFieldValue({ column, values, moduleKey }: Props) {
  const fieldKey = getCustomFieldKeyFromColumn(column);
  const { data: definitions } = useModuleCustomFields(moduleKey);
  const definition = definitions?.find((item) => item.field_key === fieldKey);
  const value = values?.[fieldKey];
  return (
    <span className="text-sm text-copy-secondary">
      {definition ? <FieldValue field={definition} value={value} context="cell" /> : value == null || value === "" ? <EmptyValue /> : String(value)}
    </span>
  );
}
