"use client";

import { formatSnakeCaseLabel } from "@/lib/module-display";
import type { ReactNode } from "react";

import { ResolvedRecordLayout } from "@/components/forms/ResolvedRecordLayout";
import { Card } from "@/components/ui/Card";
import { EmptyValue } from "@/components/ui/EmptyValue";
import { SectionHeading } from "@/components/ui/SectionHeading";
import type {
  ResolvedRecordLayout as ResolvedRecordLayoutContract,
  ResolvedRecordLayoutField,
} from "@/hooks/useResolvedRecordLayout";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";
import { PicklistText } from "@/components/picklists/PicklistText";
import { FieldValue } from "@/components/fields/FieldValue";

/**
 * The `Details` tab's field renderer — the read-only half of the record layout the three
 * pages that already used it shared, and now the one every record page shares.
 *
 * It emitted `"Not recorded"` seven times: the seventh spelling of an absent value, and the
 * one §3.6 rejects. Absence is `EmptyValue` at `context="field"` now, so 5.9's copy sweep is
 * one edit rather than one per renderer.
 */
export function formatReadOnlyValue(fieldType: string, value: unknown): ReactNode {
  if (value === null || value === undefined || value === "") return <EmptyValue context="field" />;
  if (fieldType === "boolean") return value === true ? "Yes" : "No";
  if (fieldType === "date") {
    return formatDateOnly(String(value)) || <EmptyValue context="field" />;
  }
  if (fieldType === "datetime") {
    return formatDateTime(String(value)) || <EmptyValue context="field" />;
  }
  if (fieldType === "select" || fieldType === "single_select") {
    return formatSnakeCaseLabel(String(value));
  }
  if (Array.isArray(value)) {
    return value.length ? value.map(String).join(", ") : <EmptyValue context="field" />;
  }
  if (typeof value === "object") return <EmptyValue context="field" />;
  return String(value);
}

/**
 * One read-only field: the label, and the value formatted by its type.
 *
 * Exported because a module with **no server-side record layout** still has to draw its
 * fields, and the census counted 9–12 private renderers doing exactly this by hand. A custom
 * module's schema is defined by the tenant rather than by `record_layouts.py`, so it cannot
 * resolve a layout — but it can render through the same field.
 */
export function ReadOnlyField({
  label,
  fieldType,
  value,
  children,
}: {
  label: string;
  fieldType: string;
  value: unknown;
  /** An override for a value the type-based formatter cannot produce, e.g. money. */
  children?: ReactNode;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-copy-label">{label}</div>
      {/* R7: a value is `text-copy-primary` — one ink step *louder* than the label above
          it and than the section heading over the group. */}
      <div className="mt-1 whitespace-pre-wrap text-sm text-copy-primary">
        {children === undefined ? formatReadOnlyValue(fieldType, value) : children}
      </div>
    </div>
  );
}

/**
 * A read-only field section for a module with no record layout — the same panel, heading and
 * two-column grid `ResolvedRecordLayout` draws for a section it resolved.
 *
 * A field marked `full` spans both columns, matching the layout's own `width` handling.
 */
export function ReadOnlyFieldSection({
  title,
  fields,
}: {
  title: string;
  /** `display` draws a value the type formatter cannot, such as a picklist's label. */
  fields: { key: string; label: string; fieldType: string; value: unknown; width?: "half" | "full"; display?: ReactNode }[];
}) {
  if (!fields.length) return null;
  return (
    <Card className="p-6">
      <SectionHeading>{title}</SectionHeading>
      <div className="mt-4 grid gap-x-6 gap-y-4 md:grid-cols-2">
        {fields.map((field) => (
          <div key={field.key} className={field.width === "full" ? "sm:col-span-2" : undefined}>
            <ReadOnlyField label={field.label} fieldType={field.fieldType} value={field.value}>{field.display}</ReadOnlyField>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function ReadOnlyRecordLayout({
  layout,
  values,
  customValues = {},
  renderValue,
  fixedSidebar,
  omitFieldKeys,
}: {
  layout: ResolvedRecordLayoutContract;
  values: Record<string, unknown>;
  customValues?: Record<string, unknown>;
  renderValue?: (field: ResolvedRecordLayoutField, value: unknown) => ReactNode | undefined;
  fixedSidebar?: ReactNode;
  /**
   * Fields the spine already owns, which `Details` must not repeat (design.md §4.7).
   *
   * The record layout is configured server-side and still lists status, owner and the rest,
   * because it predates the spine. Rendering them in both places puts an editable status in
   * the rail and a read-only copy of the same value ten centimetres to its right — which is
   * precisely the "nothing tells the operator what is clickable" failure R2 set out to avoid.
   */
  omitFieldKeys?: readonly string[];
}) {
  function renderField(field: ResolvedRecordLayoutField) {
    const rawCustomKey = field.field_key.startsWith("custom:")
      ? field.field_key.slice("custom:".length)
      : null;
    const value = rawCustomKey ? customValues[rawCustomKey] : values[field.field_key];
    const override = renderValue?.(field, value);
    // A custom field draws by its type (13b §3.4); a standard picklist field by its label (§3.3).
    const typed = rawCustomKey
      ? <FieldValue field={{ field_key: rawCustomKey, label: field.label, field_type: field.field_type, picklist_key: field.picklist_key }} value={value} />
      : field.field_type === "picklist" && field.picklist_key
        ? <PicklistText listKey={field.picklist_key} value={typeof value === "string" ? value : null} context="field" />
        : undefined;
    return (
      <ReadOnlyField label={field.label} fieldType={field.field_type} value={value}>
        {override !== undefined ? override : typed}
      </ReadOnlyField>
    );
  }

  return (
    <ResolvedRecordLayout
      layout={layout}
      renderField={renderField}
      fixedSidebar={fixedSidebar}
      omitFieldKeys={omitFieldKeys}
    />
  );
}
