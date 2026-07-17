"use client";

import { Fragment } from "react";
import Link from "next/link";
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
import { Button } from "@/components/ui/button";
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
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
};

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  new: { bg: "bg-state-info-muted", text: "text-state-info", border: "border-state-info/40", label: "New" },
  contacted: { bg: "bg-violet-900/30", text: "text-violet-300", border: "border-violet-700/40", label: "Contacted" },
  qualified: { bg: "bg-state-success-muted", text: "text-state-success", border: "border-state-success/40", label: "Qualified" },
  unqualified: { bg: "bg-surface-muted", text: "text-copy-muted", border: "border-line-default", label: "Unqualified" },
  converted: { bg: "bg-state-warning-muted", text: "text-state-warning", border: "border-state-warning/40", label: "Converted" },
};

const SCORE_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  hot: { bg: "bg-state-success-muted", text: "text-state-success", border: "border-state-success/40", label: "Hot" },
  warm: { bg: "bg-state-warning-muted", text: "text-state-warning", border: "border-state-warning/40", label: "Warm" },
  cold: { bg: "bg-surface-muted", text: "text-copy-muted", border: "border-line-default", label: "Cold" },
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
  sort = null,
  onSortChange,
  hasActiveFilters = false,
  onClearFilters,
}: LeadsTableProps) {
  const router = useRouter();

  function toggleSort(column: string) {
    const nextSort: SortState = sort?.column === column
      ? { column, direction: sort.direction === "asc" ? "desc" : "asc" }
      : { column, direction: "asc" };
    onSortChange?.(nextSort);
  }

  function renderCell(lead: Lead, column: string, isIdentityColumn: boolean) {
    const stickyClassName = isIdentityColumn ? "sticky left-12 z-10 border-r border-line-subtle bg-surface group-hover:bg-surface-raised" : undefined;
    if (isCustomFieldColumnKey(column)) {
      return <CustomFieldCell column={column} values={lead.custom_fields} className={stickyClassName} />;
    }
    switch (column) {
      case "first_name":
        const leadName = [lead.first_name, lead.last_name].filter(Boolean).join(" ");
        return (
          <TableCell className={stickyClassName}>
            <div className="flex h-8 items-center gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-control-sm)] border border-line-default bg-surface-muted text-[10px] font-semibold text-copy-secondary">
                {initials(lead)}
              </div>
              <span className="truncate text-sm font-medium text-copy-primary">{leadName || <span className="text-copy-disabled">-</span>}</span>
            </div>
          </TableCell>
        );
      case "primary_email":
        return <TableCell className={stickyClassName}><span className="font-mono text-sm tracking-tight text-copy-secondary">{lead.primary_email || <span className="text-copy-disabled">-</span>}</span></TableCell>;
      case "status": {
        const style = STATUS_STYLES[lead.status ?? ""] ?? STATUS_STYLES.new;
        return <TableCell className={stickyClassName}><Pill bg={style.bg} text={style.text} border={style.border}>{style.label}</Pill></TableCell>;
      }
      case "score": {
        const style = SCORE_STYLES[lead.score_grade ?? "cold"] ?? SCORE_STYLES.cold;
        return (
          <TableCell className={stickyClassName}>
            <Pill bg={style.bg} text={style.text} border={style.border}>{lead.score ?? 0}</Pill>
          </TableCell>
        );
      }
      case "score_grade": {
        const style = SCORE_STYLES[lead.score_grade ?? "cold"] ?? SCORE_STYLES.cold;
        return <TableCell className={stickyClassName}><Pill bg={style.bg} text={style.text} border={style.border}>{style.label}</Pill></TableCell>;
      }
      case "created_time":
        return <TableCell className={stickyClassName}><span className="text-sm text-copy-muted">{lead.created_time ? formatDateTime(lead.created_time) : "-"}</span></TableCell>;
      case "last_contacted_at":
        return <TableCell className={stickyClassName}><span className="text-sm text-copy-muted">{lead.last_contacted_at ? formatDateTime(lead.last_contacted_at) : "No activity"}</span></TableCell>;
      case "next_follow_up_at": {
        const isOverdue = Boolean(lead.next_follow_up_is_overdue);
        return (
          <TableCell className={stickyClassName}>
            {lead.next_follow_up_at ? (
              <span className={isOverdue ? "text-sm font-medium text-state-warning" : "text-sm text-copy-muted"}>
                {formatDateTime(lead.next_follow_up_at)}{isOverdue ? " · Overdue" : ""}
              </span>
            ) : <span className="text-sm text-copy-disabled">Not scheduled</span>}
          </TableCell>
        );
      }
      case "tags":
        return (
          <TableCell className={stickyClassName}>
            <div className="flex max-w-64 flex-wrap gap-1">
              {(lead.tags ?? []).length
                ? (lead.tags ?? []).map((tag) => <Pill key={tag.toLocaleLowerCase()}>{tag}</Pill>)
                : <span className="text-sm text-copy-disabled">No tags</span>}
            </div>
          </TableCell>
        );
      default:
        return <TableCell className={stickyClassName}><span className="text-sm text-copy-secondary">{String(lead[column as keyof Lead] ?? "") || <span className="text-copy-disabled">-</span>}</span></TableCell>;
    }
  }

  return (
    <ModuleTableShell isRefreshing={isRefreshing}>
      <Table className="min-w-[920px]">
        <TableHeader>
          <TableHeaderRow>
            <TableHead className="sticky left-0 z-40 w-12 border-r border-line-subtle bg-surface-raised pr-0">
              <Checkbox
                checked={currentPageSelectionState}
                onCheckedChange={(checked) => onToggleCurrentPage?.(checked === true)}
                className="h-4 w-4 rounded border border-line-strong bg-surface-raised"
                aria-label="Select current page leads"
              >
                <CheckboxIndicator className="h-3 w-3" />
              </Checkbox>
            </TableHead>
            {visibleColumns.map((column, index) => {
              const label = getReadableColumnLabel(column, columnOptions);
              const sortable = !isCustomFieldColumnKey(column) && ["first_name", "last_name", "company", "primary_email", "status", "score", "score_grade", "created_time", "last_contacted_at", "next_follow_up_at"].includes(column);
              const stickyClassName = index === 0 ? "sticky left-12 z-30 border-r border-line-subtle bg-surface-raised" : undefined;
              return sortable ? (
                <SortableHead
                  key={column}
                  sorted={sort?.column === column}
                  direction={sort?.column === column ? sort.direction : "asc"}
                  onClick={() => toggleSort(column)}
                  className={stickyClassName}
                >
                  {label}
                </SortableHead>
              ) : (
                <TableHead key={column} className={stickyClassName}>{label}</TableHead>
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
                {hasActiveFilters ? (
                  <EmptyState
                    icon={UserRoundPlus}
                    title="No leads match these filters"
                    description="Clear one or more filters and try again."
                    action={<Button type="button" variant="outline" onClick={onClearFilters}>Clear filters</Button>}
                  />
                ) : (
                  <EmptyState
                    icon={UserRoundPlus}
                    title="No leads yet"
                    description="Create your first lead or import existing records from CSV."
                    action={<Button asChild><Link href="/dashboard/sales/leads/new">Create lead</Link></Button>}
                  />
                )}
              </TableCell>
            </TableRow>
          ) : (
            leads.map((lead) => (
              <TableRow key={lead.lead_id} className="group cursor-pointer" onClick={() => router.push(`/dashboard/sales/leads/${lead.lead_id}`)}>
                <TableCell className="sticky left-0 z-20 w-12 border-r border-line-subtle bg-surface pr-0 group-hover:bg-surface-raised" onClick={(event) => event.stopPropagation()}>
                  <Checkbox
                    checked={selectedIds.includes(lead.lead_id)}
                    onCheckedChange={(checked) => onToggleRow?.(lead.lead_id, checked === true)}
                    className="h-4 w-4 rounded border border-line-strong bg-surface-raised"
                    aria-label={`Select lead ${lead.primary_email ?? lead.lead_id}`}
                  >
                    <CheckboxIndicator className="h-3 w-3" />
                  </Checkbox>
                </TableCell>
                {visibleColumns.map((column, index) => (
                  <Fragment key={column}>{renderCell(lead, column, index === 0)}</Fragment>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </ModuleTableShell>
  );
}
