/**
 * The one field type set, client side (13b §3.4). `app/core/field_types.py` is the server's
 * half; the two agree on the keys. What a type *looks like* is `components/fields/`.
 */

import type { LinkedRecordType } from "@/components/crm/LinkedRecordPicker";
import type { ModuleFilterField } from "@/lib/moduleViewConfigs";

export type FieldTypeKey =
  | "text"
  | "long_text"
  | "number"
  | "decimal"
  | "currency"
  | "percent"
  | "boolean"
  | "date"
  | "datetime"
  | "email"
  | "phone"
  | "url"
  | "picklist"
  | "multi_picklist"
  | "user"
  | "lookup"
  | "file"
  | "auto_number";

/** What every field-system field carries, whether a custom field or a custom module's field. */
export type FieldShape = {
  field_key: string;
  label: string;
  field_type: string;
  picklist_key?: string | null;
  lookup_module_key?: string | null;
  config?: Record<string, unknown> | null;
  placeholder?: string | null;
  help_text?: string | null;
  is_required?: boolean;
};

/** A reference as the API returns it. */
export type FieldReference = { id: number; label?: string | null };

export const FIELD_TYPE_LABELS: Record<FieldTypeKey, string> = {
  text: "Text",
  long_text: "Long text",
  number: "Number",
  decimal: "Decimal",
  currency: "Currency",
  percent: "Percent",
  boolean: "Yes/no",
  date: "Date",
  datetime: "Date and time",
  email: "Email",
  phone: "Phone",
  url: "URL",
  picklist: "Picklist",
  multi_picklist: "Multi-select picklist",
  user: "User",
  lookup: "Record lookup",
  file: "File",
  auto_number: "Auto-number",
};

export const FIELD_TYPE_KEYS = Object.keys(FIELD_TYPE_LABELS) as FieldTypeKey[];

/** What a lookup can point at, and the picker that searches it. */
export const LOOKUP_TARGETS: Record<string, { label: string; recordType: LinkedRecordType }> = {
  sales_contacts: { label: "Contact", recordType: "contact" },
  sales_organizations: { label: "Account", recordType: "organization" },
  sales_opportunities: { label: "Deal", recordType: "opportunity" },
  sales_quotes: { label: "Quote", recordType: "quote" },
  sales_orders: { label: "Order", recordType: "order" },
};

const NUMBER_TYPES = new Set(["number", "decimal", "currency", "percent"]);
const REFERENCE_TYPES = new Set(["user", "lookup", "file"]);
const WIDE_TYPES = new Set(["long_text", "multi_picklist"]);
const NOT_UNIQUE = new Set(["long_text", "boolean", "picklist", "multi_picklist", "user", "lookup", "file"]);

export function fieldTypeKey(value: string): FieldTypeKey {
  const legacy: Record<string, FieldTypeKey> = { textarea: "long_text", single_select: "picklist", multi_select: "multi_picklist" };
  return (legacy[value] ?? value) as FieldTypeKey;
}

export const isNumberType = (type: string) => NUMBER_TYPES.has(fieldTypeKey(type));
export const isReferenceType = (type: string) => REFERENCE_TYPES.has(fieldTypeKey(type));
/** Spans both columns of a form grid. */
export const isWideType = (type: string) => WIDE_TYPES.has(fieldTypeKey(type));
export const canBeUnique = (type: string) => !NOT_UNIQUE.has(fieldTypeKey(type));
export const canBeRequired = (type: string) => fieldTypeKey(type) !== "auto_number";
export const isSystemAssigned = (type: string) => fieldTypeKey(type) === "auto_number";

/** The reference's id, from `{id, label}` or a bare id. */
export function referenceId(value: unknown): number | null {
  if (value && typeof value === "object" && "id" in value) {
    const id = Number((value as FieldReference).id);
    return Number.isFinite(id) ? id : null;
  }
  const id = Number(value);
  return value != null && value !== "" && Number.isFinite(id) ? id : null;
}

export function referenceLabel(value: unknown): string {
  if (value && typeof value === "object" && "label" in value) return String((value as FieldReference).label ?? "");
  return "";
}

/** A value ready for the API: references as ids, empty strings as null. */
export function toPayloadValue(field: FieldShape, value: unknown): unknown {
  if (value === "" || value === undefined) return null;
  if (isReferenceType(field.field_type)) return referenceId(value);
  return value;
}

/** The filter a list offers for a field: picklists by value, references by id, the rest by type. */
export function filterFieldFor(field: FieldShape, key: string): ModuleFilterField | null {
  const type = fieldTypeKey(field.field_type);
  if (type === "multi_picklist" || type === "auto_number") return { key, label: field.label, type: "text" };
  if (type === "picklist") return { key, label: field.label, type: "select", picklistKey: field.picklist_key ?? undefined };
  if (type === "boolean") {
    return { key, label: field.label, type: "select", operators: ["is"], options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] };
  }
  if (isNumberType(type)) return { key, label: field.label, type: "number" };
  if (type === "date" || type === "datetime") return { key, label: field.label, type: "date" };
  if (type === "user") return { key, label: field.label, type: "relation", recordType: "user" };
  if (type === "lookup" && field.lookup_module_key === "sales_organizations") return { key, label: field.label, type: "relation", recordType: "organization" };
  if (type === "lookup" && field.lookup_module_key === "sales_contacts") return { key, label: field.label, type: "relation", recordType: "contact" };
  if (isReferenceType(type)) return { key, label: field.label, type: "number" };
  return { key, label: field.label, type: "text" };
}
