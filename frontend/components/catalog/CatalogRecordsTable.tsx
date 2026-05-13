"use client";

import { Fragment } from "react";
import Image from "next/image";
import { Package, Wrench } from "lucide-react";

import {
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
  onRowClick: (record: CatalogRecord) => void;
};

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

export default function CatalogRecordsTable({
  kind,
  records,
  isLoading,
  isRefreshing = false,
  visibleColumns,
  columnOptions = [],
  onRowClick,
}: Props) {
  const isProduct = kind === "products";
  const effectiveVisibleColumns = visibleColumns.length ? visibleColumns : ["name"];
  const columnCount = effectiveVisibleColumns.length;
  const EmptyIcon = isProduct ? Package : Wrench;
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
      case "public_unit_price":
        return (
          <TableCell>
            <span className="text-sm font-semibold tabular-nums text-emerald-300">
              {formatAmount(record.public_unit_price, record.currency)}
            </span>
          </TableCell>
        );
      case "stock_status":
        return isProduct ? (
          <TableCell>
            <div className="flex flex-col">
              <span className="text-sm text-neutral-300">{stockLabel(record.stock_status)}</span>
              <span className="text-xs text-neutral-500">
                {record.stock_quantity == null ? "Quantity untracked" : `${record.stock_quantity} units`}
              </span>
            </div>
          </TableCell>
        ) : null;
      case "is_active":
        return (
          <TableCell>
            {record.is_active ? (
              <Pill bg="bg-emerald-900/30" text="text-emerald-300" border="border-emerald-700/40" className="w-20">
                Active
              </Pill>
            ) : (
              <Pill bg="bg-neutral-800/60" text="text-neutral-400" border="border-neutral-700/50" className="w-20">
                Inactive
              </Pill>
            )}
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
                width={36}
                height={36}
                unoptimized
                className="h-9 w-9 rounded-md object-cover"
              />
            ) : (
              <span className="text-sm text-neutral-600">-</span>
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
            {effectiveVisibleColumns.map((column) => (
              <TableHead key={column}>{getReadableColumnLabel(column, columnOptions)}</TableHead>
            ))}
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
