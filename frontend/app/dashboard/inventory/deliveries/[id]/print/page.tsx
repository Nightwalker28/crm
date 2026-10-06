"use client";

import { MediaImage } from "@/components/ui/MediaImage";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/PageShell";
import { RouteErrorState, RouteLoadingState } from "@/components/ui/RouteStates";
import { useDelivery } from "@/hooks/inventory/useDeliveries";
import { apiFetch } from "@/lib/api";
import { formatDateOnly } from "@/lib/datetime";
import { resolveMediaUrl } from "@/lib/media";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { formatQuantity as quantity } from "@/lib/quantity";

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


/**
 * The delivery note (packing slip) that travels with the goods: what is in the parcel, for
 * which order, to which address. Quantities only — prices belong on the invoice.
 *
 * Drawn in semantic tokens so the preview follows the app theme; the `print-document`
 * rule in globals.css prints it as black ink on white paper.
 */
export default function DeliveryNotePrintPage() {
  const params = useParams<{ id: string }>();
  const deliveryId = Number(params.id);
  const delivery = useDelivery(Number.isFinite(deliveryId) && deliveryId > 0 ? deliveryId : null);
  const company = useQuery({ queryKey: ["company-profile"], queryFn: fetchCompanyProfile, staleTime: 10 * 60_000 });
  const backHref = `${DASHBOARD_ROUTES.inventoryDeliveries}/${deliveryId}`;

  if (delivery.error || company.error) {
    return (
      <RouteErrorState
        title="Unable to load the delivery note"
        backHref={backHref}
        backLabel="Back to delivery"
        reset={() => void Promise.all([delivery.refetch(), company.refetch()])}
      />
    );
  }
  if (!delivery.data || !company.data) return <RouteLoadingState />;

  const doc = delivery.data;
  const profile = company.data;
  const logoUrl = profile.logo_url ? resolveMediaUrl(profile.logo_url) : "";
  const units = (doc.lines ?? []).reduce((sum, line) => sum + Number(line.quantity), 0);

  return (
    <PageShell
      headerClassName="print:hidden"
      title="Print delivery note"
      description={`Review ${doc.number} before opening the browser print dialog.`}
      actions={
        <>
          <Button asChild variant="outline"><Link href={backHref}><ArrowLeft /> Back to delivery</Link></Button>
          <Button type="button" onClick={() => window.print()} aria-label={`Print delivery note ${doc.number}`}><Printer /> Print delivery note</Button>
        </>
      }
    >
      <section aria-labelledby="delivery-note-number" className="print-document rounded-[var(--radius-card)] border border-line-default bg-surface p-6 sm:p-8">
        <header className="flex flex-col justify-between gap-6 sm:flex-row">
          <div className="flex gap-4">
            <MediaImage src={logoUrl} alt={`${profile.name || "Company"} logo`} width={56} height={56} className="h-14 w-14 rounded-[var(--radius-control)] object-cover" fallback={null} />
            <div className="text-p-sm text-copy-secondary">
              <p className="text-sm font-semibold text-copy-primary">{profile.name || "Company"}</p>
              {lines(profile.billing_address).map((line) => <p key={line}>{line}</p>)}
              {profile.primary_phone ? <p>{profile.primary_phone}</p> : null}
              {profile.primary_email ? <p>{profile.primary_email}</p> : null}
            </div>
          </div>
          <div className="sm:text-right">
            <p className="text-xs font-medium text-copy-label">Delivery note</p>
            <h2 id="delivery-note-number" className="text-lg font-semibold text-copy-primary">{doc.number}</h2>
            <dl className="mt-2 grid grid-cols-[auto_auto] justify-start gap-x-4 gap-y-1 text-sm sm:justify-end">
              <dt className="text-copy-label">Shipped</dt><dd className="tabular-nums text-copy-primary">{doc.shipped_on ? formatDateOnly(doc.shipped_on) : "Not yet shipped"}</dd>
              <dt className="text-copy-label">Order</dt><dd className="text-copy-primary">{doc.order_number ?? "—"}</dd>
              {doc.carrier ? <><dt className="text-copy-label">Carrier</dt><dd className="text-copy-primary">{doc.carrier}</dd></> : null}
              {doc.tracking_number ? <><dt className="text-copy-label">Tracking</dt><dd className="text-copy-primary">{doc.tracking_number}</dd></> : null}
            </dl>
          </div>
        </header>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-copy-label">Deliver to</p>
            <div className="mt-1 text-sm text-copy-primary">
              <p className="font-semibold">{doc.customer_name ?? "—"}</p>
              {doc.contact_name && doc.contact_name !== doc.customer_name ? <p>Attn: {doc.contact_name}</p> : null}
              {lines(doc.delivery_address).map((line) => <p key={line}>{line}</p>)}
            </div>
          </div>
          {doc.warehouse_name ? (
            <div>
              <p className="text-xs font-medium text-copy-label">Shipped from</p>
              <p className="mt-1 text-sm text-copy-primary">{doc.warehouse_name}</p>
            </div>
          ) : null}
        </div>

        <table className="mt-8 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line-default text-left text-xs font-medium text-copy-label">
              <th scope="col" className="py-2 pr-4">Item</th>
              <th scope="col" className="py-2 pr-4">SKU</th>
              <th scope="col" className="py-2 pr-4 text-right">Ordered</th>
              <th scope="col" className="py-2 text-right">In this delivery</th>
            </tr>
          </thead>
          <tbody>
            {(doc.lines ?? []).map((line) => (
              <tr key={line.id} className="border-b border-line-subtle">
                <td className="py-2 pr-4 text-copy-primary">{line.name}</td>
                <td className="py-2 pr-4 text-copy-secondary">{line.sku ?? "—"}</td>
                <td className="py-2 pr-4 text-right tabular-nums text-copy-secondary">{quantity(line.ordered)}</td>
                <td className="py-2 text-right font-semibold tabular-nums text-copy-primary">{quantity(line.quantity)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="py-2 pr-4 text-right text-copy-label">Total units</td>
              <td className="py-2 text-right font-semibold tabular-nums text-copy-primary">{quantity(units)}</td>
            </tr>
          </tfoot>
        </table>

        {doc.notes ? <p className="mt-6 text-p-sm text-copy-secondary">{doc.notes}</p> : null}

        <div className="mt-12 grid gap-8 sm:grid-cols-2">
          <div className="border-t border-line-default pt-2 text-xs text-copy-label">Received by (name and signature)</div>
          <div className="border-t border-line-default pt-2 text-xs text-copy-label">Date</div>
        </div>
      </section>
    </PageShell>
  );
}
