"use client";

import { ClientPdfButton } from "@/components/client-portal/ClientPdfButton";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListRow, RowList } from "@/components/ui/ListRow";
import { Money } from "@/components/ui/Money";
import { PageShell } from "@/components/ui/PageShell";
import { StatusValue } from "@/components/ui/StatusValue";
import { useClientInvoices, type ClientInvoice } from "@/hooks/useClientPortal";
import { formatDateOnly } from "@/lib/datetime";
import { OVERDUE_STATUS, getPosInvoiceStatus, getPosPaymentStatus } from "@/lib/statusStyles";

function invoiceStatus(invoice: ClientInvoice) {
  if (invoice.status === "void") return getPosInvoiceStatus("void");
  return invoice.is_overdue ? OVERDUE_STATUS : getPosPaymentStatus(invoice.payment_status);
}

/**
 * The account's invoices (13d §3.7), with what is still owed and a PDF of each. Paying online
 * waits for payment links; until then the invoice's payment details say how to pay.
 */
export default function ClientInvoicesPage() {
  const invoicesQuery = useClientInvoices();
  const invoices = invoicesQuery.data?.results ?? [];
  const owed = invoices.filter((invoice) => invoice.status === "issued" && Number(invoice.balance_due) > 0);
  const byCurrency = owed.reduce<Record<string, number>>((totals, invoice) => {
    totals[invoice.currency] = (totals[invoice.currency] ?? 0) + Number(invoice.balance_due);
    return totals;
  }, {});

  return (
    <PageShell
      title="Invoices"
      description="Your invoices, what is still to pay, and a PDF of each. How to pay is printed on every invoice."
      isLoading={invoicesQuery.isLoading}
      hasError={Boolean(invoicesQuery.error)}
      backHref="/client"
      backLabel="Return to the portal"
      onRetry={() => invoicesQuery.refetch()}
    >
      {Object.keys(byCurrency).length ? (
        <Card className="p-4">
          <p className="text-sm text-copy-secondary">
            To pay:{" "}
            {Object.entries(byCurrency).map(([currency, amount], index) => (
              <span key={currency}>
                {index ? ", " : ""}
                <Money amount={amount} currency={currency} className="font-semibold text-copy-primary" />
              </span>
            ))}{" "}
            on {owed.length} invoice{owed.length === 1 ? "" : "s"}.
          </p>
        </Card>
      ) : null}
      {invoices.length === 0 ? (
        <EmptyState title="No invoices yet" description="Invoices we send you appear here, with what is still to pay." />
      ) : (
        <Card className="p-0">
          <RowList label="Invoices" inset>
            {invoices.map((invoice) => (
              <ListRow
                key={invoice.id}
                title={invoice.invoice_number ?? "Invoice"}
                meta={[
                  invoice.issue_date ? `Issued ${formatDateOnly(invoice.issue_date)}` : null,
                  invoice.status === "issued" && invoice.due_date ? `Due ${formatDateOnly(invoice.due_date)}` : null,
                ].filter(Boolean).join(" · ")}
                trailing={
                  <span className="flex items-center gap-3">
                    <StatusValue status={invoiceStatus(invoice)} />
                    <span className="text-right">
                      <Money amount={invoice.total_amount} currency={invoice.currency} className="block font-medium text-copy-primary" />
                      {invoice.status === "issued" && Number(invoice.balance_due) > 0 && Number(invoice.balance_due) < Number(invoice.total_amount) ? (
                        <span className="block text-xs text-copy-muted"><Money amount={invoice.balance_due} currency={invoice.currency} /> to pay</span>
                      ) : null}
                    </span>
                  </span>
                }
                actions={<ClientPdfButton kind="invoices" id={invoice.id} name={invoice.invoice_number ?? `invoice-${invoice.id}`} variant="ghost" size="sm" />}
              />
            ))}
          </RowList>
        </Card>
      )}
    </PageShell>
  );
}
