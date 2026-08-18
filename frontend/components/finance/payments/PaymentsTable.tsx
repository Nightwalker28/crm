"use client";

import { useMemo } from "react";
import Link from "next/link";
import { CreditCard } from "lucide-react";

import { StatusValue } from "@/components/ui/StatusValue";
import { getPosPaymentStatus, type StatusTone } from "@/lib/statusStyles";
import { Button } from "@/components/ui/button";
import { RecordTable, type RecordTableColumn } from "@/components/ui/RecordTable";
import type { PosInvoice, PosInvoiceSortState } from "@/hooks/finance/usePosInvoices";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";
import { EMPTY_CELL_VALUE } from "@/components/ui/EmptyValue";
import { formatMoney } from "@/lib/currency";

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
  canRecordPayment: boolean;
  onSortChange: (sort: PosInvoiceSortState) => void;
  onToggle: (id: number, checked: boolean) => void;
  onTogglePage: (checked: boolean) => void;
  onRecordPayment: (invoice: PosInvoice) => void;
  onClearFilters: () => void;
};

const SORTABLE = new Set([
  "invoice_number",
  "customer_name",
  "payment_status",
  "total_amount",
  "amount_paid",
  "due_date",
  "updated_at",
]);

const HEADERS: Record<string, string> = {
  invoice_number: "Invoice",
  customer_name: "Customer",
  payment_status: "Status",
  total_amount: "Invoice Total",
  amount_paid: "Paid",
  balance_due: "Balance",
  due_date: "Due Date",
  payment_method: "Method",
  updated_at: "Updated",
};

const COLUMN_SIZES: Record<string, "sm" | "md" | "lg"> = {
  customer_name: "lg",
  invoice_number: "sm",
  payment_status: "sm",
};

const MONEY_COLUMNS = new Set(["total_amount", "amount_paid", "balance_due"]);

/**
 * The AR list is the one place a tone is **derived rather than looked up** (R5).
 *
 * `unpaid` and `partial` are the *normal* state of a recent invoice, so classifying them as
 * attention would make this list mostly amber and re-create exactly the noise R5 removes.
 * What actually deserves an operator's attention is **overdue**, which no enum value can
 * express because it depends on today's date.
 */
function overdueTone(invoice: { payment_status: string; due_date?: string | null }): StatusTone | undefined {
  if (invoice.payment_status === "paid" || invoice.payment_status === "refunded") return undefined;
  if (!invoice.due_date) return undefined;
  const due = new Date(invoice.due_date);
  if (Number.isNaN(due.getTime())) return undefined;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today ? "critical" : undefined;
}

// The unknown-code fallback lives in lib/currency.ts now (design.md 7.1); this keeps only
// the empty spelling this surface wants (3.6).
function money(amount: number, currency: string) {
  return formatMoney(amount, currency) ?? EMPTY_CELL_VALUE;
}

function renderCell(invoice: PosInvoice, column: string) {
  switch (column) {
    case "invoice_number":
      return <span className="text-xs font-semibold tabular-nums text-copy-primary">{invoice.invoice_number}</span>;
    case "customer_name":
      return <span className="text-sm font-medium text-copy-primary">{invoice.customer_name}</span>;
    case "payment_status": {
      return (
        <StatusValue
          status={getPosPaymentStatus(invoice.payment_status)}
          tone={overdueTone(invoice)}
        />
      );
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
    case "due_date":
      return <span className="text-sm text-copy-secondary">{invoice.due_date ? formatDateOnly(invoice.due_date) : "No due date"}</span>;
    case "payment_method":
      return <span className="text-sm text-copy-secondary">{invoice.payment_method || "—"}</span>;
    case "updated_at":
      return <span className="text-sm text-copy-muted">{invoice.updated_at ? formatDateTime(invoice.updated_at) : "—"}</span>;
    default:
      return <span className="text-sm text-copy-disabled">—</span>;
  }
}

export default function PaymentsTable({
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
  canRecordPayment,
  onSortChange,
  onToggle,
  onTogglePage,
  onRecordPayment,
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
      label="Payments"
      columns={columns}
      rows={invoices}
      rowKey={(invoice) => invoice.id}
      rowHref={(invoice) => `/dashboard/finance/pos/${invoice.id}`}
      rowLabel={(invoice) => `Open invoice ${invoice.invoice_number}`}
      selection={
        canRecordPayment
          ? {
              selectedIds,
              onToggleRow: (id, checked) => onToggle(Number(id), checked),
              onToggleAll: onTogglePage,
              rowLabel: (invoice) => `Select ${invoice.invoice_number}`,
            }
          : undefined
      }
      rowActions={
        canRecordPayment
          ? (invoice) => (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={invoice.balance_due <= 0 || invoice.status === "void" || invoice.payment_status === "refunded"}
                onClick={() => onRecordPayment(invoice)}
              >
                Record payment
              </Button>
            )
          : undefined
      }
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
        icon: CreditCard,
        title: "No invoices available for payment tracking",
        description: "Create an invoice first, then record customer payments here.",
        action: canCreateInvoice
          ? <Button asChild><Link href="/dashboard/finance/pos/new">Create invoice</Link></Button>
          : <Button asChild variant="outline"><Link href="/dashboard/finance/pos">Open invoices</Link></Button>,
      }}
      filteredEmptyState={{ icon: CreditCard, title: "No payments match these filters" }}
    />
  );
}
