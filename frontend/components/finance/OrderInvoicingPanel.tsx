"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FilePlus2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Money } from "@/components/ui/Money";
import { PanelError, PanelLoading } from "@/components/ui/PanelStates";
import { RecordTable } from "@/components/ui/RecordTable";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusValue } from "@/components/ui/StatusValue";
import { useOrderInvoicing, type OrderInvoicingLine } from "@/hooks/finance/useFinanceDocuments";
import { useInvoiceActions } from "@/hooks/finance/usePosInvoices";
import { formatDateOnly, todayIsoDate } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { OVERDUE_STATUS, getOrderInvoiceStatus, getPosInvoiceStatus, getPosPaymentStatus } from "@/lib/statusStyles";

function quantity(value: string | number | null | undefined) {
  if (value == null || value === "") return "—";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/**
 * The order's Invoicing tab (12c-erp-invoicing.md §3.5): per line, what can be invoiced, what
 * issued invoices cover and what is left, and the order's invoices. *Create invoice* drafts
 * everything left; the draft opens to remove or reduce lines before it is issued.
 */
export function OrderInvoicingPanel({ orderId, canCreateInvoice, canViewInvoices }: {
  orderId: number;
  /** `create` on invoices. */
  canCreateInvoice: boolean;
  /** `view` on invoices: the invoice list and links. */
  canViewInvoices: boolean;
}) {
  const router = useRouter();
  const query = useOrderInvoicing(orderId);
  const { draftFromSource, isSaving } = useInvoiceActions();
  const [error, setError] = useState<string | null>(null);
  const data = query.data;

  if (query.isLoading) return <Card className="p-6"><PanelLoading label="Loading invoicing…" /></Card>;
  if (query.error || !data) return <Card className="p-6"><PanelError message="Invoicing could not be loaded." onRetry={() => void query.refetch()} /></Card>;

  const toInvoice = data.lines.some((line) => Number(line.to_invoice) > Number(line.on_drafts));
  const onDraft = data.lines.some((line) => Number(line.on_drafts) > 0);

  async function createInvoice() {
    try {
      setError(null);
      const draft = await draftFromSource({ order_id: orderId });
      router.push(`${DASHBOARD_ROUTES.financePos}/${draft.id}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The invoice could not be drafted.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionHeading description={data.policy === "delivered"
            ? "Stocked products are invoiced as they are delivered; services as ordered."
            : "Everything is invoiced as ordered."}>
            <span className="inline-flex items-center gap-2">Invoicing <StatusValue status={getOrderInvoiceStatus(data.invoice_status)} /></span>
          </SectionHeading>
          {canCreateInvoice && toInvoice ? (
            <Button onClick={() => void createInvoice()} disabled={isSaving}><FilePlus2 />Create invoice</Button>
          ) : null}
        </div>
        {error ? <p role="alert" className="text-sm text-state-danger">{error}</p> : null}
        {onDraft && !toInvoice ? <p className="text-sm text-copy-secondary">What is left to invoice is already on a draft invoice; issue it from the list below.</p> : null}
        <RecordTable<OrderInvoicingLine>
          variant="readOnly"
          label="Order lines to invoice"
          rows={data.lines}
          rowKey={(row) => row.order_line_id}
          emptyState={{ title: "No lines" }}
          columns={[
            { key: "name", label: "Item", size: "lg", render: (row) => row.name },
            { key: "ordered", label: "Ordered", size: "sm", align: "right", render: (row) => <span className="tabular-nums">{quantity(row.ordered)}</span> },
            { key: "delivered", label: "Delivered", size: "sm", align: "right", render: (row) => (row.tracked ? <span className="tabular-nums">{quantity(Number(row.delivered) - Number(row.returned))}</span> : "—") },
            { key: "invoiced", label: "Invoiced", size: "sm", align: "right", render: (row) => <span className="tabular-nums">{quantity(row.invoiced)}</span> },
            { key: "on_drafts", label: "On drafts", size: "sm", align: "right", render: (row) => <span className="tabular-nums">{quantity(row.on_drafts)}</span> },
            { key: "to_invoice", label: "To invoice", size: "sm", align: "right", render: (row) => <span className="tabular-nums">{quantity(row.to_invoice)}</span> },
          ]}
        />
      </section>
      {canViewInvoices ? (
        <section className="flex flex-col gap-3">
          <SectionHeading>Invoices</SectionHeading>
          <RecordTable
            variant="readOnly"
            label="Invoices for this order"
            rows={data.invoices}
            rowKey={(row) => row.id}
            rowHref={(row) => `${DASHBOARD_ROUTES.financePos}/${row.id}`}
            emptyState={{ title: "No invoices yet" }}
            columns={[
              { key: "number", label: "Invoice", size: "sm", render: (row) => <Link className="font-semibold text-copy-primary" href={`${DASHBOARD_ROUTES.financePos}/${row.id}`}>{row.invoice_number ?? "Draft"}</Link> },
              { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getPosInvoiceStatus(row.status)} /> },
              { key: "payment", label: "Payment", size: "sm", render: (row) => (row.status !== "issued" ? "—"
                : row.due_date && Number(row.balance_due) > 0 && row.due_date < todayIsoDate() ? <StatusValue status={OVERDUE_STATUS} />
                : <StatusValue status={getPosPaymentStatus(row.payment_status)} />) },
              { key: "due", label: "Due", size: "sm", render: (row) => (row.due_date ? formatDateOnly(row.due_date) : "—") },
              { key: "total", label: "Total", size: "sm", align: "right", render: (row) => <Money amount={row.total_amount} currency={row.currency} /> },
              { key: "balance", label: "Balance due", size: "sm", align: "right", render: (row) => (row.status === "issued" ? <Money amount={row.balance_due} currency={row.currency} /> : "—") },
            ]}
          />
        </section>
      ) : null}
    </div>
  );
}
