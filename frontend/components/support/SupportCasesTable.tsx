"use client";

import { useMemo } from "react";
import Link from "next/link";
import { LifeBuoy } from "lucide-react";

import { StatusValue } from "@/components/ui/StatusValue";
import { Button } from "@/components/ui/button";
import { RecordTable, type RecordTableColumn, type RecordTableSort } from "@/components/ui/RecordTable";
import type { SupportCase } from "@/hooks/support/useCases";
import type { TableColumnOption } from "@/types/table";
import { formatDateTime } from "@/lib/datetime";
import { getReadableColumnLabel } from "@/lib/moduleViewConfigs";
import { getSupportCasePriority, getSupportCaseStatus } from "@/lib/statusStyles";

type SupportCasesTableProps = {
  cases: SupportCase[];
  isLoading: boolean;
  isRefreshing?: boolean;
  hasError?: boolean;
  onRetry?: () => void;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
  sort?: RecordTableSort | null;
  onSortChange?: (sort: RecordTableSort) => void;
  isFiltered?: boolean;
};

const SORTABLE_COLUMNS = new Set([
  "case_number",
  "subject",
  "status",
  "priority",
  "source",
  "contact_id",
  "organization_id",
  "opportunity_id",
  "quote_id",
  "order_id",
  "assigned_to_id",
  "sla_due_at",
  "first_response_at",
  "resolved_at",
  "closed_at",
  "created_at",
  "updated_at",
]);

const COLUMN_SIZES: Record<string, "sm" | "md" | "lg"> = {
  subject: "lg",
  case_number: "sm",
  status: "sm",
  priority: "sm",
  source: "sm",
};

const DATE_COLUMNS = new Set(["created_at", "updated_at", "sla_due_at", "first_response_at", "resolved_at", "closed_at"]);

function renderCell(item: SupportCase, column: string) {
  if (DATE_COLUMNS.has(column)) {
    const value = item[column as keyof SupportCase];
    return <span className="text-sm text-copy-muted">{value ? formatDateTime(String(value)) : "—"}</span>;
  }

  switch (column) {
    case "case_number":
      return <span className="text-sm font-medium tabular-nums text-copy-primary">{item.case_number}</span>;
    case "subject":
      return <span className="text-sm font-medium text-copy-primary">{item.subject}</span>;
    case "status": {
      const style = getSupportCaseStatus(item.status);
      return <StatusValue status={style} />;
    }
    case "priority": {
      const style = getSupportCasePriority(item.priority);
      return <StatusValue status={style} />;
    }
    case "assigned_to_name":
      return (
        <span className="text-sm text-copy-secondary">
          {item.assigned_to_name || <span className="text-copy-muted">Unassigned</span>}
        </span>
      );
    default:
      return (
        <span className="text-sm text-copy-secondary">
          {String(item[column as keyof SupportCase] ?? "") || <span className="text-copy-muted">—</span>}
        </span>
      );
  }
}

export default function SupportCasesTable({
  cases,
  isLoading,
  isRefreshing = false,
  hasError = false,
  onRetry,
  visibleColumns,
  columnOptions = [],
  sort = null,
  onSortChange,
  isFiltered = false,
}: SupportCasesTableProps) {
  const columns = useMemo<RecordTableColumn<SupportCase>[]>(
    () =>
      visibleColumns.map((column) => ({
        key: column,
        label: getReadableColumnLabel(column, columnOptions),
        sortable: SORTABLE_COLUMNS.has(column),
        size: COLUMN_SIZES[column],
        render: (item) => renderCell(item, column),
      })),
    [visibleColumns, columnOptions],
  );

  return (
    <RecordTable
      label="Cases"
      columns={columns}
      rows={cases}
      rowKey={(item) => item.id}
      rowHref={(item) => `/dashboard/support/cases/${item.id}`}
      rowLabel={(item) => `Open ${item.case_number}: ${item.subject}`}
      sort={sort}
      onSortChange={onSortChange}
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      hasError={hasError}
      onRetry={onRetry}
      hasActiveFilters={isFiltered}
      emptyState={{
        icon: LifeBuoy,
        title: "No support cases yet",
        description: "Create a support case to start tracking customer issues.",
        action: <Button asChild><Link href="/dashboard/support/cases/new">New case</Link></Button>,
      }}
      filteredEmptyState={{
        icon: LifeBuoy,
        title: "No cases match this view",
        description: "Adjust the search or filters to see more cases.",
      }}
    />
  );
}
