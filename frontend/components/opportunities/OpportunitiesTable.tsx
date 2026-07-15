"use client";

import { Fragment } from "react";
import { BriefcaseBusiness } from "lucide-react";

import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { ModuleTableLoading } from "@/components/ui/ModuleTableLoading";
import { CustomFieldCell } from "@/components/ui/CustomFieldCell";
import { Pill } from "@/components/ui/Pill";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/button";
import { Checkbox, CheckboxIndicator } from "@/components/ui/checkbox";
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
import type { Opportunity } from "@/hooks/sales/useOpportunities";
import type { TableColumnOption } from "@/hooks/useTablePreferences";
import { getReadableColumnLabel, isCustomFieldColumnKey } from "@/lib/moduleViewConfigs";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";
import { getOpportunityStageLabel, getOpportunityStageStyle } from "@/components/opportunities/opportunityStages";

type SortState = { column: string; direction: "asc" | "desc" } | null;

type Props = {
  opportunities: Opportunity[];
  isLoading: boolean;
  isRefreshing?: boolean;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
  onEdit: (opportunity: Opportunity) => void;
  selectedIds?: number[];
  currentPageSelectionState?: boolean | "indeterminate";
  onToggleRow?: (opportunityId: number, checked: boolean) => void;
  onToggleCurrentPage?: (checked: boolean) => void;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
};

function isOverdue(dateStr?: string | null): boolean {
  if (!dateStr) return false;
  try {
    return new Date(dateStr) < new Date();
  } catch {
    return false;
  }
}

export default function OpportunitiesTable({
  opportunities,
  isLoading,
  isRefreshing = false,
  visibleColumns = [],
  columnOptions = [],
  onEdit,
  selectedIds = [],
  currentPageSelectionState = false,
  onToggleRow,
  onToggleCurrentPage,
  sort = null,
  onSortChange,
  hasActiveFilters = false,
  onClearFilters,
}: Props) {
  const columnCount = visibleColumns.length + 1;
  const headers: Record<string, string> = {
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
  const sortableColumns = new Set([
    "opportunity_name",
    "client",
    "sales_stage",
    "expected_close_date",
    "probability_percent",
    "total_cost_of_project",
    "currency_type",
    "created_time",
  ]);

  function toggleSort(column: string) {
    const nextSort: SortState = sort?.column === column
      ? { column, direction: sort.direction === "asc" ? "desc" : "asc" }
      : { column, direction: "asc" };
    onSortChange?.(nextSort);
  }

  const renderCell = (opportunity: Opportunity, column: string, isIdentityColumn: boolean) => {
    const stickyClassName = isIdentityColumn ? "sticky left-12 z-10 border-r border-line-subtle bg-neutral-950 group-hover:bg-neutral-900" : undefined;
    if (isCustomFieldColumnKey(column)) {
      return <CustomFieldCell column={column} values={opportunity.custom_fields} className={stickyClassName} />;
    }

    switch (column) {
      case "opportunity_name":
        return (
          <TableCell className={stickyClassName}>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-neutral-100 truncate max-w-[220px]">
                {opportunity.opportunity_name || <span className="text-neutral-600">—</span>}
              </span>
            </div>
          </TableCell>
        );
      case "client":
      case "contact_name":
        return (
          <TableCell>
            {opportunity.contact_name || opportunity.client ? (
              <span className="text-sm text-sky-300 font-medium">{opportunity.contact_name || opportunity.client}</span>
            ) : (
              <span className="text-neutral-600 text-sm">—</span>
            )}
          </TableCell>
        );
      case "organization_name":
        return <TableCell><span className="text-sm text-neutral-300">{opportunity.organization_name || "—"}</span></TableCell>;
      case "assigned_to_name":
        return <TableCell><span className="text-sm text-neutral-300">{opportunity.assigned_to_name || "Unassigned"}</span></TableCell>;
      case "sales_stage":
        return (
          <TableCell>
            {opportunity.sales_stage ? (() => {
              const style = getOpportunityStageStyle(opportunity.sales_stage);
              const label = getOpportunityStageLabel(opportunity.sales_stage);
              return (
                <Pill bg={style.bg} text={style.text} border={style.border} className="w-28">
                  {label}
                </Pill>
              );
            })() : <span className="text-neutral-600 text-sm">—</span>}
          </TableCell>
        );
      case "expected_close_date":
        return (
          <TableCell>
            {opportunity.expected_close_date ? (
              <span className={`text-sm font-medium tabular-nums ${
                isOverdue(opportunity.expected_close_date) && opportunity.sales_stage !== "closed_won" && opportunity.sales_stage !== "closed_lost"
                  ? "text-red-400"
                  : "text-neutral-300"
              }`}>
                {formatDateOnly(opportunity.expected_close_date)}
              </span>
            ) : (
              <span className="text-neutral-600 text-sm">—</span>
            )}
          </TableCell>
        );
      case "total_cost_of_project":
        return (
          <TableCell>
            {opportunity.total_cost_of_project ? (
              <span className="text-sm font-semibold text-emerald-300 tabular-nums">
                {opportunity.total_cost_of_project}
              </span>
            ) : (
              <span className="text-neutral-600 text-sm">—</span>
            )}
          </TableCell>
        );
      case "probability_percent":
        return (
          <TableCell>
            {opportunity.probability_percent !== null && opportunity.probability_percent !== undefined && opportunity.probability_percent !== "" ? (
              <span className="text-sm font-medium text-neutral-300 tabular-nums">
                {Number(opportunity.probability_percent).toLocaleString(undefined, { maximumFractionDigits: 2 })}%
              </span>
            ) : (
              <span className="text-neutral-600 text-sm">Stage default</span>
            )}
          </TableCell>
        );
      case "currency_type":
        return (
          <TableCell>
            {opportunity.currency_type ? (
              <span className="text-xs font-bold text-neutral-400 tracking-wider bg-neutral-800/60 border border-neutral-700/50 rounded px-1.5 py-0.5">
                {opportunity.currency_type}
              </span>
            ) : (
              <span className="text-neutral-600 text-sm">—</span>
            )}
          </TableCell>
        );
      case "created_time":
        return (
          <TableCell>
            <span className="text-sm text-neutral-500 tabular-nums">
              {opportunity.created_time ? formatDateTime(opportunity.created_time, { hour: "numeric", minute: "2-digit" }) : <span className="text-neutral-600">—</span>}
            </span>
          </TableCell>
        );
      default:
        return null;
    }
  };

  return (
    <ModuleTableShell isRefreshing={isRefreshing}>
      <Table className="min-w-[1040px]">
        <TableHeader>
          <TableHeaderRow>
            <TableHead className="sticky left-0 z-40 w-12 border-r border-line-subtle bg-neutral-900 pr-0">
              <Checkbox
                checked={currentPageSelectionState}
                onCheckedChange={(checked) => onToggleCurrentPage?.(checked === true)}
                className="h-4 w-4 rounded border border-neutral-700 bg-neutral-900"
                aria-label="Select current page opportunities"
              >
                <CheckboxIndicator className="h-3 w-3" />
              </Checkbox>
            </TableHead>
            {visibleColumns.map((column, index) => {
              const label = headers[column] ?? getReadableColumnLabel(column, columnOptions);
              if (!sortableColumns.has(column)) {
                return <TableHead key={column} className={index === 0 ? "sticky left-12 z-30 border-r border-line-subtle bg-neutral-900" : undefined}>{label}</TableHead>;
              }
              const isSorted = sort?.column === column;
              return (
                <SortableHead
                  key={column}
                  sorted={isSorted}
                  direction={isSorted ? sort.direction : "asc"}
                  onClick={() => toggleSort(column)}
                  className={index === 0 ? "sticky left-12 z-30 border-r border-line-subtle bg-neutral-900" : undefined}
                >
                  {label}
                </SortableHead>
              );
            })}
          </TableHeaderRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <ModuleTableLoading columnCount={columnCount} />
          ) : opportunities.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columnCount} className="py-16 text-center">
                <EmptyState icon={BriefcaseBusiness} title={hasActiveFilters ? "No matching deals" : "No deals yet"} description={hasActiveFilters ? "Try changing or clearing the current search and filters." : "Create your first deal to start tracking the pipeline."} action={hasActiveFilters && onClearFilters ? <Button variant="outline" onClick={onClearFilters}>Clear filters</Button> : undefined} />
              </TableCell>
            </TableRow>
          ) : (
            opportunities.map((opportunity) => (
              <TableRow
                key={opportunity.opportunity_id}
                className="group cursor-pointer"
                onClick={() => onEdit(opportunity)}
              >
                <TableCell
                  className="sticky left-0 z-20 w-12 border-r border-line-subtle bg-neutral-950 pr-0 group-hover:bg-neutral-900"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Checkbox
                    checked={selectedIds.includes(opportunity.opportunity_id)}
                    onCheckedChange={(checked) => onToggleRow?.(opportunity.opportunity_id, checked === true)}
                    className="h-4 w-4 rounded border border-neutral-700 bg-neutral-900"
                    aria-label={`Select opportunity ${opportunity.opportunity_name}`}
                  >
                    <CheckboxIndicator className="h-3 w-3" />
                  </Checkbox>
                </TableCell>
                {visibleColumns.map((column, index) => (
                  <Fragment key={column}>{renderCell(opportunity, column, index === 0)}</Fragment>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </ModuleTableShell>
  );
}
