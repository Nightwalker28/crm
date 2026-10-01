import { getCustomFieldKeyFromColumn } from "@/lib/moduleViewConfigs";

type Props = {
  column: string;
  values?: Record<string, unknown> | null;
};

/**
 * A custom field's value in a list cell. It renders content only — `RecordTable` supplies
 * the `td`, so this must not wrap one of its own.
 */
export function CustomFieldValue({ column, values }: Props) {
  const fieldKey = getCustomFieldKeyFromColumn(column);
  const value = values?.[fieldKey];
  return (
    <span className="text-sm text-copy-secondary">
      {value == null || value === "" ? <span className="text-copy-disabled">—</span> : String(value)}
    </span>
  );
}
