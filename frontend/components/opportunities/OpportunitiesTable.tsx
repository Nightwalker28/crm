"use client";

import { Fragment } from "react";
import { HandCoins, Pencil, Trash2 } from "lucide-react";

import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
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
import { getCustomFieldKeyFromColumn, isCustomFieldColumnKey } from "@/lib/moduleViewConfigs";

type Props = {
  opportunities: Opportunity[];
  isLoading: boolean;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
  onEdit: (opportunity: Opportunity) => void;
  onDelete: (opportunity: Opportunity) => void;
  onCreateFinanceIo: (opportunity: Opportunity) => void;
};

export default function OpportunitiesTable({
  opportunities,
  isLoading,
  visibleColumns = [],
  columnOptions = [],
  onEdit,
  onDelete,
  onCreateFinanceIo,
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
  const columnLabels = new Map(columnOptions.map((option) => [option.key, option.label]));

  const renderCell = (opportunity: Opportunity, column: string) => {
    if (isCustomFieldColumnKey(column)) {
      const fieldKey = getCustomFieldKeyFromColumn(column);
      const value = opportunity.custom_fields?.[fieldKey];
      return <TableCell>{value == null || value === "" ? "-" : String(value)}</TableCell>;
    }
    switch (column) {
      case "opportunity_name":
        return <TableCell>{opportunity.opportunity_name || "-"}</TableCell>;
      case "client":
        return <TableCell>{opportunity.client || "-"}</TableCell>;
      case "sales_stage":
        return <TableCell>{opportunity.sales_stage || "-"}</TableCell>;
      case "expected_close_date":
        return <TableCell>{opportunity.expected_close_date || "-"}</TableCell>;
      case "total_cost_of_project":
        return <TableCell>{opportunity.total_cost_of_project || "-"}</TableCell>;
      case "currency_type":
        return <TableCell>{opportunity.currency_type || "-"}</TableCell>;
      case "created_time":
        return <TableCell>{opportunity.created_time || "-"}</TableCell>;
      default:
        return null;
    }
  };

  return (
    <ModuleTableShell>
      <Table className="min-w-[1040px]">
        <TableHeader>
          <TableHeaderRow>
            {visibleColumns.map((column) => (
              <TableHead key={column}>{headers[column] ?? columnLabels.get(column) ?? column}</TableHead>
            ))}
            <TableHead className="text-right">Actions</TableHead>
          </TableHeaderRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={columnCount} className="py-10 text-center text-neutral-500">Loading opportunities...</TableCell>
            </TableRow>
          ) : opportunities.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columnCount} className="py-10 text-center text-neutral-500">No opportunities found.</TableCell>
            </TableRow>
          ) : (
            opportunities.map((opportunity) => (
              <TableRow key={opportunity.opportunity_id}>
                {visibleColumns.map((column) => (
                  <Fragment key={column}>{renderCell(opportunity, column)}</Fragment>
                ))}
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-3">
                    <button onClick={() => onCreateFinanceIo(opportunity)} className="text-emerald-300 hover:text-emerald-200" title="Create finance IO">
                      <HandCoins size={16} />
                    </button>
                    <button onClick={() => onEdit(opportunity)} className="text-blue-300 hover:text-blue-200" title="Edit opportunity">
                      <Pencil size={16} />
                    </button>
                    <button onClick={() => onDelete(opportunity)} className="text-red-300 hover:text-red-200" title="Delete opportunity">
                      <Trash2 size={16} />
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
