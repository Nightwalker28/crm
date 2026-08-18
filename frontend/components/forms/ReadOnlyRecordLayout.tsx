"use client";

import type { ReactNode } from "react";

import { ResolvedRecordLayout } from "@/components/forms/ResolvedRecordLayout";
import { EmptyValue } from "@/components/ui/EmptyValue";
import type {
  ResolvedRecordLayout as ResolvedRecordLayoutContract,
  ResolvedRecordLayoutField,
} from "@/hooks/useResolvedRecordLayout";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";

/**
 * The `Details` tab's field renderer — the read-only half of the record layout the three
 * pages that already used it shared, and now the one every record page shares.
 *
 * It emitted `"Not recorded"` seven times: the seventh spelling of an absent value, and the
 * one §3.6 rejects. Absence is `EmptyValue` at `context="field"` now, so 5.9's copy sweep is
 * one edit rather than one per renderer.
 */
function formatResolvedValue(field: ResolvedRecordLayoutField, value: unknown): ReactNode {
  if (value === null || value === undefined || value === "") return <EmptyValue context="field" />;
  if (field.field_type === "boolean") return value === true ? "Yes" : "No";
  if (field.field_type === "date") {
    return formatDateOnly(String(value)) || <EmptyValue context="field" />;
  }
  if (field.field_type === "datetime") {
    return formatDateTime(String(value)) || <EmptyValue context="field" />;
  }
  if (field.field_type === "select") {
    const label = String(value).replace(/_/g, " ");
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  if (Array.isArray(value)) {
    return value.length ? value.map(String).join(", ") : <EmptyValue context="field" />;
  }
  if (typeof value === "object") return <EmptyValue context="field" />;
  return String(value);
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
    const renderedValue = renderValue?.(field, value);
    return (
      <div>
        <div className="text-xs font-medium text-copy-label">
          {field.label}
        </div>
        {/* R7: a value is `text-copy-primary` — one ink step *louder* than the label above
            it and than the section heading over the group. */}
        <div className="mt-1 whitespace-pre-wrap text-sm text-copy-primary">
          {renderedValue === undefined ? formatResolvedValue(field, value) : renderedValue}
        </div>
      </div>
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
