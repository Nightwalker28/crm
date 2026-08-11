"use client";

import { Fragment } from "react";
import { useRouter } from "next/navigation";
import { LifeBuoy } from "lucide-react";

import { SortableHead, Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { ModuleTableLoading } from "@/components/ui/ModuleTableLoading";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { Pill } from "@/components/ui/Pill";
import type { SupportCase } from "@/hooks/support/useCases";
import type { TableColumnOption } from "@/types/table";
import { formatDateTime } from "@/lib/datetime";
import { getReadableColumnLabel } from "@/lib/moduleViewConfigs";
import { getSupportCasePriorityStyle, getSupportCaseStatusStyle } from "@/lib/statusStyles";

type SortState = { column: string; direction: "asc" | "desc" } | null;

type SupportCasesTableProps = {
  cases: SupportCase[];
  isLoading: boolean;
  isRefreshing?: boolean;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
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

export default function SupportCasesTable({ cases, isLoading, isRefreshing = false, visibleColumns, columnOptions = [], sort = null, onSortChange, isFiltered = false }: SupportCasesTableProps) {
  const router = useRouter();

  function toggleSort(column: string) {
    const nextSort: SortState = sort?.column !== column
      ? { column, direction: "asc" }
      : { column, direction: sort.direction === "asc" ? "desc" : "asc" };
    onSortChange?.(nextSort);
  }

  function renderCell(item: SupportCase, column: string) {
    switch (column) {
      case "case_number":
        return <TableCell><span className="text-sm font-medium tabular-nums text-copy-primary">{item.case_number}</span></TableCell>;
      case "subject":
        return <TableCell><span className="text-sm font-medium text-copy-primary">{item.subject}</span></TableCell>;
      case "status": {
        const style = getSupportCaseStatusStyle(item.status);
        return <TableCell><Pill bg={style.bg} text={style.text} border={style.border}>{style.label}</Pill></TableCell>;
      }
      case "priority": {
        const style = getSupportCasePriorityStyle(item.priority);
        return <TableCell><Pill bg={style.bg} text={style.text} border={style.border}>{style.label}</Pill></TableCell>;
      }
      case "assigned_to_name":
        return <TableCell><span className="text-sm text-copy-secondary">{item.assigned_to_name || <span className="text-copy-muted">Unassigned</span>}</span></TableCell>;
      case "created_at":
      case "updated_at":
      case "sla_due_at":
      case "first_response_at":
      case "resolved_at":
      case "closed_at":
        return <TableCell><span className="text-sm text-copy-muted">{item[column] ? formatDateTime(String(item[column])) : "—"}</span></TableCell>;
      default:
        return <TableCell><span className="text-sm text-copy-secondary">{String(item[column as keyof SupportCase] ?? "") || <span className="text-copy-muted">—</span>}</span></TableCell>;
    }
  }

  return (
    <ModuleTableShell isRefreshing={isRefreshing}>
      <Table className="min-w-[1080px]">
        <TableHeader>
          <TableHeaderRow>
            {visibleColumns.map((column) => {
              const label = getReadableColumnLabel(column, columnOptions);
              const sortable = SORTABLE_COLUMNS.has(column);
              return sortable && onSortChange ? (
                <SortableHead key={column} sorted={sort?.column === column} direction={sort?.column === column ? sort.direction : "asc"} onClick={() => toggleSort(column)}>
                  {label}
                </SortableHead>
              ) : <TableHead key={column}>{label}</TableHead>;
            })}
          </TableHeaderRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <ModuleTableLoading columnCount={visibleColumns.length} />
          ) : cases.length === 0 ? (
            <TableRow>
              <TableCell colSpan={visibleColumns.length} className="py-16 text-center">
                <EmptyState
                  icon={LifeBuoy}
                  title={isFiltered ? "No cases match this view" : "No support cases yet"}
                  description={isFiltered ? "Adjust the search or filters to see more cases." : "Create a support case to start tracking customer issues."}
                />
              </TableCell>
            </TableRow>
          ) : (
            cases.map((item) => (
              <TableRow
                key={item.id}
                className="group cursor-pointer"
                tabIndex={0}
                aria-label={`Open ${item.case_number}: ${item.subject}`}
                onClick={() => router.push(`/dashboard/support/cases/${item.id}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    router.push(`/dashboard/support/cases/${item.id}`);
                  }
                }}
              >
                {visibleColumns.map((column) => <Fragment key={column}>{renderCell(item, column)}</Fragment>)}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </ModuleTableShell>
  );
}
