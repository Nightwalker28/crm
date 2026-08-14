"use client";

import { useMemo } from "react";
import Link from "next/link";
import { BriefcaseBusiness } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CustomFieldValue } from "@/components/ui/CustomFieldValue";
import { Pill } from "@/components/ui/Pill";
import { RecordTable, type RecordTableColumn, type RecordTableSort } from "@/components/ui/RecordTable";
import type { Opportunity } from "@/hooks/sales/useOpportunities";
import type { TableColumnOption } from "@/types/table";
import { getReadableColumnLabel, isCustomFieldColumnKey } from "@/lib/moduleViewConfigs";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";
import { getOpportunityStageLabel, getOpportunityStageStyle } from "@/components/opportunities/opportunityStages";

type Props = {
  opportunities: Opportunity[];
  isLoading: boolean;
  isRefreshing?: boolean;
  hasError?: boolean;
  onRetry?: () => void;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
  onEdit: (opportunity: Opportunity) => void;
  selectedIds?: number[];
  onToggleRow?: (opportunityId: number, checked: boolean) => void;
  onToggleCurrentPage?: (checked: boolean) => void;
  sort?: RecordTableSort | null;
  onSortChange?: (sort: RecordTableSort) => void;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
};

const HEADERS: Record<string, string> = {
  opportunity_name: "Deal",
  client: "Contact",
  contact_name: "Contact",
  organization_name: "Account",
  assigned_to_name: "Owner",
  sales_stage: "Stage",
  expected_close_date: "Expected Close",
  probability_percent: "Probability",
  total_cost_of_project: "Project Cost",
  currency_type: "Currency",
  created_time: "Created",
};

const SORTABLE_COLUMNS = new Set([
  "opportunity_name",
  "client",
  "sales_stage",
  "expected_close_date",
  "probability_percent",
  "total_cost_of_project",
  "currency_type",
  "created_time",
]);

const COLUMN_SIZES: Record<string, "sm" | "md" | "lg"> = {
  opportunity_name: "lg",
  organization_name: "lg",
  currency_type: "sm",
  probability_percent: "sm",
};

function isOverdue(dateStr?: string | null): boolean {
  if (!dateStr) return false;
  try {
    return new Date(dateStr) < new Date();
  } catch {
    return false;
  }
}

function renderCell(opportunity: Opportunity, column: string) {
  if (isCustomFieldColumnKey(column)) return <CustomFieldValue column={column} values={opportunity.custom_fields} />;

  switch (column) {
    case "opportunity_name":
      return (
        <span className="block max-w-[220px] truncate text-sm font-semibold text-copy-primary">
          {opportunity.opportunity_name || <span className="text-copy-disabled">—</span>}
        </span>
      );
    case "client":
    case "contact_name":
      return opportunity.contact_name || opportunity.client ? (
        <span className="text-sm font-medium text-action-primary">{opportunity.contact_name || opportunity.client}</span>
      ) : (
        <span className="text-sm text-copy-disabled">—</span>
      );
    case "organization_name":
      return <span className="text-sm text-copy-secondary">{opportunity.organization_name || "—"}</span>;
    case "assigned_to_name":
      return <span className="text-sm text-copy-secondary">{opportunity.assigned_to_name || "Unassigned"}</span>;
    case "sales_stage": {
      if (!opportunity.sales_stage) return <span className="text-sm text-copy-disabled">—</span>;
      const style = getOpportunityStageStyle(opportunity.sales_stage);
      return (
        <Pill bg={style.bg} text={style.text} border={style.border} className="w-28">
          {getOpportunityStageLabel(opportunity.sales_stage)}
        </Pill>
      );
    }
    case "expected_close_date": {
      if (!opportunity.expected_close_date) return <span className="text-sm text-copy-disabled">—</span>;
      const overdue =
        isOverdue(opportunity.expected_close_date) &&
        opportunity.sales_stage !== "closed_won" &&
        opportunity.sales_stage !== "closed_lost";
      return (
        <span className={`text-sm font-medium tabular-nums ${overdue ? "text-state-danger" : "text-copy-secondary"}`}>
          {formatDateOnly(opportunity.expected_close_date)}
        </span>
      );
    }
    case "total_cost_of_project":
      return opportunity.total_cost_of_project ? (
        <span className="text-sm font-semibold tabular-nums text-state-success">{opportunity.total_cost_of_project}</span>
      ) : (
        <span className="text-sm text-copy-disabled">—</span>
      );
    case "probability_percent":
      return opportunity.probability_percent !== null &&
        opportunity.probability_percent !== undefined &&
        opportunity.probability_percent !== "" ? (
        <span className="text-sm font-medium tabular-nums text-copy-secondary">
          {Number(opportunity.probability_percent).toLocaleString(undefined, { maximumFractionDigits: 2 })}%
        </span>
      ) : (
        <span className="text-sm text-copy-disabled">Stage default</span>
      );
    case "currency_type":
      return opportunity.currency_type ? (
        <span className="rounded-[var(--radius-control-sm)] border border-line-default bg-surface-muted px-1.5 py-0.5 text-xs font-medium text-copy-muted">
          {opportunity.currency_type}
        </span>
      ) : (
        <span className="text-sm text-copy-disabled">—</span>
      );
    case "created_time":
      return (
        <span className="text-sm tabular-nums text-copy-muted">
          {opportunity.created_time
            ? formatDateTime(opportunity.created_time, { hour: "numeric", minute: "2-digit" })
            : <span className="text-copy-disabled">—</span>}
        </span>
      );
    default:
      return null;
  }
}

export default function OpportunitiesTable({
  opportunities,
  isLoading,
  isRefreshing = false,
  hasError = false,
  onRetry,
  visibleColumns = [],
  columnOptions = [],
  onEdit,
  selectedIds = [],
  onToggleRow,
  onToggleCurrentPage,
  sort = null,
  onSortChange,
  hasActiveFilters = false,
  onClearFilters,
}: Props) {
  const columns = useMemo<RecordTableColumn<Opportunity>[]>(
    () =>
      visibleColumns.map((column) => ({
        key: column,
        label: HEADERS[column] ?? getReadableColumnLabel(column, columnOptions),
        sortable: !isCustomFieldColumnKey(column) && SORTABLE_COLUMNS.has(column),
        size: COLUMN_SIZES[column],
        render: (opportunity) => renderCell(opportunity, column),
      })),
    [visibleColumns, columnOptions],
  );

  return (
    <RecordTable
      label="Deals"
      columns={columns}
      rows={opportunities}
      rowKey={(opportunity) => opportunity.opportunity_id}
      onOpenRow={onEdit}
      rowLabel={(opportunity) => `Open deal ${opportunity.opportunity_name}`}
      selection={
        onToggleRow && onToggleCurrentPage
          ? {
              selectedIds,
              onToggleRow: (id, checked) => onToggleRow(Number(id), checked),
              onToggleAll: onToggleCurrentPage,
              rowLabel: (opportunity) => `Select deal ${opportunity.opportunity_name}`,
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
        icon: BriefcaseBusiness,
        title: "No deals yet",
        description: "Create your first deal to start tracking the pipeline.",
        action: <Button asChild><Link href="/dashboard/sales/opportunities/new">Add deal</Link></Button>,
      }}
      filteredEmptyState={{
        icon: BriefcaseBusiness,
        title: "No matching deals",
        description: "Try changing or clearing the current search and filters.",
      }}
    />
  );
}
