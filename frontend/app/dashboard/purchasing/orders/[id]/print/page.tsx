"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/Money";
import { PageShell } from "@/components/ui/PageShell";
import { RouteErrorState, RouteLoadingState } from "@/components/ui/RouteStates";
import { usePurchaseOrder } from "@/hooks/purchasing/usePurchasing";
import { apiFetch } from "@/lib/api";
import { formatDateOnly } from "@/lib/datetime";
import { resolveMediaUrl } from "@/lib/media";
import { DASHBOARD_ROUTES } from "@/lib/routes";

type CompanyProfile = {
  name?: string | null;
  primary_email?: string | null;
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

function lines(value?: string | null) {
  return (value || "").split("\n").map((line) => line.trim()).filter(Boolean);
}

function quantity(value: string | number | null | undefined) {
  if (value == null || value === "") return "—";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/**
 * The purchase order as sent to the vendor: what to deliver, where, at what price. Drawn in
 * semantic tokens; the `print-document` rule prints it as black ink on white paper.
 */
export default function PurchaseOrderPrintPage() {
  const params = useParams<{ id: string }>();
  const orderId = Number(params.id);
  const order = usePurchaseOrder(Number.isFinite(orderId) && orderId > 0 ? orderId : null);
  const company = useQuery({ queryKey: ["company-profile"], queryFn: fetchCompanyProfile, staleTime: 10 * 60_000 });
  const backHref = `${DASHBOARD_ROUTES.purchaseOrders}/${orderId}`;

  if (order.error || company.error) {
    return (
      <RouteErrorState
        title="Unable to load the purchase order"
        backHref={backHref}
        backLabel="Back to purchase order"
        reset={() => void Promise.all([order.refetch(), company.refetch()])}
      />
    );
  }
  if (!order.data || !company.data) return <RouteLoadingState />;

  const doc = order.data;
  const profile = company.data;
  const logoUrl = profile.logo_url ? resolveMediaUrl(profile.logo_url) : "";

  return (
    <PageShell
      headerClassName="print:hidden"
      title="Print purchase order"
      description={`Review ${doc.number} before opening the browser print dialog.`}
      actions={
        <>
          <Button asChild variant="outline"><Link href={backHref}><ArrowLeft /> Back to purchase order</Link></Button>
          <Button type="button" onClick={() => window.print()} aria-label={`Print purchase order ${doc.number}`}><Printer /> Print purchase order</Button>
        </>
      }
    >
      <section aria-labelledby="purchase-order-number" className="print-document rounded-[var(--radius-card)] border border-line-default bg-surface p-6 sm:p-8">
        <header className="flex flex-col justify-between gap-6 sm:flex-row">
          <div className="flex gap-4">
            {logoUrl ? <Image src={logoUrl} alt={`${profile.name || "Company"} logo`} width={56} height={56} unoptimized className="h-14 w-14 rounded-[var(--radius-control)] object-cover" /> : null}
            <div className="text-p-sm text-copy-secondary">
              <p className="text-sm font-semibold text-copy-primary">{profile.name || "Company"}</p>
              {lines(profile.billing_address).map((line) => <p key={line}>{line}</p>)}
              {profile.primary_phone ? <p>{profile.primary_phone}</p> : null}
              {profile.primary_email ? <p>{profile.primary_email}</p> : null}
            </div>
          </div>
          <div className="sm:text-right">
            <p className="text-xs font-medium text-copy-label">Purchase order</p>
            <h2 id="purchase-order-number" className="text-lg font-semibold text-copy-primary">{doc.number}</h2>
            <dl className="mt-2 grid grid-cols-[auto_auto] justify-start gap-x-4 gap-y-1 text-sm sm:justify-end">
              <dt className="text-copy-label">Date</dt><dd className="tabular-nums text-copy-primary">{formatDateOnly(doc.ordered_at ?? doc.created_at)}</dd>
              {doc.expected_date ? <><dt className="text-copy-label">Deliver by</dt><dd className="tabular-nums text-copy-primary">{formatDateOnly(doc.expected_date)}</dd></> : null}
              {doc.vendor_reference ? <><dt className="text-copy-label">Your reference</dt><dd className="text-copy-primary">{doc.vendor_reference}</dd></> : null}
            </dl>
          </div>
        </header>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-copy-label">Vendor</p>
            <div className="mt-1 text-sm text-copy-primary">
              <p className="font-semibold">{doc.vendor_name ?? "—"}</p>
              {lines(doc.vendor_address).map((line) => <p key={line}>{line}</p>)}
              {doc.vendor_email ? <p>{doc.vendor_email}</p> : null}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-copy-label">Deliver to</p>
            <p className="mt-1 text-sm text-copy-primary">{doc.warehouse_name ?? profile.name ?? "—"}</p>
          </div>
        </div>

        <table className="mt-8 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line-default text-left text-xs font-medium text-copy-label">
              <th scope="col" className="py-2 pr-4">Item</th>
              <th scope="col" className="py-2 pr-4">Your code</th>
              <th scope="col" className="py-2 pr-4 text-right">Quantity</th>
              <th scope="col" className="py-2 pr-4 text-right">Unit price</th>
              <th scope="col" className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(doc.lines ?? []).map((line) => (
              <tr key={line.id} className="border-b border-line-subtle">
                <td className="py-2 pr-4 text-copy-primary">{line.product_name}{line.description ? <span className="block text-xs text-copy-secondary">{line.description}</span> : null}</td>
                <td className="py-2 pr-4 text-copy-secondary">{line.vendor_sku ?? "—"}</td>
                <td className="py-2 pr-4 text-right tabular-nums text-copy-primary">{quantity(line.quantity)}</td>
                <td className="py-2 pr-4 text-right tabular-nums text-copy-secondary"><Money amount={line.unit_cost} currency={doc.currency} /></td>
                <td className="py-2 text-right tabular-nums text-copy-primary"><Money amount={line.line_total} currency={doc.currency} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="py-2 pr-4 text-right font-semibold text-copy-primary">Total</td>
              <td className="py-2 text-right font-semibold tabular-nums text-copy-primary"><Money amount={doc.subtotal} currency={doc.currency} /></td>
            </tr>
          </tfoot>
        </table>

        {doc.notes ? <p className="mt-6 text-p-sm text-copy-secondary">{doc.notes}</p> : null}
      </section>
    </PageShell>
  );
}
