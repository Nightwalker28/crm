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
import type { TableColumnOption } from "@/hooks/useTablePreferences";
import { formatDateTime } from "@/lib/datetime";
import { getReadableColumnLabel } from "@/lib/moduleViewConfigs";

type SortState = { column: string; direction: "asc" | "desc" } | null;

type SupportCasesTableProps = {
  cases: SupportCase[];
  isLoading: boolean;
  isRefreshing?: boolean;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
};

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  new: { bg: "bg-sky-900/30", text: "text-sky-300", border: "border-sky-700/40", label: "New" },
  open: { bg: "bg-amber-900/30", text: "text-amber-300", border: "border-amber-700/40", label: "Open" },
  pending: { bg: "bg-neutral-800/40", text: "text-neutral-300", border: "border-neutral-700/40", label: "Pending" },
  resolved: { bg: "bg-emerald-900/30", text: "text-emerald-300", border: "border-emerald-700/40", label: "Resolved" },
  closed: { bg: "bg-neutral-900/70", text: "text-neutral-500", border: "border-neutral-800", label: "Closed" },
};

const PRIORITY_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  low: { bg: "bg-neutral-800/40", text: "text-neutral-300", border: "border-neutral-700/40", label: "Low" },
  medium: { bg: "bg-blue-900/30", text: "text-blue-300", border: "border-blue-700/40", label: "Medium" },
  high: { bg: "bg-orange-900/30", text: "text-orange-300", border: "border-orange-700/40", label: "High" },
  urgent: { bg: "bg-red-900/30", text: "text-red-300", border: "border-red-700/40", label: "Urgent" },
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

export default function SupportCasesTable({ cases, isLoading, isRefreshing = false, visibleColumns, columnOptions = [], sort = null, onSortChange }: SupportCasesTableProps) {
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
        return <TableCell><span className="font-mono text-sm font-medium text-neutral-100">{item.case_number}</span></TableCell>;
      case "subject":
        return <TableCell><span className="text-sm font-medium text-neutral-100">{item.subject}</span></TableCell>;
      case "status": {
        const style = STATUS_STYLES[item.status] ?? STATUS_STYLES.new;
        return <TableCell><Pill bg={style.bg} text={style.text} border={style.border}>{style.label}</Pill></TableCell>;
      }
      case "priority": {
        const style = PRIORITY_STYLES[item.priority] ?? PRIORITY_STYLES.medium;
        return <TableCell><Pill bg={style.bg} text={style.text} border={style.border}>{style.label}</Pill></TableCell>;
      }
      case "created_at":
      case "updated_at":
      case "sla_due_at":
      case "first_response_at":
      case "resolved_at":
      case "closed_at":
        return <TableCell><span className="text-sm text-neutral-400">{item[column] ? formatDateTime(String(item[column])) : "-"}</span></TableCell>;
      default:
        return <TableCell><span className="text-sm text-neutral-300">{String(item[column as keyof SupportCase] ?? "") || <span className="text-neutral-600">-</span>}</span></TableCell>;
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
                <EmptyState icon={LifeBuoy} title="No support cases found" description="Customer issues matching this view will appear here." />
              </TableCell>
            </TableRow>
          ) : (
            cases.map((item) => (
              <TableRow key={item.id} className="group cursor-pointer" onClick={() => router.push(`/dashboard/support/cases/${item.id}`)}>
                {visibleColumns.map((column) => <Fragment key={column}>{renderCell(item, column)}</Fragment>)}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </ModuleTableShell>
  );
}
