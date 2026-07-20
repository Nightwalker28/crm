"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ExternalLink, Pencil, ReceiptText } from "lucide-react";

import CrmRecordActivitySection from "@/components/recordActivity/CrmRecordActivitySection";
import RecordDeleteButton from "@/components/recordActivity/RecordDeleteButton";
import RecordPageHeader from "@/components/recordActivity/RecordPageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { RecordTabs } from "@/components/ui/RecordTabs";
import {
  RouteErrorState,
  RouteLoadingState,
} from "@/components/ui/RouteStates";
import { usePosInvoice } from "@/hooks/finance/usePosInvoices";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";

const STATUS_STYLE: Record<
  string,
  { bg: string; text: string; border: string; label: string }
> = {
  draft: {
    bg: "bg-surface-muted",
    text: "text-copy-secondary",
    border: "border-line-default",
    label: "Draft",
  },
  issued: {
    bg: "bg-state-info-muted",
    text: "text-state-info",
    border: "border-state-info/40",
    label: "Issued",
  },
  paid: {
    bg: "bg-state-success-muted",
    text: "text-state-success",
    border: "border-state-success/40",
    label: "Paid",
  },
  void: {
    bg: "bg-state-danger-muted",
    text: "text-state-danger",
    border: "border-state-danger/40",
    label: "Void",
  },
};

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export default function InvoiceDetailPage() {
  const params = useParams<{ invoiceId: string }>();
  const invoiceId = /^\d+$/.test(params.invoiceId)
    ? Number(params.invoiceId)
    : null;
  const query = usePosInvoice(invoiceId);

  if (query.isLoading) return <RouteLoadingState />;
  if (query.error || !query.data)
    return (
      <RouteErrorState
        title="Unable to load invoice"
        backHref="/dashboard/finance/pos"
        backLabel="Back to invoices"
        reset={() => void query.refetch()}
      />
    );

  const invoice = query.data;
  const status = STATUS_STYLE[invoice.status] ?? STATUS_STYLE.draft;
  const overview = (
    <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-copy-primary">
              Invoice summary
            </h2>
            <p className="mt-1 text-sm text-copy-muted">
              Issued{" "}
              {invoice.issue_date
                ? formatDateOnly(invoice.issue_date)
                : "date not recorded"}
            </p>
          </div>
          <Pill bg={status.bg} text={status.text} border={status.border}>
            {status.label}
          </Pill>
        </div>
        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          <Summary label="Customer" value={invoice.customer_name} />
          <Summary
            label="Email"
            value={invoice.customer_email || "Not provided"}
          />
          <Summary
            label="Due date"
            value={
              invoice.due_date
                ? formatDateOnly(invoice.due_date)
                : "No due date"
            }
          />
          <Summary
            label="Payment method"
            value={invoice.payment_method || "Not recorded"}
          />
          <Summary
            label="Payment status"
            value={invoice.payment_status.replaceAll("_", " ")}
          />
          <Summary
            label="Updated"
            value={
              invoice.updated_at
                ? formatDateTime(invoice.updated_at)
                : "Not recorded"
            }
          />
        </dl>
        {invoice.customer_address ? (
          <div className="mt-4 rounded-[var(--radius-card)] border border-line-subtle bg-surface-muted p-4 text-sm text-copy-secondary">
            <div className="text-xs font-semibold uppercase tracking-wide text-copy-muted">
              Billing address
            </div>
            <div className="mt-2 whitespace-pre-line">
              {invoice.customer_address}
            </div>
          </div>
        ) : null}
      </Card>
      <Card className="p-5">
        <h2 className="text-lg font-semibold text-copy-primary">Balance</h2>
        <dl className="mt-4 space-y-3">
          <MoneyRow
            label="Subtotal"
            value={money(invoice.subtotal_amount, invoice.currency)}
          />
          <MoneyRow
            label="Discount"
            value={`− ${money(invoice.discount_amount, invoice.currency)}`}
          />
          <MoneyRow
            label="Tax"
            value={money(invoice.tax_amount, invoice.currency)}
          />
          <MoneyRow
            label="Total"
            value={money(invoice.total_amount, invoice.currency)}
            strong
          />
          <MoneyRow
            label="Paid"
            value={`− ${money(invoice.amount_paid, invoice.currency)}`}
          />
          <MoneyRow
            label="Balance due"
            value={money(invoice.balance_due, invoice.currency)}
            strong
          />
        </dl>
        <Button asChild className="mt-5 w-full" variant="outline">
          <Link href="/dashboard/finance/payments">
            <ReceiptText />
            Open payments
          </Link>
        </Button>
      </Card>
      <Card className="p-5 lg:col-span-2">
        <h2 className="text-lg font-semibold text-copy-primary">Line items</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line-default text-left text-xs uppercase tracking-wide text-copy-muted">
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Quantity</th>
                <th className="px-3 py-2 text-right">Unit price</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {(invoice.lines ?? []).map((line) => (
                <tr key={line.id} className="border-b border-line-subtle">
                  <td className="px-3 py-3 font-medium text-copy-primary">
                    {line.description}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-copy-secondary">
                    {line.quantity}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-copy-secondary">
                    {money(line.unit_price, invoice.currency)}
                  </td>
                  <td className="px-3 py-3 text-right font-medium tabular-nums text-copy-primary">
                    {money(
                      line.line_total ?? line.quantity * line.unit_price,
                      invoice.currency,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {invoice.payment_terms || invoice.notes ? (
        <Card className="p-5 lg:col-span-2">
          <h2 className="text-lg font-semibold text-copy-primary">
            Terms and notes
          </h2>
          {invoice.payment_terms ? (
            <p className="mt-3 whitespace-pre-line text-sm text-copy-secondary">
              {invoice.payment_terms}
            </p>
          ) : null}
          {invoice.notes ? (
            <p className="mt-4 whitespace-pre-line border-t border-line-subtle pt-4 text-sm text-copy-muted">
              {invoice.notes}
            </p>
          ) : null}
        </Card>
      ) : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <RecordPageHeader
        backHref="/dashboard/finance/pos"
        backLabel="Back to invoices"
        title={invoice.invoice_number}
        description={`${invoice.customer_name} · ${money(invoice.total_amount, invoice.currency)}`}
        primaryAction={
          <>
            <RecordDeleteButton
              endpoint={`/finance/pos-invoices/${invoice.id}`}
              label="Invoice"
              recordName={invoice.invoice_number}
              redirectHref="/dashboard/finance/pos"
              queryKeys={["pos-invoices"]}
            />
            <Button asChild variant="outline">
              <Link href={`/dashboard/finance/pos/${invoice.id}/print`}>
                <ExternalLink />
                Print
              </Link>
            </Button>
            <Button asChild>
              <Link href={`/dashboard/finance/pos/${invoice.id}/edit`}>
                <Pencil />
                Edit invoice
              </Link>
            </Button>
          </>
        }
      />
      <RecordTabs
        urlParam="tab"
        defaultTabId="overview"
        tabs={[
          { id: "overview", label: "Overview", content: overview },
          {
            id: "activity",
            label: "Activity",
            content: (
              <CrmRecordActivitySection
                moduleKey="finance_pos"
                entityId={invoice.id}
                recordLabel="Invoice-level"
              />
            ),
          },
        ]}
      />
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-copy-muted">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-copy-primary">{value}</dd>
    </div>
  );
}
function MoneyRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex justify-between gap-3 ${strong ? "border-t border-line-default pt-3 font-semibold text-copy-primary" : "text-sm text-copy-secondary"}`}
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
