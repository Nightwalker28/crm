"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { UserRoundPlus } from "lucide-react";

import {
  SortableHead,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableHeaderRow,
  TableRow,
} from "@/components/ui/Table";
import { Checkbox, CheckboxIndicator } from "@/components/ui/checkbox";
import { CustomFieldCell } from "@/components/ui/CustomFieldCell";
import { EmptyState } from "@/components/ui/EmptyState";
import { ModuleTableLoading } from "@/components/ui/ModuleTableLoading";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { Pill } from "@/components/ui/Pill";
import type { Lead } from "@/hooks/sales/useLeads";
import type { TableColumnOption } from "@/hooks/useTablePreferences";
import { getReadableColumnLabel, isCustomFieldColumnKey } from "@/lib/moduleViewConfigs";
import { formatDateTime } from "@/lib/datetime";

type SortState = { column: string; direction: "asc" | "desc" } | null;

type LeadsTableProps = {
  leads: Lead[];
  isLoading: boolean;
  isRefreshing?: boolean;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
  selectedIds?: number[];
  currentPageSelectionState?: boolean | "indeterminate";
  onToggleRow?: (leadId: number, checked: boolean) => void;
  onToggleCurrentPage?: (checked: boolean) => void;
};

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  new: { bg: "bg-sky-900/30", text: "text-sky-300", border: "border-sky-700/40", label: "New" },
  contacted: { bg: "bg-violet-900/30", text: "text-violet-300", border: "border-violet-700/40", label: "Contacted" },
  qualified: { bg: "bg-emerald-900/30", text: "text-emerald-300", border: "border-emerald-700/40", label: "Qualified" },
  unqualified: { bg: "bg-neutral-800/40", text: "text-neutral-400", border: "border-neutral-700/40", label: "Unqualified" },
  converted: { bg: "bg-amber-900/30", text: "text-amber-300", border: "border-amber-700/40", label: "Converted" },
};

function initials(lead: Lead) {
  if (lead.first_name && lead.last_name) return `${lead.first_name[0]}${lead.last_name[0]}`.toUpperCase();
  if (lead.first_name) return lead.first_name[0].toUpperCase();
  if (lead.primary_email) return lead.primary_email[0].toUpperCase();
  return "?";
}

export default function LeadsTable({
  leads,
  isLoading,
  isRefreshing = false,
  visibleColumns,
  columnOptions = [],
  selectedIds = [],
  currentPageSelectionState = false,
  onToggleRow,
  onToggleCurrentPage,
}: LeadsTableProps) {
  const router = useRouter();
  const [sort, setSort] = useState<SortState>(null);

  const sortedLeads = useMemo(() => {
    if (!sort) return leads;
    return [...leads].sort((left, right) => {
      const leftValue = String(left[sort.column as keyof Lead] ?? "").toLowerCase();
      const rightValue = String(right[sort.column as keyof Lead] ?? "").toLowerCase();
      const result = leftValue.localeCompare(rightValue, undefined, { numeric: true });
      return sort.direction === "asc" ? result : -result;
    });
  }, [leads, sort]);

  function toggleSort(column: string) {
    setSort((current) => {
      if (current?.column !== column) return { column, direction: "asc" };
      return { column, direction: current.direction === "asc" ? "desc" : "asc" };
    });
  }

  function renderCell(lead: Lead, column: string) {
    if (isCustomFieldColumnKey(column)) {
      return <CustomFieldCell column={column} values={lead.custom_fields} />;
    }
    switch (column) {
      case "first_name":
        return (
          <TableCell>
            <div className="flex h-8 items-center gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-neutral-700 bg-neutral-800 text-[10px] font-semibold text-neutral-300">
                {initials(lead)}
              </div>
              <span className="truncate text-sm font-medium text-neutral-100">{lead.first_name || <span className="text-neutral-600">-</span>}</span>
            </div>
          </TableCell>
        );
      case "primary_email":
        return <TableCell><span className="font-mono text-sm tracking-tight text-neutral-300">{lead.primary_email || <span className="text-neutral-600">-</span>}</span></TableCell>;
      case "status": {
        const style = STATUS_STYLES[lead.status ?? ""] ?? STATUS_STYLES.new;
        return <TableCell><Pill bg={style.bg} text={style.text} border={style.border}>{style.label}</Pill></TableCell>;
      }
      case "created_time":
        return <TableCell><span className="text-sm text-neutral-400">{lead.created_time ? formatDateTime(lead.created_time) : "-"}</span></TableCell>;
      default:
        return <TableCell><span className="text-sm text-neutral-300">{String(lead[column as keyof Lead] ?? "") || <span className="text-neutral-600">-</span>}</span></TableCell>;
    }
  }

  return (
    <ModuleTableShell isRefreshing={isRefreshing}>
      <Table className="min-w-[920px]">
        <TableHeader>
          <TableHeaderRow>
            <TableHead className="w-12 pr-0">
              <Checkbox
                checked={currentPageSelectionState}
                onCheckedChange={(checked) => onToggleCurrentPage?.(checked === true)}
                className="h-4 w-4 rounded border border-neutral-700 bg-neutral-900"
                aria-label="Select current page leads"
              >
                <CheckboxIndicator className="h-3 w-3" />
              </Checkbox>
            </TableHead>
            {visibleColumns.map((column) => {
              const label = getReadableColumnLabel(column, columnOptions);
              const sortable = !isCustomFieldColumnKey(column) && ["first_name", "last_name", "company", "primary_email", "status"].includes(column);
              return sortable ? (
                <SortableHead
                  key={column}
                  sorted={sort?.column === column}
                  direction={sort?.column === column ? sort.direction : "asc"}
                  onClick={() => toggleSort(column)}
                >
                  {label}
                </SortableHead>
              ) : (
                <TableHead key={column}>{label}</TableHead>
              );
            })}
          </TableHeaderRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <ModuleTableLoading columnCount={visibleColumns.length + 1} />
          ) : leads.length === 0 ? (
            <TableRow>
              <TableCell colSpan={visibleColumns.length + 1} className="py-16 text-center">
                <EmptyState icon={UserRoundPlus} title="No leads found" description="Leads matching the current view will appear here." />
              </TableCell>
            </TableRow>
          ) : (
            sortedLeads.map((lead) => (
              <TableRow key={lead.lead_id} className="group cursor-pointer" onClick={() => router.push(`/dashboard/sales/leads/${lead.lead_id}`)}>
                <TableCell className="w-12 pr-0" onClick={(event) => event.stopPropagation()}>
                  <Checkbox
                    checked={selectedIds.includes(lead.lead_id)}
                    onCheckedChange={(checked) => onToggleRow?.(lead.lead_id, checked === true)}
                    className="h-4 w-4 rounded border border-neutral-700 bg-neutral-900"
                    aria-label={`Select lead ${lead.primary_email ?? lead.lead_id}`}
                  >
                    <CheckboxIndicator className="h-3 w-3" />
                  </Checkbox>
                </TableCell>
                {visibleColumns.map((column) => (
                  <Fragment key={column}>{renderCell(lead, column)}</Fragment>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </ModuleTableShell>
  );
}
