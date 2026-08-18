"use client";

import Link from "next/link";
import { ArrowRight, ShoppingCart } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useClientOrders, type ClientPortalOrder } from "@/hooks/useClientPortal";
import { formatDateTime } from "@/lib/datetime";

function money(value: string | number, currency: string) {
  const amount = Number(value);
  return `${currency} ${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;
}

function firstLine(order: ClientPortalOrder) {
  const line = order.line_items[0];
  if (!line) return "No items";
  return order.line_items.length > 1 ? `${line.name} + ${order.line_items.length - 1} more` : line.name;
}

export default function ClientOrdersPage() {
  const ordersQuery = useClientOrders();
  const orders = ordersQuery.data?.results ?? [];

  return (
    <main className="min-h-screen bg-app text-copy-primary">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-line-default pb-4">
          <Link href="/client" className="font-lynk text-3xl text-copy-primary">Lynk</Link>
          <Button asChild variant="outline" size="sm">
            <Link href="/client/catalog">Catalog</Link>
          </Button>
        </header>

        <section className="mb-5">
          <div className="flex items-center gap-2 text-sm text-copy-secondary">
            <ShoppingCart className="h-4 w-4" />
            Client orders
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal text-copy-primary">Order history</h1>
        </section>

        {ordersQuery.isLoading ? (
          <div className="rounded-[var(--radius-card)] border border-line-default bg-surface p-8 text-center text-sm text-copy-muted">Loading orders...</div>
        ) : ordersQuery.error ? (
          <div className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted p-5 text-sm text-state-danger">
            {ordersQuery.error instanceof Error ? ordersQuery.error.message : "Failed to load orders."}
          </div>
        ) : orders.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-line-default bg-surface p-8 text-center text-sm text-copy-muted">No orders submitted yet.</div>
        ) : (
          <div className="grid gap-3">
            {orders.map((order) => (
              <Link key={order.id} href={`/client/orders/${order.id}`} className="group rounded-[var(--radius-control)] border border-line-subtle bg-surface p-4 transition-colors hover:border-line-strong hover:bg-surface-raised">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium text-copy-label">{order.external_reference}</div>
                    <h2 className="mt-1 font-semibold text-copy-primary">{firstLine(order)}</h2>
                    <p className="mt-1 text-xs text-copy-muted">{formatDateTime(order.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="capitalize text-copy-secondary">{order.status.replaceAll("_", " ")}</div>
                      <div className="text-sm font-semibold text-copy-primary">{money(order.subtotal_amount, order.currency)}</div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-copy-muted transition-transform group-hover:translate-x-0.5" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
