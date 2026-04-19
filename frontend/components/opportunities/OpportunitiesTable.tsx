"use client";

import { Fragment } from "react";
import { HandCoins, Pencil, Trash2 } from "lucide-react";

import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
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

type Props = {
  opportunities: Opportunity[];
  isLoading: boolean;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
  onEdit: (opportunity: Opportunity) => void;
  onDelete: (opportunity: Opportunity) => void;
  onCreateFinanceIo: (opportunity: Opportunity) => void;
  selectedIds?: number[];
  currentPageSelectionState?: boolean | "indeterminate";
  onToggleRow?: (opportunityId: number, checked: boolean) => void;
  onToggleCurrentPage?: (checked: boolean) => void;
};

const STAGE_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  lead: { bg: "bg-neutral-800/60", text: "text-neutral-300", border: "border-neutral-700/50" },
  qualified: { bg: "bg-sky-900/30", text: "text-sky-300", border: "border-sky-700/40" },
  proposal: { bg: "bg-violet-900/30", text: "text-violet-300", border: "border-violet-700/40" },
  negotiation: { bg: "bg-amber-900/30", text: "text-amber-300", border: "border-amber-700/40" },
  closed_won: { bg: "bg-emerald-900/30", text: "text-emerald-300", border: "border-emerald-700/40" },
  closed_lost: { bg: "bg-red-900/30", text: "text-red-300", border: "border-red-700/40" },
};

const STAGE_LABELS: Record<string, string> = {
  lead: "Lead",
  qualified: "Qualified",
  proposal: "Proposal",
  negotiation: "Negotiation",
  closed_won: "Closed Won",
  closed_lost: "Closed Lost",
};

function getStagePillStyle(stage?: string | null) {
  const key = (stage ?? "").toLowerCase().replace(/\s+/g, "_");
  return STAGE_STYLES[key] ?? { bg: "bg-neutral-800/60", text: "text-neutral-400", border: "border-neutral-700/50" };
}

function formatDate(value?: string | null): string {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
  } catch {
    return value;
  }
}

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
  visibleColumns = [],
  columnOptions = [],
  onEdit,
  onDelete,
  onCreateFinanceIo,
  selectedIds = [],
  currentPageSelectionState = false,
  onToggleRow,
  onToggleCurrentPage,
}: Props) {
  const columnCount = visibleColumns.length + 2;
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
              const style = getStagePillStyle(opportunity.sales_stage);
              const label = STAGE_LABELS[opportunity.sales_stage.toLowerCase().replace(/\s+/g, "_")] ?? opportunity.sales_stage;
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
                {formatDate(opportunity.expected_close_date)}
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
              {opportunity.created_time ? formatDate(opportunity.created_time) : <span className="text-neutral-600">—</span>}
            </span>
          </TableCell>
        );
      default:
        return null;
    }
  };

  return (
    <ModuleTableShell>
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
            <TableRow>
              <TableCell colSpan={columnCount} className="py-16 text-center">
                <div className="flex flex-col items-center gap-3 text-neutral-500">
                  <div className="h-5 w-5 rounded-full border-2 border-neutral-700 border-t-neutral-400 animate-spin" />
                  <span className="text-sm">Loading opportunities...</span>
                </div>
              </TableCell>
            </TableRow>
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
              <TableRow key={opportunity.opportunity_id} className="group">
                <TableCell className="w-12 pr-0">
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
                <TableCell className="text-right pr-4">
                  <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                    <button
                      onClick={() => onCreateFinanceIo(opportunity)}
                      className="p-1.5 rounded-md text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40 transition-colors"
                      title="Create finance IO"
                    >
                      <HandCoins size={14} />
                    </button>
                    <button
                      onClick={() => onEdit(opportunity)}
                      className="p-1.5 rounded-md text-sky-400 hover:text-sky-300 hover:bg-sky-950/40 transition-colors"
                      title="Edit opportunity"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => onDelete(opportunity)}
                      className="p-1.5 rounded-md text-red-400 hover:text-red-300 hover:bg-red-950/40 transition-colors"
                      title="Delete opportunity"
                    >
                      <Trash2 size={14} />
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
