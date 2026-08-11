"use client";

import { Fragment } from "react";
import Image from "next/image";
import Link from "next/link";
import { ImageIcon, Package, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { Switch, SwitchThumb } from "@/components/ui/switch";
import type { TableColumnOption } from "@/types/table";
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
  togglingRecordId?: number | null;
  hasActiveFilters?: boolean;
  canCreate?: boolean;
  onClearFilters?: () => void;
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
      return "bg-state-success";
    case "preorder":
      return "bg-state-warning";
    case "out_of_stock":
      return "bg-state-danger";
    default:
      return "bg-copy-disabled";
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
  togglingRecordId = null,
  hasActiveFilters = false,
  canCreate = false,
  onClearFilters,
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
              <Link
                href={`/dashboard/catalog/${kind}/${record.id}`}
                onClick={(event) => event.stopPropagation()}
                className="truncate text-sm font-semibold text-copy-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                {record.name}
              </Link>
              {record.description ? (
                <span className="max-w-[320px] truncate text-xs text-copy-muted">{record.description}</span>
              ) : null}
            </div>
          </TableCell>
        );
      case "sku":
        return isProduct ? (
          <TableCell>
            <span className="rounded-[var(--radius-control-sm)] border border-line-default bg-surface-muted px-2 py-0.5 text-xs text-copy-secondary">
              {record.sku || <span className="text-copy-disabled">—</span>}
            </span>
          </TableCell>
        ) : null;
      case "slug":
        return (
          <TableCell>
            <span className="text-xs text-copy-secondary">{record.slug || "—"}</span>
          </TableCell>
        );
      case "description":
        return (
          <TableCell>
            <span className="block max-w-[360px] truncate text-sm text-copy-secondary" title={record.description ?? undefined}>
              {record.description || "—"}
            </span>
          </TableCell>
        );
      case "public_unit_price":
        return (
          <TableCell>
            <span className="text-sm font-semibold tabular-nums text-copy-primary">
              {formatAmount(record.public_unit_price, record.currency) || "—"}
            </span>
          </TableCell>
        );
      case "currency":
        return (
          <TableCell>
            <span className="text-xs text-copy-secondary">{record.currency || "—"}</span>
          </TableCell>
        );
      case "stock_status":
        return isProduct ? (
          <TableCell>
            <div className="flex flex-col gap-1">
              <span className="inline-flex items-center gap-2 text-sm text-copy-secondary">
                <span className={`h-2 w-2 rounded-full ${stockStyle(record.stock_status)}`} aria-hidden="true" />
                {stockLabel(record.stock_status)}
              </span>
              <span className="text-xs text-copy-muted">
                {record.stock_quantity == null ? "Quantity untracked" : `${record.stock_quantity} units`}
              </span>
            </div>
          </TableCell>
        ) : null;
      case "stock_quantity":
        return isProduct ? (
          <TableCell>
            <span className="text-sm tabular-nums text-copy-secondary">
              {record.stock_quantity == null ? "Untracked" : record.stock_quantity}
            </span>
          </TableCell>
        ) : null;
      case "is_active":
        return (
          <TableCell onClick={(event) => event.stopPropagation()}>
            {onToggleActive ? (
              <div className="inline-flex items-center gap-2">
                <Switch
                  aria-label={`${record.is_active ? "Deactivate" : "Activate"} ${record.name}`}
                  checked={record.is_active}
                  disabled={togglingRecordId === record.id}
                  onCheckedChange={(checked) => onToggleActive(record, checked)}
                  className="relative h-6 w-11 shrink-0 rounded-full border border-line-strong bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-60 data-[state=checked]:bg-action-primary"
                >
                  <SwitchThumb className="block h-5 w-5 rounded-full bg-copy-primary shadow-sm data-[state=checked]:translate-x-5" />
                </Switch>
                <span className="text-sm text-copy-secondary">{record.is_active ? "Active" : "Inactive"}</span>
              </div>
            ) : (
              <Pill
                bg={record.is_active ? "bg-state-success-muted" : "bg-surface-muted"}
                text={record.is_active ? "text-state-success" : "text-copy-muted"}
                border={record.is_active ? "border-state-success/40" : "border-line-default"}
              >
                {record.is_active ? "Active" : "Inactive"}
              </Pill>
            )}
          </TableCell>
        );
      case "is_public":
        return (
          <TableCell>
            {record.is_public ? (
              <Pill bg="bg-state-success-muted" text="text-state-success" border="border-state-success/40" className="w-20">
                Public
              </Pill>
            ) : (
              <Pill bg="bg-surface-muted" text="text-copy-muted" border="border-line-default" className="w-20">
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
                width={32}
                height={32}
                unoptimized
                className="h-8 w-8 rounded-[var(--radius-control-sm)] border border-line-default object-cover"
                alt={`${record.name} catalog image`}
              />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-control-sm)] border border-line-default bg-surface-muted text-copy-disabled" title="No catalog image">
                <ImageIcon className="h-4 w-4" aria-hidden="true" />
              </span>
            )}
          </TableCell>
        );
      case "updated_at":
        return (
          <TableCell>
            <span className="text-sm tabular-nums text-copy-muted">
              {record.updated_at ? formatDateTime(record.updated_at, { hour: "numeric", minute: "2-digit" }) : "—"}
            </span>
          </TableCell>
        );
      case "created_at":
        return (
          <TableCell>
            <span className="text-sm tabular-nums text-copy-muted">
              {record.created_at ? formatDateTime(record.created_at, { hour: "numeric", minute: "2-digit" }) : "—"}
            </span>
          </TableCell>
        );
      default:
        return (
          <TableCell>
            <span className="text-sm text-copy-disabled">—</span>
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
                <EmptyState
                  icon={EmptyIcon}
                  title={hasActiveFilters ? `No ${kind} match this search` : `No ${kind} yet`}
                  description={hasActiveFilters
                    ? "Clear the search or try another term."
                    : canCreate
                      ? `Create the first ${isProduct ? "product" : "service"} for this catalog.`
                      : `${isProduct ? "Products" : "Services"} will appear here when a teammate creates one.`}
                  action={hasActiveFilters && onClearFilters
                    ? <Button type="button" variant="outline" onClick={onClearFilters}>Clear search</Button>
                    : canCreate
                      ? <Button asChild><Link href={`/dashboard/catalog/${kind}/new`}>Create {isProduct ? "product" : "service"}</Link></Button>
                      : undefined}
                />
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
