"use client";

import { useMemo } from "react";
import Link from "next/link";
import { FileSignature } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/Pill";
import { RecordTable, type RecordTableColumn } from "@/components/ui/RecordTable";
import type { Contract, ContractSortState } from "@/hooks/contracts/useContracts";
import type { TableColumnOption } from "@/types/table";
import { formatDateTime } from "@/lib/datetime";
import { getReadableColumnLabel } from "@/lib/moduleViewConfigs";
import { getContractStatusStyle } from "@/lib/statusStyles";

type ContractsTableProps = {
  contracts: Contract[];
  isLoading: boolean;
  isRefreshing?: boolean;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
  sort?: ContractSortState;
  onSortChange?: (sort: ContractSortState) => void;
  hasActiveFilters?: boolean;
  hasError?: boolean;
  onRetry?: () => void;
  canCreate?: boolean;
  onClearFilters?: () => void;
};

const SORTABLE_COLUMNS = new Set([
  "contract_number",
  "title",
  "status",
  "value_amount",
  "effective_date",
  "expiration_date",
  "renewal_date",
  "created_at",
  "updated_at",
]);

const COLUMN_SIZES: Record<string, "sm" | "md" | "lg"> = {
  title: "lg",
  contract_number: "sm",
  status: "sm",
  currency: "sm",
};

function formatMoney(value: Contract["value_amount"], currency: string | null) {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return `${currency || "USD"} ${numeric.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function renderPrimitive(value: unknown) {
  if (value == null || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return "—";
}

function renderCell(item: Contract, column: string) {
  switch (column) {
    case "contract_number":
      return <span className="text-sm font-medium tabular-nums text-copy-primary">{item.contract_number}</span>;
    case "title":
      return <span className="block max-w-[300px] truncate text-sm font-medium text-copy-primary">{item.title}</span>;
    case "status": {
      const style = getContractStatusStyle(item.status);
      return <Pill bg={style.bg} text={style.text} border={style.border}>{style.label}</Pill>;
    }
    case "value_amount":
      return <span className="text-sm tabular-nums text-copy-primary">{formatMoney(item.value_amount, item.currency)}</span>;
    case "created_at":
    case "updated_at":
      return <span className="text-sm text-copy-muted">{item[column] ? formatDateTime(String(item[column])) : "—"}</span>;
    case "effective_date":
    case "expiration_date":
    case "renewal_date":
      return <span className="text-sm text-copy-secondary">{item[column] ?? "—"}</span>;
    default:
      return <span className="text-sm text-copy-secondary">{renderPrimitive(item[column as keyof Contract])}</span>;
  }
}

export default function ContractsTable({
  contracts,
  isLoading,
  isRefreshing = false,
  visibleColumns,
  columnOptions = [],
  sort = null,
  onSortChange,
  hasActiveFilters = false,
  hasError = false,
  onRetry,
  canCreate = false,
  onClearFilters,
}: ContractsTableProps) {
  const columns = useMemo<RecordTableColumn<Contract>[]>(
    () =>
      visibleColumns.map((column) => ({
        key: column,
        label: getReadableColumnLabel(column, columnOptions),
        sortable: SORTABLE_COLUMNS.has(column),
        size: COLUMN_SIZES[column],
        align: column === "value_amount" ? "right" : "left",
        render: (item) => renderCell(item, column),
      })),
    [visibleColumns, columnOptions],
  );

  return (
    <RecordTable
      label="Contracts"
      columns={columns}
      rows={contracts}
      rowKey={(item) => item.id}
      rowHref={(item) => `/dashboard/contracts/${item.id}`}
      rowLabel={(item) => `Open contract ${item.contract_number}`}
      sort={sort ? { column: sort.key, direction: sort.direction } : null}
      onSortChange={onSortChange ? (next) => onSortChange({ key: next.column, direction: next.direction }) : undefined}
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      hasError={hasError}
      onRetry={onRetry}
      errorState={{ title: "Contracts could not be loaded" }}
      hasActiveFilters={hasActiveFilters}
      onClearFilters={onClearFilters}
      emptyState={{
        icon: FileSignature,
        title: "No contracts yet",
        description: canCreate
          ? "Create the first contract to track value, parties, and lifecycle."
          : "Contracts will appear here when a teammate creates one.",
        action: canCreate ? <Button asChild><Link href="/dashboard/contracts/new">Create contract</Link></Button> : undefined,
      }}
      filteredEmptyState={{
        icon: FileSignature,
        title: "No contracts match this view",
        description: "Clear the search or filters and try again.",
      }}
    />
  );
}
