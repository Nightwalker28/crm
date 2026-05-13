"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, Plus } from "lucide-react";
import { toast } from "sonner";

import { PosInvoiceDialog } from "@/components/finance/pos/PosInvoiceDialog";
import { ModuleTableLoading } from "@/components/ui/ModuleTableLoading";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { PageHeader } from "@/components/ui/PageHeader";
import Pagination from "@/components/ui/Pagination";
import { Pill } from "@/components/ui/Pill";
import SearchBar from "@/components/ui/SearchBar";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";
import { fetchPosInvoice, usePosInvoices, type PosInvoice, type PosInvoicePayload } from "@/hooks/finance/usePosInvoices";

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  draft: { bg: "bg-neutral-800/70", text: "text-neutral-300", border: "border-neutral-700" },
  issued: { bg: "bg-sky-950/50", text: "text-sky-300", border: "border-sky-800/70" },
  paid: { bg: "bg-emerald-950/50", text: "text-emerald-300", border: "border-emerald-800/70" },
  void: { bg: "bg-red-950/50", text: "text-red-300", border: "border-red-800/70" },
};

export default function PosInvoicesPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<PosInvoice | null>(null);
  const {
    invoices,
    rangeStart,
    rangeEnd,
    totalCount,
    totalPages,
    isLoading,
    isFetching,
    error,
    refresh,
    createInvoice,
    updateInvoice,
    isSaving,
  } = usePosInvoices(page, pageSize, search, status);

  const metrics = useMemo(() => {
    return invoices.reduce(
      (acc, invoice) => {
        acc.total += 1;
        if (invoice.payment_status === "paid") acc.paid += 1;
        if (invoice.balance_due > 0) acc.outstanding += 1;
        return acc;
      },
      { total: 0, paid: 0, outstanding: 0 },
    );
  }, [invoices]);

  async function handleSubmit(payload: PosInvoicePayload) {
    if (selectedInvoice) {
      await updateInvoice(selectedInvoice.id, payload);
      toast.success("POS invoice updated.");
      return;
    }
    await createInvoice(payload);
    toast.success("POS invoice created.");
  }

  async function openInvoice(invoiceId: number) {
    try {
      const detail = await fetchPosInvoice(invoiceId);
      setSelectedInvoice(detail);
      setDialogOpen(true);
    } catch (loadError) {
      toast.error(loadError instanceof Error ? loadError.message : "Failed to load POS invoice.");
    }
  }

  async function markPaid(invoiceId: number) {
    try {
      const detail = await fetchPosInvoice(invoiceId);
      await updateInvoice(detail.id, {
        customer_name: detail.customer_name,
        customer_email: detail.customer_email ?? undefined,
        customer_address: detail.customer_address ?? undefined,
        invoice_number: detail.invoice_number,
        issue_date: detail.issue_date ?? undefined,
        due_date: detail.due_date ?? undefined,
        status: detail.status === "void" ? "void" : "paid",
        payment_status: "paid",
        payment_method: detail.payment_method ?? undefined,
        template_id: detail.template_id,
        accent_color: detail.accent_color,
        currency: detail.currency,
        discount_amount: detail.discount_amount,
        tax_rate: detail.tax_rate,
        amount_paid: detail.total_amount,
        payment_terms: detail.payment_terms ?? undefined,
        notes: detail.notes ?? undefined,
        lines: detail.lines ?? [],
      });
      toast.success("POS invoice marked as paid.");
    } catch (markError) {
      toast.error(markError instanceof Error ? markError.message : "Failed to mark invoice as paid.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="POS Mode"
        description="Create walk-in sales invoices, keep them as finance records, and choose the print template per invoice."
        actions={
          <Button onClick={() => {
            setSelectedInvoice(null);
            setDialogOpen(true);
          }}>
            <Plus />
            New POS Invoice
          </Button>
        }
      />

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-md border border-neutral-800 bg-neutral-950/70 px-5 py-4">
          <div className="text-xs uppercase tracking-[0.18em] text-neutral-500">Total Invoices</div>
          <div className="mt-2 text-2xl font-semibold text-neutral-100">{metrics.total}</div>
        </div>
        <div className="rounded-md border border-neutral-800 bg-neutral-950/70 px-5 py-4">
          <div className="text-xs uppercase tracking-[0.18em] text-neutral-500">Paid Count</div>
          <div className="mt-2 text-2xl font-semibold text-emerald-300">{metrics.paid}</div>
        </div>
        <div className="rounded-md border border-neutral-800 bg-neutral-950/70 px-5 py-4">
          <div className="text-xs uppercase tracking-[0.18em] text-neutral-500">Outstanding Count</div>
          <div className="mt-2 text-2xl font-semibold text-amber-200">{metrics.outstanding}</div>
        </div>
      </section>

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <SearchBar value={search} onChange={(value) => {
          setPage(1);
          setSearch(value);
        }} placeholder="Search POS invoices by number, customer, status, payment, or notes" />
        <Select value={status} onValueChange={(value) => {
          setPage(1);
          setStatus(value);
        }}>
          <SelectTrigger className="w-full md:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="issued">Issued</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="void">Void</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <div className="flex items-center justify-between rounded-md border border-red-800/70 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          <span>{error}</span>
          <button className="underline underline-offset-2" onClick={() => refresh()}>Retry</button>
        </div>
      ) : null}

      <ModuleTableShell isRefreshing={isFetching && !isLoading}>
        <Table className="min-w-[1040px]">
          <TableHeader>
            <TableHeaderRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Balance</TableHead>
              <TableHead>Issue Date</TableHead>
              <TableHead>Template</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableHeaderRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <ModuleTableLoading columnCount={10} />
            ) : invoices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="py-16 text-center text-sm text-neutral-500">No POS invoices found</TableCell>
              </TableRow>
            ) : invoices.map((invoice) => {
              const style = STATUS_STYLES[invoice.status] ?? STATUS_STYLES.draft;
              return (
                <TableRow key={invoice.id} onClick={() => openInvoice(invoice.id)} className="cursor-pointer">
                  <TableCell><span className="font-mono text-xs font-semibold text-neutral-200">{invoice.invoice_number}</span></TableCell>
                  <TableCell><span className="font-medium text-neutral-100">{invoice.customer_name}</span></TableCell>
                  <TableCell><Pill bg={style.bg} text={style.text} border={style.border}>{invoice.status}</Pill></TableCell>
                  <TableCell><span className="text-sm text-neutral-300">{invoice.payment_status}</span></TableCell>
                  <TableCell><span className="font-semibold text-emerald-300">{money(invoice.total_amount, invoice.currency)}</span></TableCell>
                  <TableCell><span className={invoice.balance_due > 0 ? "font-semibold text-amber-200" : "text-neutral-400"}>{money(invoice.balance_due, invoice.currency)}</span></TableCell>
                  <TableCell><span className="text-sm text-neutral-400">{invoice.issue_date ? formatDateOnly(invoice.issue_date) : "—"}</span></TableCell>
                  <TableCell><span className="text-sm capitalize text-neutral-400">{invoice.template_id}</span></TableCell>
                  <TableCell><span className="text-sm text-neutral-500">{invoice.updated_at ? formatDateTime(invoice.updated_at, { hour: "numeric", minute: "2-digit" }) : "—"}</span></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>
                      {invoice.payment_status !== "paid" ? (
                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => void markPaid(invoice.id)} title="Mark as paid">
                          <CheckCircle2 />
                        </Button>
                      ) : null}
                      <Button asChild variant="ghost" size="icon-sm">
                        <Link href={`/dashboard/finance/pos/${invoice.id}/print`} title="Print invoice">
                          <ExternalLink />
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </ModuleTableShell>

      <Pagination
        page={page}
        totalPages={totalPages}
        totalCount={totalCount}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        pageSize={pageSize}
        isRefreshing={isFetching && !isLoading}
        onPageChange={setPage}
        onPageSizeChange={(next) => {
          setPage(1);
          setPageSize(next);
        }}
      />

      <PosInvoiceDialog
        open={dialogOpen}
        invoice={selectedInvoice}
        isSubmitting={isSaving}
        onClose={() => {
          setDialogOpen(false);
          setSelectedInvoice(null);
        }}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
