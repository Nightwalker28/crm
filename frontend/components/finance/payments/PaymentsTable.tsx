"use client";

import Link from "next/link";
import { Fragment } from "react";
import { CreditCard } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { ModuleTableLoading } from "@/components/ui/ModuleTableLoading";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { Pill } from "@/components/ui/Pill";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SortableHead, Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import type { PosInvoice, PosInvoiceSortState } from "@/hooks/finance/usePosInvoices";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";

type Props = {
  invoices: PosInvoice[];
  visibleColumns: string[];
  isLoading: boolean;
  isRefreshing: boolean;
  selectedIds: number[];
  sort: PosInvoiceSortState;
  hasActiveFilters: boolean;
  onSortChange: (sort: PosInvoiceSortState) => void;
  onToggle: (id: number, checked: boolean) => void;
  onTogglePage: (checked: boolean) => void;
  onRecordPayment: (invoice: PosInvoice) => void;
  onClearFilters: () => void;
};

const SORTABLE = new Set(["invoice_number", "customer_name", "payment_status", "total_amount", "amount_paid", "due_date", "updated_at"]);
const STATUS_STYLE: Record<string, { bg: string; text: string; border: string; label: string }> = {
  unpaid: { bg: "bg-state-warning-muted", text: "text-state-warning", border: "border-state-warning/40", label: "Unpaid" },
  partial: { bg: "bg-state-info-muted", text: "text-state-info", border: "border-state-info/40", label: "Partially Paid" },
  paid: { bg: "bg-state-success-muted", text: "text-state-success", border: "border-state-success/40", label: "Paid" },
  refunded: { bg: "bg-surface-muted", text: "text-copy-secondary", border: "border-line-default", label: "Refunded" },
};

function money(amount: number, currency: string) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount); }
  catch { return `${currency} ${amount.toFixed(2)}`; }
}

function label(column: string) {
  return ({ invoice_number: "Invoice", customer_name: "Customer", payment_status: "Status", total_amount: "Invoice Total", amount_paid: "Paid", balance_due: "Balance", due_date: "Due Date", payment_method: "Method", updated_at: "Updated" } as Record<string, string>)[column] ?? column;
}

function nextSort(sort: PosInvoiceSortState, column: string): PosInvoiceSortState {
  return sort?.key === column ? { key: column, direction: sort.direction === "asc" ? "desc" : "asc" } : { key: column, direction: "asc" };
}

function cell(invoice: PosInvoice, column: string) {
  if (column === "invoice_number") return <TableCell className="sticky left-10 z-10 bg-surface"><Link href={`/dashboard/finance/pos/${invoice.id}`} className="font-mono text-xs font-semibold text-copy-primary hover:underline">{invoice.invoice_number}</Link></TableCell>;
  if (column === "customer_name") return <TableCell><span className="font-medium text-copy-primary">{invoice.customer_name}</span></TableCell>;
  if (column === "payment_status") { const style = STATUS_STYLE[invoice.payment_status] ?? STATUS_STYLE.unpaid; return <TableCell><Pill bg={style.bg} text={style.text} border={style.border}>{style.label}</Pill></TableCell>; }
  if (column === "total_amount") return <TableCell className="text-right font-medium text-copy-primary">{money(invoice.total_amount, invoice.currency)}</TableCell>;
  if (column === "amount_paid") return <TableCell className="text-right text-copy-secondary">{money(invoice.amount_paid, invoice.currency)}</TableCell>;
  if (column === "balance_due") return <TableCell className={`text-right font-semibold ${invoice.balance_due > 0 ? "text-state-warning" : "text-state-success"}`}>{money(invoice.balance_due, invoice.currency)}</TableCell>;
  if (column === "due_date") return <TableCell><span className="text-copy-secondary">{invoice.due_date ? formatDateOnly(invoice.due_date) : "No due date"}</span></TableCell>;
  if (column === "payment_method") return <TableCell><span className="text-copy-secondary">{invoice.payment_method || "—"}</span></TableCell>;
  if (column === "updated_at") return <TableCell><span className="text-copy-muted">{invoice.updated_at ? formatDateTime(invoice.updated_at) : "—"}</span></TableCell>;
  return <TableCell>—</TableCell>;
}

export default function PaymentsTable({ invoices, visibleColumns, isLoading, isRefreshing, selectedIds, sort, hasActiveFilters, onSortChange, onToggle, onTogglePage, onRecordPayment, onClearFilters }: Props) {
  const allSelected = invoices.length > 0 && invoices.every((invoice) => selectedIds.includes(invoice.id));
  return (
    <ModuleTableShell isRefreshing={isRefreshing}>
      <Table className="min-w-[1080px]">
        <TableHeader><TableHeaderRow>
          <TableHead className="sticky left-0 z-20 w-10 bg-surface"><Checkbox aria-label="Select all payments on this page" checked={allSelected} onCheckedChange={(checked) => onTogglePage(checked === true)} /></TableHead>
          {visibleColumns.map((column) => SORTABLE.has(column) ? <SortableHead key={column} sorted={sort?.key === column} direction={sort?.key === column ? sort.direction : "asc"} onClick={() => onSortChange(nextSort(sort, column))} className={column === "invoice_number" ? "sticky left-10 z-20 bg-surface" : undefined}>{label(column)}</SortableHead> : <TableHead key={column}>{label(column)}</TableHead>)}
          <TableHead className="text-right">Action</TableHead>
        </TableHeaderRow></TableHeader>
        <TableBody>
          {isLoading ? <ModuleTableLoading columnCount={visibleColumns.length + 2} /> : invoices.length === 0 ? (
            <TableRow><TableCell colSpan={visibleColumns.length + 2} className="py-12"><EmptyState icon={CreditCard} title={hasActiveFilters ? "No payments match these filters" : "No invoices available for payment tracking"} description={hasActiveFilters ? "Clear one or more filters and try again." : "Create an invoice first, then record customer payments here."} action={hasActiveFilters ? <Button type="button" variant="outline" onClick={onClearFilters}>Clear filters</Button> : <Button asChild><Link href="/dashboard/finance/pos/new">Create invoice</Link></Button>} /></TableCell></TableRow>
          ) : invoices.map((invoice) => (
            <TableRow key={invoice.id}>
              <TableCell className="sticky left-0 z-10 bg-surface"><Checkbox aria-label={`Select ${invoice.invoice_number}`} checked={selectedIds.includes(invoice.id)} onCheckedChange={(checked) => onToggle(invoice.id, checked === true)} /></TableCell>
              {visibleColumns.map((column) => <Fragment key={column}>{cell(invoice, column)}</Fragment>)}
              <TableCell className="text-right"><Button type="button" variant="outline" size="sm" disabled={invoice.balance_due <= 0 || invoice.status === "void" || invoice.payment_status === "refunded"} onClick={() => onRecordPayment(invoice)}>Record payment</Button></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ModuleTableShell>
  );
}
