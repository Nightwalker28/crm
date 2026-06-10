"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useClientOrder } from "@/hooks/useClientPortal";
import { formatDateTime } from "@/lib/datetime";

function money(value: string | number, currency: string) {
  const amount = Number(value);
  return `${currency} ${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;
}

export default function ClientOrderDetailPage() {
  const params = useParams();
  const orderId = String(params.orderId ?? "");
  const orderQuery = useClientOrder(orderId);
  const order = orderQuery.data;

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 pb-4">
          <Link href="/client" className="font-lynk text-3xl text-white">Lynk</Link>
          <Button asChild variant="outline" size="sm">
            <Link href="/client/orders">
              <ArrowLeft className="h-4 w-4" />
              Orders
            </Link>
          </Button>
        </header>

        {orderQuery.isLoading ? (
          <div className="rounded-md border border-neutral-800 bg-neutral-900 p-8 text-center text-sm text-neutral-500">Loading order...</div>
        ) : orderQuery.error ? (
          <div className="rounded-md border border-red-900/60 bg-red-950/20 p-5 text-sm text-red-200">
            {orderQuery.error instanceof Error ? orderQuery.error.message : "Order unavailable."}
          </div>
        ) : order ? (
          <div className="grid gap-5">
            <section className="rounded-md border border-neutral-800 bg-neutral-900 p-5">
              <div className="text-xs uppercase text-neutral-500">{order.external_reference}</div>
              <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h1 className="text-3xl font-semibold tracking-normal text-neutral-50">Order details</h1>
                  <p className="mt-1 text-sm text-neutral-400">{formatDateTime(order.created_at)}</p>
                </div>
                <div className="text-right">
                  <div className="capitalize text-neutral-300">{order.status.replaceAll("_", " ")}</div>
                  <div className="text-xl font-semibold text-neutral-50">{money(order.subtotal_amount, order.currency)}</div>
                </div>
              </div>
            </section>

            <section className="overflow-hidden rounded-md border border-neutral-800 bg-neutral-900">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-neutral-800 text-xs uppercase text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Item</th>
                    <th className="px-4 py-3 text-right font-medium">Qty</th>
                    <th className="px-4 py-3 text-right font-medium">Unit</th>
                    <th className="px-4 py-3 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {order.line_items.map((line) => (
                    <tr key={line.id}>
                      <td className="px-4 py-4">
                        <div className="font-medium text-neutral-100">{line.name}</div>
                        <div className="mt-1 text-xs uppercase text-neutral-500">{line.item_type}</div>
                      </td>
                      <td className="px-4 py-4 text-right text-neutral-300">{line.quantity}</td>
                      <td className="px-4 py-4 text-right text-neutral-300">{money(line.unit_price_snapshot, line.currency)}</td>
                      <td className="px-4 py-4 text-right font-semibold text-neutral-50">{money(line.line_total, line.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
