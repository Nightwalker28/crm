"use client";

import { Fragment } from "react";
import { BriefcaseBusiness } from "lucide-react";

import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { ModuleTableLoading } from "@/components/ui/ModuleTableLoading";
import { CustomFieldCell } from "@/components/ui/CustomFieldCell";
import { Pill } from "@/components/ui/Pill";
import { EmptyState } from "@/components/ui/EmptyState";
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
import { getReadableColumnLabel, isCustomFieldColumnKey } from "@/lib/moduleViewConfigs";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";
import { getOpportunityStageLabel } from "@/components/opportunities/opportunityStages";
import { getOpportunityStageStyle } from "@/lib/statusStyles";

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
}: Props) {
  const columnCount = visibleColumns.length + 1;
  const headers: Record<string, string> = {
    opportunity_name: "Deal",
    client: "Client",
    sales_stage: "Stage",
    expected_close_date: "Expected Close",
    total_cost_of_project: "Project Cost",
    currency_type: "Currency",
    created_time: "Created",
  };

  const renderCell = (opportunity: Opportunity, column: string) => {
    if (isCustomFieldColumnKey(column)) {
      return <CustomFieldCell column={column} values={opportunity.custom_fields} />;
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
          </TableHeaderRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <ModuleTableLoading columnCount={columnCount} />
          ) : opportunities.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columnCount} className="py-16 text-center">
                <EmptyState icon={BriefcaseBusiness} title="No deals found" description="Deals matching the current view will appear here." />
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
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </ModuleTableShell>
  );
}
