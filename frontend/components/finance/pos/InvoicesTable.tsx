"use client";

import { useMemo } from "react";
import Link from "next/link";
import { FileText, Printer } from "lucide-react";

import { StatusValue } from "@/components/ui/StatusValue";
import { Button } from "@/components/ui/button";
import { RecordTable, type RecordTableColumn } from "@/components/ui/RecordTable";
import type { PosInvoice, PosInvoiceSortState } from "@/hooks/finance/usePosInvoices";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";
import { getPosInvoiceStatus, getPosPaymentStatus } from "@/lib/statusStyles";

type Props = {
  invoices: PosInvoice[];
  visibleColumns: string[];
  isLoading: boolean;
  isRefreshing: boolean;
  hasError?: boolean;
  onRetry?: () => void;
  selectedIds: number[];
  sort: PosInvoiceSortState;
  hasActiveFilters: boolean;
  canCreateInvoice: boolean;
  onSortChange: (sort: PosInvoiceSortState) => void;
  onToggle: (id: number, checked: boolean) => void;
  onTogglePage: (checked: boolean) => void;
  onClearFilters: () => void;
};

const SORTABLE = new Set([
  "invoice_number",
  "customer_name",
  "status",
  "payment_status",
  "total_amount",
  "issue_date",
  "due_date",
  "template_id",
  "updated_at",
]);

const HEADERS: Record<string, string> = {
  invoice_number: "Invoice",
  customer_name: "Customer",
  status: "Invoice status",
  payment_status: "Payment",
  total_amount: "Total",
  amount_paid: "Paid",
  balance_due: "Balance",
  issue_date: "Issue date",
  due_date: "Due date",
  payment_method: "Method",
  template_id: "Template",
  updated_at: "Updated",
};

const COLUMN_SIZES: Record<string, "sm" | "md" | "lg"> = {
  customer_name: "lg",
  invoice_number: "sm",
  status: "sm",
  payment_status: "sm",
  template_id: "sm",
};

const MONEY_COLUMNS = new Set(["total_amount", "amount_paid", "balance_due"]);

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function renderCell(invoice: PosInvoice, column: string) {
  switch (column) {
    case "invoice_number":
      return <span className="text-xs font-semibold tabular-nums text-copy-primary">{invoice.invoice_number}</span>;
    case "customer_name":
      return <span className="text-sm font-medium text-copy-primary">{invoice.customer_name}</span>;
    case "status": {
      const style = getPosInvoiceStatus(invoice.status);
      return <StatusValue status={style} />;
    }
    case "payment_status": {
      const style = getPosPaymentStatus(invoice.payment_status);
      return <StatusValue status={style} />;
    }
    case "total_amount":
      return <span className="text-sm font-medium tabular-nums text-copy-primary">{money(invoice.total_amount, invoice.currency)}</span>;
    case "amount_paid":
      return <span className="text-sm tabular-nums text-copy-secondary">{money(invoice.amount_paid, invoice.currency)}</span>;
    case "balance_due":
      return (
        <span className={`text-sm font-semibold tabular-nums ${invoice.balance_due > 0 ? "text-state-warning" : "text-state-success"}`}>
          {money(invoice.balance_due, invoice.currency)}
        </span>
      );
    case "issue_date":
      return <span className="text-sm text-copy-secondary">{invoice.issue_date ? formatDateOnly(invoice.issue_date) : "—"}</span>;
    case "due_date":
      return <span className="text-sm text-copy-secondary">{invoice.due_date ? formatDateOnly(invoice.due_date) : "—"}</span>;
    case "payment_method":
      return <span className="text-sm text-copy-secondary">{invoice.payment_method || "—"}</span>;
    case "template_id":
      return <span className="text-sm capitalize text-copy-secondary">{invoice.template_id}</span>;
    case "updated_at":
      return <span className="text-sm text-copy-muted">{invoice.updated_at ? formatDateTime(invoice.updated_at) : "—"}</span>;
    default:
      return <span className="text-sm text-copy-disabled">—</span>;
  }
}

export default function InvoicesTable({
  invoices,
  visibleColumns,
  isLoading,
  isRefreshing,
  hasError = false,
  onRetry,
  selectedIds,
  sort,
  hasActiveFilters,
  canCreateInvoice,
  onSortChange,
  onToggle,
  onTogglePage,
  onClearFilters,
}: Props) {
  const columns = useMemo<RecordTableColumn<PosInvoice>[]>(
    () =>
      visibleColumns.map((column) => ({
        key: column,
        label: HEADERS[column] ?? column,
        sortable: SORTABLE.has(column),
        size: COLUMN_SIZES[column],
        align: MONEY_COLUMNS.has(column) ? "right" : "left",
        render: (invoice) => renderCell(invoice, column),
      })),
    [visibleColumns],
  );

  return (
    <RecordTable
      label="Invoices"
      columns={columns}
      rows={invoices}
      rowKey={(invoice) => invoice.id}
      rowHref={(invoice) => `/dashboard/finance/pos/${invoice.id}`}
      rowLabel={(invoice) => `Open invoice ${invoice.invoice_number}`}
      selection={{
        selectedIds,
        onToggleRow: (id, checked) => onToggle(Number(id), checked),
        onToggleAll: onTogglePage,
        rowLabel: (invoice) => `Select ${invoice.invoice_number}`,
      }}
      rowActions={(invoice) => (
        <Button asChild variant="ghost" size="icon-sm">
          <Link href={`/dashboard/finance/pos/${invoice.id}/print`} aria-label={`Print invoice ${invoice.invoice_number}`}>
            <Printer />
          </Link>
        </Button>
      )}
      rowActionsLabel="Action"
      sort={sort ? { column: sort.key, direction: sort.direction } : null}
      onSortChange={(next) => onSortChange({ key: next.column, direction: next.direction })}
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      hasError={hasError}
      onRetry={onRetry}
      hasActiveFilters={hasActiveFilters}
      onClearFilters={onClearFilters}
      emptyState={{
        icon: FileText,
        title: "No invoices yet",
        description: canCreateInvoice
          ? "Create an itemized invoice to start tracking receivables."
          : "Invoices will appear here when a teammate creates one.",
        action: canCreateInvoice
          ? <Button asChild><Link href="/dashboard/finance/pos/new">Create invoice</Link></Button>
          : undefined,
      }}
      filteredEmptyState={{ icon: FileText }}
    />
  );
}
