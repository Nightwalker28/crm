"use client";

import { Fragment } from "react";
import Image from "next/image";
import { ImageIcon, Package, Wrench } from "lucide-react";

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
import { EmptyState } from "@/components/ui/EmptyState";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { ModuleTableLoading } from "@/components/ui/ModuleTableLoading";
import { Pill } from "@/components/ui/Pill";
import type { TableColumnOption } from "@/hooks/useTablePreferences";
import type { CatalogKind, CatalogRecord } from "@/hooks/catalog/useCatalogRecords";
import { getReadableColumnLabel } from "@/lib/moduleViewConfigs";
import { resolveMediaUrl } from "@/lib/media";
import { formatDateTime } from "@/lib/datetime";

type Props = {
  kind: CatalogKind;
  records: CatalogRecord[];
  isLoading: boolean;
  isRefreshing?: boolean;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  onRowClick: (record: CatalogRecord) => void;
  onToggleActive?: (record: CatalogRecord, active: boolean) => void;
};

type SortState = { column: string; direction: "asc" | "desc" } | null;

const PRODUCT_SORTABLE_COLUMNS = new Set([
  "name",
  "slug",
  "sku",
  "currency",
  "public_unit_price",
  "stock_status",
  "stock_quantity",
  "is_public",
  "is_active",
  "created_at",
  "updated_at",
]);

const SERVICE_SORTABLE_COLUMNS = new Set([
  "name",
  "slug",
  "currency",
  "public_unit_price",
  "is_public",
  "is_active",
  "created_at",
  "updated_at",
]);

function formatAmount(value: number | string | null | undefined, currency: string): string {
  if (value == null || value === "") return "";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(numeric);
}

function stockLabel(value?: string | null) {
  if (!value) return "Untracked";
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function stockStyle(value?: string | null) {
  switch (value) {
    case "in_stock":
      return "bg-emerald-400";
    case "preorder":
      return "bg-amber-400";
    case "out_of_stock":
      return "bg-red-400";
    default:
      return "bg-neutral-500";
  }
}

export default function CatalogRecordsTable({
  kind,
  records,
  isLoading,
  isRefreshing = false,
  visibleColumns,
  columnOptions = [],
  sort = null,
  onSortChange,
  onRowClick,
  onToggleActive,
}: Props) {
  const isProduct = kind === "products";
  const effectiveVisibleColumns = visibleColumns.length ? visibleColumns : ["name"];
  const columnCount = effectiveVisibleColumns.length;
  const EmptyIcon = isProduct ? Package : Wrench;
  const sortableColumns = isProduct ? PRODUCT_SORTABLE_COLUMNS : SERVICE_SORTABLE_COLUMNS;

  function toggleSort(column: string) {
    const nextSort: SortState = sort?.column === column
      ? { column, direction: sort.direction === "asc" ? "desc" : "asc" }
      : { column, direction: "asc" };
    onSortChange?.(nextSort);
  }

  const renderCell = (record: CatalogRecord, column: string) => {
    switch (column) {
      case "name":
        return (
          <TableCell>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-neutral-100">{record.name}</span>
              {record.description ? (
                <span className="max-w-[320px] truncate text-xs text-neutral-500">{record.description}</span>
              ) : null}
            </div>
          </TableCell>
        );
      case "sku":
        return isProduct ? (
          <TableCell>
            <span className="rounded border border-neutral-700/50 bg-neutral-800/60 px-2 py-0.5 font-mono text-xs tracking-wider text-neutral-300">
              {record.sku || <span className="text-neutral-600">-</span>}
            </span>
          </TableCell>
        ) : null;
      case "slug":
        return (
          <TableCell>
            <span className="font-mono text-xs text-neutral-400">{record.slug || "-"}</span>
          </TableCell>
        );
      case "description":
        return (
          <TableCell>
            <span className="block max-w-[360px] truncate text-sm text-neutral-400" title={record.description ?? undefined}>
              {record.description || "-"}
            </span>
          </TableCell>
        );
      case "public_unit_price":
        return (
          <TableCell>
            <span className="text-sm font-semibold tabular-nums text-emerald-300">
              {formatAmount(record.public_unit_price, record.currency)}
            </span>
          </TableCell>
        );
      case "currency":
        return (
          <TableCell>
            <span className="font-mono text-xs text-neutral-400">{record.currency || "-"}</span>
          </TableCell>
        );
      case "stock_status":
        return isProduct ? (
          <TableCell>
            <div className="flex flex-col gap-1">
              <span className="inline-flex items-center gap-2 text-sm text-neutral-300">
                <span className={`h-2 w-2 rounded-full ${stockStyle(record.stock_status)}`} />
                {stockLabel(record.stock_status)}
              </span>
              <span className="text-xs text-neutral-500">
                {record.stock_quantity == null ? "Quantity untracked" : `${record.stock_quantity} units`}
              </span>
            </div>
          </TableCell>
        ) : null;
      case "stock_quantity":
        return isProduct ? (
          <TableCell>
            <span className="text-sm tabular-nums text-neutral-300">
              {record.stock_quantity == null ? "Untracked" : record.stock_quantity}
            </span>
          </TableCell>
        ) : null;
      case "is_active":
        return (
          <TableCell onClick={(event) => event.stopPropagation()}>
            <label className="inline-flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={record.is_active}
                onChange={(event) => onToggleActive?.(record, event.target.checked)}
                className="h-4 w-4 rounded border-neutral-700 bg-neutral-950"
              />
              {record.is_active ? "Active" : "Inactive"}
            </label>
          </TableCell>
        );
      case "is_public":
        return (
          <TableCell>
            {record.is_public ? (
              <Pill bg="bg-emerald-900/30" text="text-emerald-300" border="border-emerald-700/40" className="w-20">
                Public
              </Pill>
            ) : (
              <Pill bg="bg-neutral-800/60" text="text-neutral-400" border="border-neutral-700/50" className="w-20">
                Private
              </Pill>
            )}
          </TableCell>
        );
      case "media_url":
        return (
          <TableCell>
            {record.media_url ? (
              <Image
                src={resolveMediaUrl(record.media_url)}
                alt=""
                width={32}
                height={32}
                unoptimized
                className="h-8 w-8 rounded-md border border-neutral-800 object-cover"
              />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-md border border-neutral-800 bg-neutral-900 text-neutral-600">
                <ImageIcon className="h-4 w-4" />
              </span>
            )}
          </TableCell>
        );
      case "updated_at":
        return (
          <TableCell>
            <span className="text-sm tabular-nums text-neutral-500">
              {record.updated_at ? formatDateTime(record.updated_at, { hour: "numeric", minute: "2-digit" }) : "-"}
            </span>
          </TableCell>
        );
      case "created_at":
        return (
          <TableCell>
            <span className="text-sm tabular-nums text-neutral-500">
              {record.created_at ? formatDateTime(record.created_at, { hour: "numeric", minute: "2-digit" }) : "-"}
            </span>
          </TableCell>
        );
      default:
        return (
          <TableCell>
            <span className="text-sm text-neutral-600">-</span>
          </TableCell>
        );
    }
  };

  return (
    <ModuleTableShell isRefreshing={isRefreshing}>
      <Table className={isProduct ? "min-w-[1040px]" : "min-w-[840px]"}>
        <TableHeader>
          <TableHeaderRow>
            {effectiveVisibleColumns.map((column) => {
              const label = getReadableColumnLabel(column, columnOptions);
              return sortableColumns.has(column) && onSortChange ? (
                <SortableHead key={column} sorted={sort?.column === column} direction={sort?.column === column ? sort.direction : "asc"} onClick={() => toggleSort(column)}>
                  {label}
                </SortableHead>
              ) : <TableHead key={column}>{label}</TableHead>;
            })}
          </TableHeaderRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <ModuleTableLoading columnCount={columnCount} />
          ) : records.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columnCount} className="py-16 text-center">
                <EmptyState icon={EmptyIcon} title="No records found" description={`No catalog ${kind} match the current view.`} />
              </TableCell>
            </TableRow>
          ) : (
            records.map((record) => (
              <TableRow
                key={record.id}
                className="cursor-pointer"
                onClick={() => onRowClick(record)}
              >
                {effectiveVisibleColumns.map((column) => (
                  <Fragment key={column}>{renderCell(record, column)}</Fragment>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </ModuleTableShell>
  );
}
