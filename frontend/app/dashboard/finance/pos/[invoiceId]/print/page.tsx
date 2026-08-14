"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/PageShell";
import {
  RouteErrorState,
  RouteLoadingState,
} from "@/components/ui/RouteStates";
import { apiFetch } from "@/lib/api";
import { formatDateOnly } from "@/lib/datetime";
import { resolveMediaUrl } from "@/lib/media";
import { getPosInvoiceStatusStyle, getPosPaymentStatusStyle } from "@/lib/statusStyles";
import { fetchPosInvoice } from "@/hooks/finance/usePosInvoices";

type CompanyProfile = {
  name?: string | null;
  primary_email?: string | null;
  website?: string | null;
  primary_phone?: string | null;
  billing_address?: string | null;
  logo_url?: string | null;
};

async function fetchCompanyProfile(): Promise<CompanyProfile> {
  const res = await apiFetch("/users/company");
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error("Unable to load company profile");
  return body as CompanyProfile;
}

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function multiline(value?: string | null) {
  return (value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (
      <span key={line}>
        {line}
        <br />
      </span>
    ));
}

function safeAccentColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#0f766e";
}

export default function PosInvoicePrintPage() {
  const params = useParams<{ invoiceId: string }>();
  const invoiceId = Number(params.invoiceId);
  const invoiceQuery = useQuery({
    queryKey: ["pos-invoice", invoiceId],
    queryFn: () => fetchPosInvoice(invoiceId),
    enabled: Number.isFinite(invoiceId) && invoiceId > 0,
    staleTime: 30_000,
  });
  const companyQuery = useQuery({
    queryKey: ["company-profile"],
    queryFn: fetchCompanyProfile,
    staleTime: 10 * 60_000,
  });
  const invoice = invoiceQuery.data;
  const company = companyQuery.data;
  if (invoiceQuery.error || companyQuery.error) {
    return (
      <RouteErrorState
        title="Unable to load printable invoice"
        backHref="/dashboard/finance/pos"
        backLabel="Back to invoices"
        reset={() =>
          void Promise.all([invoiceQuery.refetch(), companyQuery.refetch()])
        }
      />
    );
  }

  if (!invoice || !company) {
    return <RouteLoadingState />;
  }

  const isClassic = invoice.template_id === "classic";
  const isCompact = invoice.template_id === "compact";
  const logoUrl = company.logo_url ? resolveMediaUrl(company.logo_url) : "";
  const accentColor = safeAccentColor(invoice.accent_color);
  const invoiceStatus = getPosInvoiceStatusStyle(invoice.status);
  const paymentStatus = getPosPaymentStatusStyle(invoice.payment_status);

  // Printable customer documents use fixed colors so exports remain stable
  // regardless of the dashboard theme selected by the current CRM user.

  return (
    <PageShell
      headerClassName="print:hidden"
      title="Print invoice"
      description={`Review ${invoice.invoice_number} before opening the browser print dialog.`}
      actions={
        <>
          <Button asChild variant="outline">
            <Link href={`/dashboard/finance/pos/${invoice.id}`}>
              <ArrowLeft /> Back to invoice
            </Link>
          </Button>
          <Button type="button" onClick={() => window.print()} aria-label={`Print invoice ${invoice.invoice_number}`}>
            <Printer /> Print invoice
          </Button>
        </>
      }
    >
      <section
        aria-labelledby="print-invoice-number"
        className={`invoice-print-area overflow-hidden rounded-[var(--radius-card)] border shadow-xl ${isClassic ? "border-neutral-300 bg-neutral-100 text-neutral-950" : "border-neutral-800 bg-neutral-950 text-neutral-100"}`}
      >
        <div
          className={isCompact ? "p-5 sm:p-6" : "p-5 sm:p-8"}
          style={{
            borderTop:
              invoice.template_id === "modern"
                ? `8px solid ${accentColor}`
                : undefined,
          }}
        >
          <header className={`flex flex-col justify-between sm:flex-row ${isCompact ? "gap-4" : "gap-6"}`}>
            <div className="flex gap-4">
              {logoUrl ? (
                <Image
                  src={logoUrl}
                  alt={`${company.name || "Company"} logo`}
                  width={56}
                  height={56}
                  unoptimized
                  className="h-14 w-14 rounded-[var(--radius-control)] object-cover"
                />
              ) : (
                <div
                  className="flex h-14 w-14 items-center justify-center rounded-[var(--radius-control)] text-lg font-bold text-white"
                  style={{ backgroundColor: accentColor }}
                  aria-hidden="true"
                >
                  {(company.name || "P").slice(0, 1)}
                </div>
              )}
              <div>
                {/* The printed document sits inside a page the shell has already named
                    "Print invoice" — §8 allows one h1, so the document's own headings are
                    section headings. The print stylesheet sizes them, not the tag. */}
                <h2 className="text-xl font-semibold">
                  {company.name || "Company"}
                </h2>
                <div
                  className={`mt-2 text-p-sm ${isClassic ? "text-neutral-700" : "text-neutral-400"}`}
                >
                  {multiline(company.billing_address)}
                  {[company.primary_email, company.primary_phone, company.website].filter(Boolean).map((item) => (
                    <span key={item}>
                      {item}
                      <br />
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div
              className={`min-w-[230px] rounded-[var(--radius-control)] border p-4 ${isClassic ? "border-neutral-300 bg-white" : "border-neutral-800 bg-neutral-900/70"}`}
            >
              <div
                className="text-xs font-semibold"
                style={{ color: accentColor }}
              >
                POS Invoice
              </div>
              <h2 id="print-invoice-number" className="mt-2 text-2xl font-semibold">
                {invoice.invoice_number}
              </h2>
              <dl
                className={`mt-4 grid grid-cols-2 gap-2 text-sm ${isClassic ? "text-neutral-700" : "text-neutral-400"}`}
              >
                <dt>Issued</dt>
                <dd className="text-right">{invoice.issue_date ? <time dateTime={invoice.issue_date}>{formatDateOnly(invoice.issue_date)}</time> : "Not recorded"}</dd>
                <dt>Due</dt>
                <dd className="text-right">{invoice.due_date ? <time dateTime={invoice.due_date}>{formatDateOnly(invoice.due_date)}</time> : "Not set"}</dd>
                <dt>Status</dt>
                <dd className="text-right">{invoiceStatus.label}</dd>
                <dt>Payment</dt>
                <dd className="text-right">{paymentStatus.label}</dd>
              </dl>
            </div>
          </header>

          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            <div>
              <div
                className="text-xs font-semibold"
                style={{ color: accentColor }}
              >
                Bill To
              </div>
              <div className="mt-2 text-base font-semibold">
                {invoice.customer_name}
              </div>
              <div
                className={`mt-2 text-p-sm ${isClassic ? "text-neutral-700" : "text-neutral-400"}`}
              >
                {multiline(invoice.customer_address)}
                {invoice.customer_email || "Email not provided"}
              </div>
            </div>
            <div
              className={`rounded-[var(--radius-control)] border p-4 ${isClassic ? "border-neutral-300 bg-white text-neutral-700" : "border-neutral-800 bg-neutral-900/50 text-neutral-400"}`}
            >
              <div>
                <span
                  className={
                    isClassic
                      ? "font-medium text-neutral-950"
                      : "font-medium text-neutral-100"
                  }
                >
                  Payment method:
                </span>{" "}
                {invoice.payment_method || "—"}
              </div>
              <div className="mt-2">
                <span
                  className={
                    isClassic
                      ? "font-medium text-neutral-950"
                      : "font-medium text-neutral-100"
                  }
                >
                  Terms:
                </span>{" "}
                {invoice.payment_terms || "—"}
              </div>
              {invoice.notes ? (
                <div className="mt-2">
                  <span
                    className={
                      isClassic
                        ? "font-medium text-neutral-950"
                        : "font-medium text-neutral-100"
                    }
                  >
                    Notes:
                  </span>{" "}
                  {invoice.notes}
                </div>
              ) : null}
            </div>
          </div>

          <div
            className={`overflow-x-auto rounded-[var(--radius-control)] border ${isCompact ? "mt-5" : "mt-8"} ${isClassic ? "border-neutral-300" : "border-neutral-800"}`}
          >
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <caption className="sr-only">Line items for invoice {invoice.invoice_number}</caption>
              <thead style={{ backgroundColor: accentColor }}>
                <tr className="text-left text-white">
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Rate</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody
                className={
                  isClassic
                    ? "bg-white text-neutral-800"
                    : "bg-neutral-950/40 text-neutral-300"
                }
              >
                {(invoice.lines || []).map((line) => (
                  <tr
                    key={line.id}
                    className={
                      isClassic
                        ? "border-t border-neutral-200"
                        : "border-t border-neutral-800"
                    }
                  >
                    <td className="px-4 py-3">{line.description}</td>
                    <td className="px-4 py-3 text-right">{line.quantity}</td>
                    <td className="px-4 py-3 text-right">
                      {money(line.unit_price, invoice.currency)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {money(line.line_total || 0, invoice.currency)}
                    </td>
                  </tr>
                ))}
                {!invoice.lines?.length ? (
                  <tr>
                    <td className="px-4 py-6 text-center" colSpan={4}>No line items recorded.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex justify-end">
            <dl
              className={`w-full max-w-sm rounded-[var(--radius-control)] border p-4 ${isClassic ? "border-neutral-300 bg-white text-neutral-800" : "border-neutral-800 bg-neutral-900/60 text-neutral-300"}`}
            >
              <div className="flex justify-between py-1 text-sm">
                <dt>Subtotal</dt>
                <dd>{money(invoice.subtotal_amount, invoice.currency)}</dd>
              </div>
              <div className="flex justify-between py-1 text-sm">
                <dt>Discount</dt>
                <dd>− {money(invoice.discount_amount, invoice.currency)}</dd>
              </div>
              <div className="flex justify-between py-1 text-sm">
                <dt>Tax</dt>
                <dd>{money(invoice.tax_amount, invoice.currency)}</dd>
              </div>
              <div className="flex justify-between py-1 text-sm">
                <dt>Paid</dt>
                <dd>− {money(invoice.amount_paid, invoice.currency)}</dd>
              </div>
              <div
                className="mt-3 flex justify-between border-t pt-3 text-lg font-semibold"
                style={{ borderColor: accentColor }}
              >
                <dt>Balance due</dt>
                <dd>{money(invoice.balance_due, invoice.currency)}</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
