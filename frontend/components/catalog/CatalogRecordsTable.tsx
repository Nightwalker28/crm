"use client";

import { useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { ImageIcon, Package, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/Pill";
import { RecordTable, type RecordTableColumn, type RecordTableSort } from "@/components/ui/RecordTable";
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
  hasError?: boolean;
  onRetry?: () => void;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
  sort?: RecordTableSort | null;
  onSortChange?: (sort: RecordTableSort) => void;
  onToggleActive?: (record: CatalogRecord, active: boolean) => void;
  togglingRecordId?: number | null;
  hasActiveFilters?: boolean;
  canCreate?: boolean;
  onClearFilters?: () => void;
};

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

const COLUMN_SIZES: Record<string, "sm" | "md" | "lg"> = {
  name: "lg",
  description: "lg",
  currency: "sm",
  sku: "sm",
  slug: "sm",
  is_public: "sm",
  media_url: "sm",
  stock_quantity: "sm",
};

const PRODUCT_ONLY_COLUMNS = new Set(["sku", "stock_status", "stock_quantity"]);

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
  hasError = false,
  onRetry,
  visibleColumns,
  columnOptions = [],
  sort = null,
  onSortChange,
  onToggleActive,
  togglingRecordId = null,
  hasActiveFilters = false,
  canCreate = false,
  onClearFilters,
}: Props) {
  const isProduct = kind === "products";
  const singular = isProduct ? "product" : "service";
  const EmptyIcon = isProduct ? Package : Wrench;

  const columns = useMemo<RecordTableColumn<CatalogRecord>[]>(() => {
    const sortableColumns = isProduct ? PRODUCT_SORTABLE_COLUMNS : SERVICE_SORTABLE_COLUMNS;
    const keys = visibleColumns.length ? visibleColumns : ["name"];

    function renderCell(record: CatalogRecord, column: string) {
      switch (column) {
        case "name":
          return (
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold text-copy-primary">{record.name}</span>
              {record.description ? (
                <span className="max-w-[320px] truncate text-xs text-copy-muted">{record.description}</span>
              ) : null}
            </div>
          );
        case "sku":
          return isProduct ? (
            <span className="rounded-[var(--radius-control-sm)] border border-line-default bg-surface-muted px-2 py-0.5 text-xs text-copy-secondary">
              {record.sku || <span className="text-copy-disabled">—</span>}
            </span>
          ) : null;
        case "slug":
          return <span className="text-xs text-copy-secondary">{record.slug || "—"}</span>;
        case "description":
          return (
            <span className="block max-w-[360px] truncate text-sm text-copy-secondary" title={record.description ?? undefined}>
              {record.description || "—"}
            </span>
          );
        case "public_unit_price":
          return (
            <span className="text-sm font-semibold tabular-nums text-copy-primary">
              {formatAmount(record.public_unit_price, record.currency) || "—"}
            </span>
          );
        case "currency":
          return <span className="text-xs text-copy-secondary">{record.currency || "—"}</span>;
        case "stock_status":
          return isProduct ? (
            <div className="flex flex-col gap-1">
              <span className="inline-flex items-center gap-2 text-sm text-copy-secondary">
                <span className={`h-2 w-2 rounded-full ${stockStyle(record.stock_status)}`} aria-hidden="true" />
                {stockLabel(record.stock_status)}
              </span>
              <span className="text-xs text-copy-muted">
                {record.stock_quantity == null ? "Quantity untracked" : `${record.stock_quantity} units`}
              </span>
            </div>
          ) : null;
        case "stock_quantity":
          return isProduct ? (
            <span className="text-sm tabular-nums text-copy-secondary">
              {record.stock_quantity == null ? "Untracked" : record.stock_quantity}
            </span>
          ) : null;
        case "is_active":
          return onToggleActive ? (
            <div className="inline-flex items-center gap-2">
              <Switch
                aria-label={`${record.is_active ? "Deactivate" : "Activate"} ${record.name}`}
                checked={record.is_active}
                disabled={togglingRecordId === record.id}
                onCheckedChange={(checked) => onToggleActive(record, checked)}
                className="relative h-6 w-11 shrink-0 rounded-full border border-line-control bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-60 data-[state=checked]:bg-action-primary"
              >
                <SwitchThumb className="block h-5 w-5 rounded-full bg-copy-primary data-[state=checked]:translate-x-5" />
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
          );
        case "is_public":
          return record.is_public ? (
            <Pill bg="bg-state-success-muted" text="text-state-success" border="border-state-success/40" className="w-20">
              Public
            </Pill>
          ) : (
            <Pill bg="bg-surface-muted" text="text-copy-muted" border="border-line-default" className="w-20">
              Private
            </Pill>
          );
        case "media_url":
          return record.media_url ? (
            <Image
              src={resolveMediaUrl(record.media_url)}
              width={32}
              height={32}
              unoptimized
              className="h-8 w-8 rounded-[var(--radius-control-sm)] border border-line-default object-cover"
              alt={`${record.name} catalog image`}
            />
          ) : (
            <span
              className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-control-sm)] border border-line-default bg-surface-muted text-copy-disabled"
              title="No catalog image"
            >
              <ImageIcon className="h-4 w-4" aria-hidden="true" />
            </span>
          );
        case "updated_at":
        case "created_at":
          return (
            <span className="text-sm tabular-nums text-copy-muted">
              {record[column] ? formatDateTime(String(record[column]), { hour: "numeric", minute: "2-digit" }) : "—"}
            </span>
          );
        default:
          return <span className="text-sm text-copy-disabled">—</span>;
      }
    }

    return keys
      .filter((column) => isProduct || !PRODUCT_ONLY_COLUMNS.has(column))
      .map((column) => ({
        key: column,
        label: getReadableColumnLabel(column, columnOptions),
        sortable: sortableColumns.has(column),
        size: COLUMN_SIZES[column],
        interactive: column === "is_active" && Boolean(onToggleActive),
        render: (record: CatalogRecord) => renderCell(record, column),
      }));
  }, [visibleColumns, columnOptions, isProduct, onToggleActive, togglingRecordId]);

  return (
    <RecordTable
      label={isProduct ? "Products" : "Services"}
      columns={columns}
      rows={records}
      rowKey={(record) => record.id}
      rowHref={(record) => `/dashboard/catalog/${kind}/${record.id}`}
      rowLabel={(record) => `Open ${singular} ${record.name}`}
      sort={sort}
      onSortChange={onSortChange}
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      hasError={hasError}
      onRetry={onRetry}
      hasActiveFilters={hasActiveFilters}
      onClearFilters={onClearFilters}
      emptyState={{
        icon: EmptyIcon,
        title: `No ${kind} yet`,
        description: canCreate
          ? `Create the first ${singular} for this catalog.`
          : `${isProduct ? "Products" : "Services"} will appear here when a teammate creates one.`,
        action: canCreate
          ? <Button asChild><Link href={`/dashboard/catalog/${kind}/new`}>Create {singular}</Link></Button>
          : undefined,
      }}
      filteredEmptyState={{
        icon: EmptyIcon,
        title: `No ${kind} match this search`,
        description: "Clear the search or try another term.",
        action: onClearFilters ? <Button type="button" variant="outline" onClick={onClearFilters}>Clear search</Button> : undefined,
      }}
    />
  );
}
