"use client";

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

type Props = {
  opportunities: Opportunity[];
  isLoading: boolean;
  visibleColumns: string[];
  onEdit: (opportunity: Opportunity) => void;
  onDelete: (opportunity: Opportunity) => void;
  onCreateFinanceIo: (opportunity: Opportunity) => void;
};

export default function OpportunitiesTable({
  opportunities,
  isLoading,
  visibleColumns = [],
  onEdit,
  onDelete,
  onCreateFinanceIo,
}: Props) {
  const hasColumn = (key: string) => visibleColumns.includes(key);
  const columnCount = visibleColumns.length + 1;

  return (
    <ModuleTableShell>
      <Table className="min-w-[1040px]">
        <TableHeader>
          <TableHeaderRow>
            {hasColumn("opportunity_name") && <TableHead>Opportunity</TableHead>}
            {hasColumn("client") && <TableHead>Client</TableHead>}
            {hasColumn("sales_stage") && <TableHead>Stage</TableHead>}
            {hasColumn("expected_close_date") && <TableHead>Expected Close</TableHead>}
            {hasColumn("total_cost_of_project") && <TableHead>Project Cost</TableHead>}
            {hasColumn("currency_type") && <TableHead>Currency</TableHead>}
            {hasColumn("created_time") && <TableHead>Created</TableHead>}
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
                {hasColumn("opportunity_name") && <TableCell>{opportunity.opportunity_name || "-"}</TableCell>}
                {hasColumn("client") && <TableCell>{opportunity.client || "-"}</TableCell>}
                {hasColumn("sales_stage") && <TableCell>{opportunity.sales_stage || "-"}</TableCell>}
                {hasColumn("expected_close_date") && <TableCell>{opportunity.expected_close_date || "-"}</TableCell>}
                {hasColumn("total_cost_of_project") && <TableCell>{opportunity.total_cost_of_project || "-"}</TableCell>}
                {hasColumn("currency_type") && <TableCell>{opportunity.currency_type || "-"}</TableCell>}
                {hasColumn("created_time") && <TableCell>{opportunity.created_time || "-"}</TableCell>}
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
