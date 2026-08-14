"use client";

import { useMemo } from "react";
import { UserRoundPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CustomFieldValue } from "@/components/ui/CustomFieldValue";
import { Pill } from "@/components/ui/Pill";
import { RecordTable, type RecordTableColumn, type RecordTableSort } from "@/components/ui/RecordTable";
import type { Lead } from "@/hooks/sales/useLeads";
import type { TableColumnOption } from "@/types/table";
import { getReadableColumnLabel, isCustomFieldColumnKey } from "@/lib/moduleViewConfigs";
import { formatDateTime } from "@/lib/datetime";
import { getLeadScoreStyle, getLeadStatusStyle } from "@/lib/statusStyles";

type LeadsTableProps = {
  leads: Lead[];
  isLoading: boolean;
  isRefreshing?: boolean;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
  selectedIds?: number[];
  onToggleRow?: (leadId: number, checked: boolean) => void;
  onToggleCurrentPage?: (checked: boolean) => void;
  sort?: RecordTableSort | null;
  onSortChange?: (sort: RecordTableSort) => void;
  hasActiveFilters?: boolean;
  hasError?: boolean;
  onRetry?: () => void;
  onClearFilters?: () => void;
  /** Opens the list's Quick Create surface. Omitted when the user cannot create leads. */
  onCreateLead?: () => void;
};

const SORTABLE_COLUMNS = new Set([
  "first_name",
  "last_name",
  "company",
  "primary_email",
  "status",
  "score",
  "score_grade",
  "created_time",
  "last_contacted_at",
  "next_follow_up_at",
]);

const COLUMN_SIZES: Record<string, "sm" | "md" | "lg"> = {
  first_name: "lg",
  primary_email: "lg",
  tags: "lg",
  status: "sm",
  score: "sm",
  score_grade: "sm",
};

function initials(lead: Lead) {
  if (lead.first_name && lead.last_name) return `${lead.first_name[0]}${lead.last_name[0]}`.toUpperCase();
  if (lead.first_name) return lead.first_name[0].toUpperCase();
  if (lead.primary_email) return lead.primary_email[0].toUpperCase();
  return "?";
}

function leadName(lead: Lead) {
  return [lead.first_name, lead.last_name].filter(Boolean).join(" ");
}

function renderCell(lead: Lead, column: string) {
  if (isCustomFieldColumnKey(column)) return <CustomFieldValue column={column} values={lead.custom_fields} />;

  switch (column) {
    case "first_name":
      return (
        <div className="flex h-8 items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-control-sm)] border border-line-default bg-surface-muted text-2xs font-semibold text-copy-secondary">
            {initials(lead)}
          </div>
          <span className="truncate text-sm font-medium text-copy-primary">
            {leadName(lead) || <span className="text-copy-disabled">-</span>}
          </span>
        </div>
      );
    case "primary_email":
      return <span className="text-sm text-copy-secondary">{lead.primary_email || <span className="text-copy-disabled">-</span>}</span>;
    case "status": {
      const style = getLeadStatusStyle(lead.status ?? "");
      return <Pill bg={style.bg} text={style.text} border={style.border}>{style.label}</Pill>;
    }
    case "score": {
      const style = getLeadScoreStyle(lead.score_grade ?? "cold");
      return <Pill bg={style.bg} text={style.text} border={style.border}>{lead.score ?? 0}</Pill>;
    }
    case "score_grade": {
      const style = getLeadScoreStyle(lead.score_grade ?? "cold");
      return <Pill bg={style.bg} text={style.text} border={style.border}>{style.label}</Pill>;
    }
    case "created_time":
      return <span className="text-sm text-copy-muted">{lead.created_time ? formatDateTime(lead.created_time) : "-"}</span>;
    case "last_contacted_at":
      return <span className="text-sm text-copy-muted">{lead.last_contacted_at ? formatDateTime(lead.last_contacted_at) : "No activity"}</span>;
    case "next_follow_up_at": {
      const isOverdue = Boolean(lead.next_follow_up_is_overdue);
      return lead.next_follow_up_at ? (
        <span className={isOverdue ? "text-sm font-medium text-state-warning" : "text-sm text-copy-muted"}>
          {formatDateTime(lead.next_follow_up_at)}{isOverdue ? " · Overdue" : ""}
        </span>
      ) : (
        <span className="text-sm text-copy-disabled">Not scheduled</span>
      );
    }
    case "tags":
      return (
        <div className="flex max-w-64 flex-wrap gap-1">
          {(lead.tags ?? []).length
            ? (lead.tags ?? []).map((tag) => <Pill key={tag.toLocaleLowerCase()}>{tag}</Pill>)
            : <span className="text-sm text-copy-disabled">No tags</span>}
        </div>
      );
    default:
      return (
        <span className="text-sm text-copy-secondary">
          {String(lead[column as keyof Lead] ?? "") || <span className="text-copy-disabled">-</span>}
        </span>
      );
  }
}

export default function LeadsTable({
  leads,
  isLoading,
  isRefreshing = false,
  visibleColumns,
  columnOptions = [],
  selectedIds = [],
  onToggleRow,
  onToggleCurrentPage,
  sort = null,
  onSortChange,
  hasActiveFilters = false,
  hasError = false,
  onRetry,
  onClearFilters,
  onCreateLead,
}: LeadsTableProps) {
  const columns = useMemo<RecordTableColumn<Lead>[]>(
    () =>
      visibleColumns.map((column) => ({
        key: column,
        label: getReadableColumnLabel(column, columnOptions),
        sortable: !isCustomFieldColumnKey(column) && SORTABLE_COLUMNS.has(column),
        size: COLUMN_SIZES[column],
        render: (lead) => renderCell(lead, column),
      })),
    [visibleColumns, columnOptions],
  );

  return (
    <RecordTable
      label="Leads"
      columns={columns}
      rows={leads}
      rowKey={(lead) => lead.lead_id}
      rowHref={(lead) => `/dashboard/sales/leads/${lead.lead_id}`}
      rowLabel={(lead) => `Open lead ${leadName(lead) || lead.primary_email || lead.lead_id}`}
      selection={
        onToggleRow && onToggleCurrentPage
          ? {
              selectedIds,
              onToggleRow: (id, checked) => onToggleRow(Number(id), checked),
              onToggleAll: onToggleCurrentPage,
              rowLabel: (lead) => `Select lead ${leadName(lead) || lead.primary_email || lead.lead_id}`,
            }
          : undefined
      }
      sort={sort}
      onSortChange={onSortChange}
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      hasError={hasError}
      onRetry={onRetry}
      hasActiveFilters={hasActiveFilters}
      onClearFilters={onClearFilters}
      emptyState={{
        icon: UserRoundPlus,
        title: "No leads yet",
        description: "Create your first lead or import existing records from CSV.",
        // The toolbar's Quick Create surface, so the list has one create interaction.
        action: onCreateLead ? <Button type="button" onClick={onCreateLead}>Create lead</Button> : undefined,
      }}
      filteredEmptyState={{ icon: UserRoundPlus }}
    />
  );
}
