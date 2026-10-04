"use client";

import { formatSnakeCaseLabel } from "@/lib/module-display";
import { useMemo } from "react";
import { MediaImage } from "@/components/ui/MediaImage";
import Link from "next/link";
import { ImageIcon, MoreHorizontal, Package, Power, PowerOff, Wrench } from "lucide-react";

import { StatusValue } from "@/components/ui/StatusValue";
import { Button } from "@/components/ui/button";
import { RecordTable, type RecordTableColumn, type RecordTableSort } from "@/components/ui/RecordTable";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { TableColumnOption } from "@/types/table";
import type { CatalogKind, CatalogRecord } from "@/hooks/catalog/useCatalogRecords";
import { getReadableColumnLabel } from "@/lib/moduleViewConfigs";
import { resolveMediaUrl } from "@/lib/media";
import { formatDateTime } from "@/lib/datetime";
import { formatMoney } from "@/lib/currency";
import { formatQuantity, formatQuantityWithUnit } from "@/lib/quantity";

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
  "category_name",
  "cost_price",
  "unit",
  "barcode",
  "is_public",
  "is_active",
  "created_at",
  "updated_at",
]);

const SERVICE_SORTABLE_COLUMNS = new Set([
  "name",
  "slug",
  "sku",
  "category_name",
  "cost_price",
  "unit",
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
  cost_price: "sm",
  unit: "sm",
  barcode: "sm",
};

const PRODUCT_ONLY_COLUMNS = new Set(["barcode", "stock_status", "stock_quantity"]);

// Empty string rather than a placeholder: both call sites already branch on it to decide
// what to render instead. Formatting is lib/currency.ts's (design.md 7.1).
function formatAmount(value: number | string | null | undefined, currency: string): string {
  return formatMoney(value, currency, { minimumFractionDigits: 0, maximumFractionDigits: 2 }) ?? "";
}

function stockLabel(value?: string | null) {
  if (!value) return "Untracked";
  return formatSnakeCaseLabel(value);
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
          return (
            <span className="rounded-[var(--radius-control-sm)] border border-line-default bg-surface-muted px-2 py-0.5 text-xs text-copy-secondary">
              {record.sku || <span className="text-copy-disabled">—</span>}
            </span>
          );
        case "barcode":
          return isProduct ? <span className="text-xs tabular-nums text-copy-secondary">{record.barcode || "—"}</span> : null;
        case "category_name":
          return <span className="text-sm text-copy-secondary">{record.category_name || "—"}</span>;
        case "unit":
          return <span className="text-sm text-copy-secondary">{record.unit || "unit"}</span>;
        case "cost_price":
          return (
            <span className="text-sm tabular-nums text-copy-secondary">
              {formatAmount(record.cost_price, record.currency) || "—"}
            </span>
          );
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
                {record.stock_quantity == null ? "Quantity untracked" : formatQuantityWithUnit(record.stock_quantity, record.unit)}
              </span>
            </div>
          ) : null;
        case "stock_quantity":
          return isProduct ? (
            <span className="text-sm tabular-nums text-copy-secondary">
              {record.stock_quantity == null ? "Untracked" : formatQuantity(record.stock_quantity)}
            </span>
          ) : null;
        case "is_active":
          // H21: the state only. Changing it is a menu action with a confirmation: a live
          // switch in a row deactivated a product on one stray click.
          return <StatusValue status={{ tone: record.is_active ? "success" : "neutral", label: record.is_active ? "Active" : "Inactive" }} />;
        case "is_public":
          return record.is_public ? (
            <StatusValue status={{ tone: "success", label: "Public" }} className="w-20" />
          ) : (
            <StatusValue status={{ tone: "neutral", label: "Private" }} className="w-20" />
          );
        case "media_url":
          return (
            <MediaImage
              src={resolveMediaUrl(record.media_url)}
              width={32}
              height={32}
              unoptimized
              className="h-8 w-8 rounded-[var(--radius-control-sm)] border border-line-default object-cover"
              alt={`${record.name} catalog image`}
              fallback={(
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-control-sm)] border border-line-default bg-surface-muted text-copy-disabled"
                  title="No catalog image"
                >
                  <ImageIcon className="h-4 w-4" aria-hidden="true" />
                </span>
              )}
            />
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
        render: (record: CatalogRecord) => renderCell(record, column),
      }));
  }, [visibleColumns, columnOptions, isProduct]);

  return (
    <RecordTable
      label={isProduct ? "Products" : "Services"}
      columns={columns}
      rows={records}
      rowKey={(record) => record.id}
      rowHref={(record) => `/dashboard/catalog/${kind}/${record.id}`}
      rowLabel={(record) => `Open ${singular} ${record.name}`}
      rowActions={onToggleActive ? (record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`More actions for ${record.name}`} disabled={togglingRecordId === record.id}><MoreHorizontal /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => onToggleActive(record, !record.is_active)}>
              {record.is_active ? <PowerOff /> : <Power />}{record.is_active ? "Deactivate" : "Activate"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : undefined}
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
