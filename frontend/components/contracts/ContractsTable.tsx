"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileSignature } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SortableHead, Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { ModuleTableLoading } from "@/components/ui/ModuleTableLoading";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { Pill } from "@/components/ui/Pill";
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
  canCreate?: boolean;
  onClearFilters?: () => void;
};

function formatMoney(value: Contract["value_amount"], currency: string | null) {
  if (value === null || value === undefined || value === "") return "—";
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
  if (value == null || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return "—";
}

export default function ContractsTable({ contracts, isLoading, isRefreshing = false, visibleColumns, columnOptions = [], sort = null, onSortChange, hasActiveFilters = false, hasError = false, canCreate = false, onClearFilters }: ContractsTableProps) {
  const router = useRouter();

  function renderCell(item: Contract, column: string): ReactNode {
    const href = `/dashboard/contracts/${item.id}`;
    switch (column) {
      case "contract_number":
        return <Link href={href} onClick={(event) => event.stopPropagation()} className="rounded-[var(--radius-control-sm)] text-sm font-medium tabular-nums text-copy-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">{item.contract_number}</Link>;
      case "title":
        return <Link href={href} onClick={(event) => event.stopPropagation()} className="block max-w-[300px] truncate rounded-[var(--radius-control-sm)] text-sm font-medium text-copy-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">{item.title}</Link>;
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
          ) : hasError ? (
            <TableRow>
              <TableCell colSpan={visibleColumns.length} className="py-12">
                <EmptyState icon={FileSignature} title="Contracts unavailable" description="Use Try again above to reload contracts." />
              </TableCell>
            </TableRow>
          ) : contracts.length === 0 ? (
            <TableRow>
              <TableCell colSpan={visibleColumns.length} className="py-12">
                <EmptyState
                  icon={FileSignature}
                  title={hasActiveFilters ? "No contracts match this view" : "No contracts yet"}
                  description={hasActiveFilters
                    ? "Clear the search or filters and try again."
                    : canCreate
                      ? "Create the first contract to track value, parties, and lifecycle."
                      : "Contracts will appear here when a teammate creates one."}
                  action={hasActiveFilters && onClearFilters
                    ? <Button type="button" variant="outline" onClick={onClearFilters}>Clear filters</Button>
                    : canCreate
                      ? <Button asChild><Link href="/dashboard/contracts/new">Create contract</Link></Button>
                      : undefined}
                />
              </TableCell>
            </TableRow>
          ) : (
            contracts.map((item) => (
              <TableRow key={item.id} className="group cursor-pointer" onClick={() => router.push(`/dashboard/contracts/${item.id}`)}>
                {visibleColumns.map((column) => <TableCell key={column}>{renderCell(item, column)}</TableCell>)}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </ModuleTableShell>
  );
}
