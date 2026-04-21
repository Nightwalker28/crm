"use client";

import { Fragment } from "react";
import { HandCoins } from "lucide-react";

import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { ModuleTableLoading } from "@/components/ui/ModuleTableLoading";
import { Pill } from "@/components/ui/Pill";
import { Checkbox, CheckboxIndicator } from "@/components/ui/checkbox";
import {
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
import { getCustomFieldKeyFromColumn, getReadableColumnLabel, isCustomFieldColumnKey } from "@/lib/moduleViewConfigs";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";
import { getOpportunityStageLabel, getOpportunityStageStyle } from "@/components/opportunities/opportunityStages";

type Props = {
  opportunities: Opportunity[];
  isLoading: boolean;
  isRefreshing?: boolean;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
  onEdit: (opportunity: Opportunity) => void;
  onCreateFinanceIo: (opportunity: Opportunity) => void;
  selectedIds?: number[];
  currentPageSelectionState?: boolean | "indeterminate";
  onToggleRow?: (opportunityId: number, checked: boolean) => void;
  onToggleCurrentPage?: (checked: boolean) => void;
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
  onCreateFinanceIo,
  selectedIds = [],
  currentPageSelectionState = false,
  onToggleRow,
  onToggleCurrentPage,
}: Props) {
  const columnCount = visibleColumns.length + 1;
  const headers: Record<string, string> = {
    opportunity_name: "Opportunity",
    client: "Client",
    sales_stage: "Stage",
    expected_close_date: "Expected Close",
    total_cost_of_project: "Project Cost",
    currency_type: "Currency",
    created_time: "Created",
  };

  const renderCell = (opportunity: Opportunity, column: string) => {
    if (isCustomFieldColumnKey(column)) {
      const fieldKey = getCustomFieldKeyFromColumn(column);
      const value = opportunity.custom_fields?.[fieldKey];
      return (
        <TableCell>
          <span className="text-sm text-neutral-300">
            {value == null || value === "" ? (
              <span className="text-neutral-600">—</span>
            ) : String(value)}
          </span>
        </TableCell>
      );
    }

    switch (column) {
      case "opportunity_name":
        return (
          <TableCell>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-neutral-100 truncate max-w-[220px]">
                {opportunity.opportunity_name || <span className="text-neutral-600">—</span>}
              </span>
            </div>
          </TableCell>
        );
      case "client":
        return (
          <TableCell>
            {opportunity.client ? (
              <span className="text-sm text-sky-300 font-medium">{opportunity.client}</span>
            ) : (
              <span className="text-neutral-600 text-sm">—</span>
            )}
          </TableCell>
        );
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
            <TableHead className="w-12 pr-0">
              <Checkbox
                checked={currentPageSelectionState}
                onCheckedChange={(checked) => onToggleCurrentPage?.(checked === true)}
                className="h-4 w-4 rounded border border-neutral-700 bg-neutral-900"
                aria-label="Select current page opportunities"
              >
                <CheckboxIndicator className="h-3 w-3" />
              </Checkbox>
            </TableHead>
            {visibleColumns.map((column) => (
              <TableHead key={column}>
                {headers[column] ?? getReadableColumnLabel(column, columnOptions)}
              </TableHead>
            ))}
            <TableHead className="text-right pr-5">Actions</TableHead>
          </TableHeaderRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <ModuleTableLoading columnCount={columnCount} />
          ) : opportunities.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columnCount} className="py-16 text-center">
                <div className="flex flex-col items-center gap-2 text-neutral-500">
                  <svg className="w-8 h-8 text-neutral-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  <span className="text-sm">No opportunities found</span>
                </div>
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
                  className="w-12 pr-0"
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
                {visibleColumns.map((column) => (
                  <Fragment key={column}>{renderCell(opportunity, column)}</Fragment>
                ))}
                <TableCell
                  className="text-right pr-4"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => onCreateFinanceIo(opportunity)}
                      className="p-1.5 rounded-md text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40 transition-colors"
                      title="Create finance IO"
                    >
                      <HandCoins size={14} />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </ModuleTableShell>
  );
}
