"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { resolveMediaUrl } from "@/lib/media";
import { fetchPosInvoice, type PosInvoice } from "@/hooks/finance/usePosInvoices";

type CompanyProfile = {
  name?: string | null;
  primary_email?: string | null;
  website?: string | null;
  primary_phone?: string | null;
  billing_address?: string | null;
  logo_url?: string | null;
};

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function lines(value?: string | null) {
  return (value || "").split("\n").filter(Boolean).map((line) => <span key={line}>{line}<br /></span>);
}

export default function PosInvoicePrintPage() {
  const params = useParams<{ invoiceId: string }>();
  const invoiceId = Number(params.invoiceId);
  const [invoice, setInvoice] = useState<PosInvoice | null>(null);
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [nextInvoice, companyRes] = await Promise.all([
          fetchPosInvoice(invoiceId),
          apiFetch("/users/company"),
        ]);
        const companyBody = await companyRes.json().catch(() => null);
        if (!companyRes.ok) throw new Error(companyBody?.detail ?? `Failed with ${companyRes.status}`);
        if (!cancelled) {
          setInvoice(nextInvoice);
          setCompany(companyBody as CompanyProfile);
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to load invoice");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  if (error) {
    return <div className="rounded-md border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-200">{error}</div>;
  }

  if (!invoice || !company) {
    return <div className="text-sm text-neutral-500">Loading invoice...</div>;
  }

  const isClassic = invoice.template_id === "classic";
  const logoUrl = company.logo_url ? resolveMediaUrl(company.logo_url) : "";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Button asChild variant="outline">
          <Link href="/dashboard/finance/pos"><ArrowLeft /> POS Mode</Link>
        </Button>
        <Button onClick={() => window.print()}><Printer /> Print</Button>
      </div>

      <section className={`invoice-print-area overflow-hidden rounded-md border shadow-2xl ${isClassic ? "border-neutral-300 bg-neutral-100 text-neutral-950" : "border-neutral-800 bg-neutral-950 text-neutral-100"}`}>
        <div className="p-8" style={{ borderTop: invoice.template_id === "modern" ? `8px solid ${invoice.accent_color}` : undefined }}>
          <header className="flex flex-col justify-between gap-6 sm:flex-row">
            <div className="flex gap-4">
              {logoUrl ? (
                <Image src={logoUrl} alt={`${company.name || "Company"} logo`} width={56} height={56} unoptimized className="h-14 w-14 rounded-md object-cover" />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-md text-lg font-bold text-white" style={{ backgroundColor: invoice.accent_color }}>
                  {(company.name || "P").slice(0, 1)}
                </div>
              )}
              <div>
                <h1 className="text-xl font-semibold">{company.name || "Company"}</h1>
                <div className={`mt-2 text-sm leading-6 ${isClassic ? "text-neutral-700" : "text-neutral-400"}`}>
                  {lines(company.billing_address)}
                  {company.primary_email}<br />
                  {company.primary_phone}<br />
                  {company.website}
                </div>
              </div>
            </div>
            <div className={`min-w-[230px] rounded-md border p-4 ${isClassic ? "border-neutral-300 bg-white" : "border-neutral-800 bg-neutral-900/70"}`}>
              <div className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: invoice.accent_color }}>POS Invoice</div>
              <div className="mt-2 text-2xl font-semibold">{invoice.invoice_number}</div>
              <dl className={`mt-4 grid grid-cols-2 gap-2 text-sm ${isClassic ? "text-neutral-700" : "text-neutral-400"}`}>
                <dt>Issued</dt><dd className="text-right">{invoice.issue_date || "—"}</dd>
                <dt>Due</dt><dd className="text-right">{invoice.due_date || "—"}</dd>
                <dt>Status</dt><dd className="text-right capitalize">{invoice.status}</dd>
                <dt>Payment</dt><dd className="text-right capitalize">{invoice.payment_status}</dd>
              </dl>
            </div>
          </header>

          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: invoice.accent_color }}>Bill To</div>
              <div className="mt-2 text-base font-semibold">{invoice.customer_name}</div>
              <div className={`mt-2 text-sm leading-6 ${isClassic ? "text-neutral-700" : "text-neutral-400"}`}>
                {lines(invoice.customer_address)}
                {invoice.customer_email}
              </div>
            </div>
            <div className={`rounded-md border p-4 ${isClassic ? "border-neutral-300 bg-white text-neutral-700" : "border-neutral-800 bg-neutral-900/50 text-neutral-400"}`}>
              <div><span className={isClassic ? "font-medium text-neutral-950" : "font-medium text-neutral-100"}>Payment method:</span> {invoice.payment_method || "—"}</div>
              <div className="mt-2"><span className={isClassic ? "font-medium text-neutral-950" : "font-medium text-neutral-100"}>Terms:</span> {invoice.payment_terms || "—"}</div>
              {invoice.notes ? <div className="mt-2"><span className={isClassic ? "font-medium text-neutral-950" : "font-medium text-neutral-100"}>Notes:</span> {invoice.notes}</div> : null}
            </div>
          </div>

          <div className={`mt-8 overflow-hidden rounded-md border ${isClassic ? "border-neutral-300" : "border-neutral-800"}`}>
            <table className="w-full border-collapse text-sm">
              <thead style={{ backgroundColor: invoice.accent_color }}>
                <tr className="text-left text-white">
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Rate</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className={isClassic ? "bg-white text-neutral-800" : "bg-neutral-950/40 text-neutral-300"}>
                {(invoice.lines || []).map((line) => (
                  <tr key={line.id} className={isClassic ? "border-t border-neutral-200" : "border-t border-neutral-800"}>
                    <td className="px-4 py-3">{line.description}</td>
                    <td className="px-4 py-3 text-right">{line.quantity}</td>
                    <td className="px-4 py-3 text-right">{money(line.unit_price, invoice.currency)}</td>
                    <td className="px-4 py-3 text-right font-medium">{money(line.line_total || 0, invoice.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex justify-end">
            <div className={`w-full max-w-sm rounded-md border p-4 ${isClassic ? "border-neutral-300 bg-white text-neutral-800" : "border-neutral-800 bg-neutral-900/60 text-neutral-300"}`}>
              <div className="flex justify-between py-1 text-sm"><span>Subtotal</span><span>{money(invoice.subtotal_amount, invoice.currency)}</span></div>
              <div className="flex justify-between py-1 text-sm"><span>Discount</span><span>-{money(invoice.discount_amount, invoice.currency)}</span></div>
              <div className="flex justify-between py-1 text-sm"><span>Tax</span><span>{money(invoice.tax_amount, invoice.currency)}</span></div>
              <div className="flex justify-between py-1 text-sm"><span>Paid</span><span>{money(invoice.amount_paid, invoice.currency)}</span></div>
              <div className="mt-3 flex justify-between border-t pt-3 text-lg font-semibold" style={{ borderColor: invoice.accent_color }}>
                <span>Balance</span><span>{money(invoice.balance_due, invoice.currency)}</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
