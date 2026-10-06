"use client";

import { EmptyValue, type EmptyValueContext } from "@/components/ui/EmptyValue";
import { TextLink } from "@/components/ui/TextLink";
import { picklistLabel, usePicklist } from "@/hooks/usePicklists";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";
import { fieldTypeKey, isNumberType, referenceLabel, type FieldShape } from "@/lib/fieldTypes";

function isEmpty(value: unknown) {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

/**
 * A field's value, read-only, by its type: picklists by label, references by name, dates in
 * the user's zone. Absent, the context's empty value (design.md 3.6).
 */
export function FieldValue({ field, value, context = "field" }: { field: FieldShape; value: unknown; context?: EmptyValueContext }) {
  const type = fieldTypeKey(field.field_type);
  const { picklist } = usePicklist(type === "picklist" || type === "multi_picklist" ? field.picklist_key : null);
  if (isEmpty(value)) return <EmptyValue context={context} />;
  if (type === "picklist") return <>{picklistLabel(picklist, String(value))}</>;
  if (type === "multi_picklist") {
    const items = Array.isArray(value) ? value : [value];
    return <>{items.map((item) => picklistLabel(picklist, String(item))).join(", ")}</>;
  }
  if (type === "boolean") return <>{value ? "Yes" : "No"}</>;
  if (type === "date") return <>{formatDateOnly(String(value))}</>;
  if (type === "datetime") return <>{formatDateTime(String(value))}</>;
  if (type === "percent") return <span className="tabular-nums">{`${Number(value).toLocaleString()}%`}</span>;
  if (isNumberType(type)) {
    const digits = type === "currency" ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 8 };
    return <span className="tabular-nums">{Number(value).toLocaleString(undefined, digits)}</span>;
  }
  if (type === "user" || type === "lookup" || type === "file") return <>{referenceLabel(value) || `#${String((value as { id?: number })?.id ?? value)}`}</>;
  if (type === "url") {
    return <TextLink href={String(value)} external>{String(value)}</TextLink>;
  }
  return <>{String(value)}</>;
}
