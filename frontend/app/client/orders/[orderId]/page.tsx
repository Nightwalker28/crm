"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
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
    <main className="min-h-screen bg-app text-copy-primary">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-line-default pb-4">
          <Link href="/client" className="font-lynk text-3xl text-copy-primary">Lynk</Link>
          <Button asChild variant="outline" size="sm">
            <Link href="/client/orders">
              <ArrowLeft className="h-4 w-4" />
              Orders
            </Link>
          </Button>
        </header>

        {orderQuery.isLoading ? (
          <div className="rounded-[var(--radius-card)] border border-line-default bg-surface p-8 text-center text-sm text-copy-muted">Loading order...</div>
        ) : orderQuery.error ? (
          <div className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted p-5 text-sm text-state-danger">
            {orderQuery.error instanceof Error ? orderQuery.error.message : "Order unavailable."}
          </div>
        ) : order ? (
          <div className="grid gap-5">
            <section className="rounded-[var(--radius-card)] border border-line-default bg-surface p-5">
              <div className="text-xs font-medium text-copy-label">{order.external_reference}</div>
              <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h1 className="text-3xl font-semibold tracking-normal text-copy-primary">Order details</h1>
                  <p className="mt-1 text-sm text-copy-secondary">{formatDateTime(order.created_at)}</p>
                </div>
                <div className="text-right">
                  <div className="capitalize text-copy-secondary">{order.status.replaceAll("_", " ")}</div>
                  <div className="text-xl font-semibold text-copy-primary">{money(order.subtotal_amount, order.currency)}</div>
                </div>
              </div>
            </section>

            <section className="overflow-hidden rounded-[var(--radius-card)] border border-line-default bg-surface">
              <Table>
                <TableHeader>
                  <TableHeaderRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableHeaderRow>
                </TableHeader>
                <TableBody>
                  {order.line_items.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell>
                        <div className="font-medium text-copy-primary">{line.name}</div>
                        <div className="mt-1 text-xs font-medium text-copy-label">{line.item_type}</div>
                      </TableCell>
                      <TableCell className="text-right text-copy-secondary">{line.quantity}</TableCell>
                      <TableCell className="text-right text-copy-secondary">{money(line.unit_price_snapshot, line.currency)}</TableCell>
                      <TableCell className="text-right font-semibold text-copy-primary">{money(line.line_total, line.currency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
