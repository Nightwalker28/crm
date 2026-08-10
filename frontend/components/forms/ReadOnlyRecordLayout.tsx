"use client";

import type { ReactNode } from "react";

import { ResolvedRecordLayout } from "@/components/forms/ResolvedRecordLayout";
import type {
  ResolvedRecordLayout as ResolvedRecordLayoutContract,
  ResolvedRecordLayoutField,
} from "@/hooks/useResolvedRecordLayout";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";

function formatResolvedValue(field: ResolvedRecordLayoutField, value: unknown) {
  if (value === null || value === undefined || value === "") return "Not recorded";
  if (field.field_type === "boolean") return value === true ? "Yes" : "No";
  if (field.field_type === "date") return formatDateOnly(String(value)) || "Not recorded";
  if (field.field_type === "datetime") return formatDateTime(String(value)) || "Not recorded";
  if (field.field_type === "select") {
    const label = String(value).replace(/_/g, " ");
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  if (Array.isArray(value)) return value.length ? value.map(String).join(", ") : "Not recorded";
  if (typeof value === "object") return "Not recorded";
  return String(value);
}

export function ReadOnlyRecordLayout({
  layout,
  values,
  customValues = {},
  renderValue,
  fixedSidebar,
}: {
  layout: ResolvedRecordLayoutContract;
  values: Record<string, unknown>;
  customValues?: Record<string, unknown>;
  renderValue?: (field: ResolvedRecordLayoutField, value: unknown) => ReactNode | undefined;
  fixedSidebar?: ReactNode;
}) {
  function renderField(field: ResolvedRecordLayoutField) {
    const rawCustomKey = field.field_key.startsWith("custom:")
      ? field.field_key.slice("custom:".length)
      : null;
    const value = rawCustomKey ? customValues[rawCustomKey] : values[field.field_key];
    const renderedValue = renderValue?.(field, value);
    return (
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-copy-muted">
          {field.label}
        </div>
        <div className="mt-1 whitespace-pre-wrap text-sm text-copy-secondary">
          {renderedValue === undefined ? formatResolvedValue(field, value) : renderedValue}
        </div>
      </div>
    );
  }

  return <ResolvedRecordLayout layout={layout} renderField={renderField} fixedSidebar={fixedSidebar} />;
}
