"use client";

import { Fragment } from "react";
import { useRouter } from "next/navigation";
import { FileSignature } from "lucide-react";

import { SortableHead, Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { ModuleTableLoading } from "@/components/ui/ModuleTableLoading";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { Pill } from "@/components/ui/Pill";
import type { Contract, ContractSortState } from "@/hooks/contracts/useContracts";
import type { TableColumnOption } from "@/hooks/useTablePreferences";
import { formatDateTime } from "@/lib/datetime";
import { getReadableColumnLabel } from "@/lib/moduleViewConfigs";

type ContractsTableProps = {
  contracts: Contract[];
  isLoading: boolean;
  isRefreshing?: boolean;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
  sort?: ContractSortState;
  onSortChange?: (sort: ContractSortState) => void;
};

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  draft: { bg: "bg-neutral-800/40", text: "text-neutral-300", border: "border-neutral-700/40", label: "Draft" },
  review: { bg: "bg-blue-900/30", text: "text-blue-300", border: "border-blue-700/40", label: "Review" },
  sent: { bg: "bg-sky-900/30", text: "text-sky-300", border: "border-sky-700/40", label: "Sent" },
  partially_signed: { bg: "bg-amber-900/30", text: "text-amber-300", border: "border-amber-700/40", label: "Partially Signed" },
  signed: { bg: "bg-emerald-900/30", text: "text-emerald-300", border: "border-emerald-700/40", label: "Signed" },
  active: { bg: "bg-teal-900/30", text: "text-teal-300", border: "border-teal-700/40", label: "Active" },
  expired: { bg: "bg-orange-900/30", text: "text-orange-300", border: "border-orange-700/40", label: "Expired" },
  cancelled: { bg: "bg-red-900/30", text: "text-red-300", border: "border-red-700/40", label: "Cancelled" },
};

function formatMoney(value: Contract["value_amount"], currency: string | null) {
  if (value === null || value === undefined || value === "") return "-";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return `${currency || "USD"} ${numeric.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function nextSort(current: ContractSortState, column: string): ContractSortState {
  return current?.key === column
    ? { key: column, direction: current.direction === "asc" ? "desc" : "asc" }
    : { key: column, direction: "asc" };
}

function renderPrimitive(value: unknown) {
  if (value == null || value === "") return "-";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return "-";
}

export default function ContractsTable({ contracts, isLoading, isRefreshing = false, visibleColumns, columnOptions = [], sort = null, onSortChange }: ContractsTableProps) {
  const router = useRouter();

  function renderCell(item: Contract, column: string) {
    switch (column) {
      case "contract_number":
        return <TableCell><span className="font-mono text-sm font-medium text-neutral-100">{item.contract_number}</span></TableCell>;
      case "title":
        return <TableCell><span className="text-sm font-medium text-neutral-100">{item.title}</span></TableCell>;
      case "status": {
        const style = STATUS_STYLES[item.status] ?? STATUS_STYLES.draft;
        return <TableCell><Pill bg={style.bg} text={style.text} border={style.border}>{style.label}</Pill></TableCell>;
      }
      case "value_amount":
        return <TableCell><span className="text-sm text-neutral-300">{formatMoney(item.value_amount, item.currency)}</span></TableCell>;
      case "created_at":
      case "updated_at":
        return <TableCell><span className="text-sm text-neutral-400">{item[column] ? formatDateTime(String(item[column])) : "-"}</span></TableCell>;
      case "effective_date":
      case "expiration_date":
      case "renewal_date":
        return <TableCell><span className="text-sm text-neutral-400">{item[column] ?? "-"}</span></TableCell>;
      default:
        return <TableCell><span className="text-sm text-neutral-300">{renderPrimitive(item[column as keyof Contract])}</span></TableCell>;
    }
  }

  return (
    <ModuleTableShell isRefreshing={isRefreshing}>
      <Table className="min-w-[1160px]">
        <TableHeader>
          <TableHeaderRow>
            {visibleColumns.map((column) => {
              const label = getReadableColumnLabel(column, columnOptions);
              const sortable = ["contract_number", "title", "status", "value_amount", "effective_date", "expiration_date", "renewal_date", "created_at", "updated_at"].includes(column);
              return sortable && onSortChange ? (
                <SortableHead key={column} sorted={sort?.key === column} direction={sort?.key === column ? sort.direction : "asc"} onClick={() => onSortChange(nextSort(sort, column))}>
                  {label}
                </SortableHead>
              ) : <TableHead key={column}>{label}</TableHead>;
            })}
          </TableHeaderRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <ModuleTableLoading columnCount={visibleColumns.length} />
          ) : contracts.length === 0 ? (
            <TableRow>
              <TableCell colSpan={visibleColumns.length} className="py-16 text-center">
                <EmptyState icon={FileSignature} title="No contracts found" description="Contracts matching this view will appear here." />
              </TableCell>
            </TableRow>
          ) : (
            contracts.map((item) => (
              <TableRow key={item.id} className="group cursor-pointer" onClick={() => router.push(`/dashboard/contracts/${item.id}`)}>
                {visibleColumns.map((column) => <Fragment key={column}>{renderCell(item, column)}</Fragment>)}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </ModuleTableShell>
  );
}
