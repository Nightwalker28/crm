"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Boxes, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { RecordTable, type RecordTableColumn, type RecordTableSort } from "@/components/ui/RecordTable";
import { FieldValue } from "@/components/fields/FieldValue";
import { customModuleFieldShape } from "@/components/customModules/CustomModuleFieldInput";
import { EmptyValue } from "@/components/ui/EmptyValue";
import { useCustomModuleSchema, type CustomModuleField, type CustomModuleRecord } from "@/hooks/useModuleBuilder";
import { formatDateTime } from "@/lib/datetime";

export type CustomModuleTableColumn = { key: string; label: string };

type Props = {
  moduleKey: string;
  moduleLabel: string;
  records: CustomModuleRecord[];
  columns: CustomModuleTableColumn[];
  isLoading: boolean;
  isRefreshing?: boolean;
  hasError?: boolean;
  onRetry?: () => void;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  sort: RecordTableSort | null;
  onSortChange: (sort: RecordTableSort) => void;
  canCreate?: boolean;
  canDelete?: boolean;
  isDeleting?: boolean;
  onDelete?: (record: CustomModuleRecord) => void;
};

const SORTABLE_RECORD_COLUMNS = new Set(["title", "created_at", "updated_at"]);

function renderRecordColumn(record: CustomModuleRecord, column: string, fields: Map<string, CustomModuleField>) {
  if (column === "title") return record.title;
  if (column === "created_at" || column === "updated_at") {
    return record[column] ? formatDateTime(String(record[column]), { hour: "numeric", minute: "2-digit" }) : <EmptyValue />;
  }
  const field = fields.get(column);
  if (!field) return <EmptyValue />;
  // Each value drawn by its type: picklists by label, references by name (13b §3.4).
  return <FieldValue field={customModuleFieldShape(field)} value={record.values[column]} context="cell" />;
}

export default function CustomModuleRecordsTable({
  moduleKey,
  moduleLabel,
  records,
  columns,
  isLoading,
  isRefreshing = false,
  hasError = false,
  onRetry,
  hasActiveFilters = false,
  onClearFilters,
  sort,
  onSortChange,
  canCreate = false,
  canDelete = false,
  isDeleting = false,
  onDelete,
}: Props) {
  const schema = useCustomModuleSchema(moduleKey);
  const fieldsByKey = useMemo(
    () => new Map((schema.data?.fields ?? []).map((field) => [field.key, field])),
    [schema.data?.fields],
  );
  const tableColumns = useMemo<RecordTableColumn<CustomModuleRecord>[]>(
    () =>
      columns.map((column) => ({
        key: column.key,
        label: column.label,
        sortable: SORTABLE_RECORD_COLUMNS.has(column.key),
        size: column.key === "title" ? "lg" : undefined,
        render: (record) => (
          <span
            className={`block max-w-[320px] truncate text-sm ${
              column.key === "title" ? "font-medium text-copy-primary" : "text-copy-secondary"
            }`}
          >
            {renderRecordColumn(record, column.key, fieldsByKey)}
          </span>
        ),
      })),
    [columns, fieldsByKey],
  );

  return (
    <RecordTable
      label={moduleLabel}
      columns={tableColumns}
      rows={records}
      rowKey={(record) => record.id}
      rowHref={(record) => `/dashboard/custom/${moduleKey}/${record.id}`}
      rowLabel={(record) => `Open ${record.title}`}
      rowActions={
        canDelete && onDelete
          ? (record) => (
              <Button
                type="button"
                // Neutral in the row (R5); the confirmation carries the destructive colour.
                variant="ghost"
                size="icon-sm"
                onClick={() => onDelete(record)}
                disabled={isDeleting}
                aria-label={`Delete ${record.title}`}
              >
                <Trash2 />
              </Button>
            )
          : undefined
      }
      sort={sort}
      onSortChange={onSortChange}
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      hasError={hasError}
      onRetry={onRetry}
      errorState={{ title: "Records could not be loaded" }}
      hasActiveFilters={hasActiveFilters}
      onClearFilters={onClearFilters}
      emptyState={{
        icon: Boxes,
        title: "No records yet",
        description: canCreate
          ? "Create the first record for this custom module."
          : "Records will appear here when a teammate creates one.",
        action: canCreate
          ? <Button asChild><Link href={`/dashboard/custom/${moduleKey}/new`}>Create record</Link></Button>
          : undefined,
      }}
      filteredEmptyState={{
        icon: Boxes,
        title: "No records match this view",
        description: "Clear the filters or adjust this saved view.",
      }}
    />
  );
}
