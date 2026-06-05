"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";

import CrmRecordActivitySection from "@/components/recordActivity/CrmRecordActivitySection";
import RecordPageHeader from "@/components/recordActivity/RecordPageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Order } from "@/hooks/sales/useOrders";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";

const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "confirmed", label: "Confirmed" },
  { value: "fulfilled", label: "Fulfilled" },
  { value: "cancelled", label: "Cancelled" },
];

function formatMoney(value: string | number | null | undefined, currency: string | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "-";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(amount);
}

export default function OrderDetailPage() {
  const params = useParams<{ orderId: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [status, setStatus] = useState("confirmed");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadOrder(signal?: { cancelled: boolean }) {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch(`/sales/orders/${params.orderId}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      if (signal?.cancelled) return;
      setOrder(body);
      setStatus(body.status ?? "confirmed");
    } catch (loadError) {
      if (!signal?.cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to load order");
    } finally {
      if (!signal?.cancelled) setLoading(false);
    }
  }

  useEffect(() => {
    const signal = { cancelled: false };
    void loadOrder(signal);
    return () => {
      signal.cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.orderId]);

  async function handleSave() {
    try {
      setSaving(true);
      setError(null);
      const res = await apiFetch(`/sales/orders/${params.orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      setOrder(body);
      toast.success("Order updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to update order");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <RecordPageHeader
        backHref="/dashboard/sales/orders"
        backLabel="Back to Orders"
        title={order ? order.order_number : "Order"}
        description="Review order value, linked quote, and fulfillment status."
        primaryAction={<Button onClick={handleSave} disabled={saving || loading}>{saving ? "Saving..." : "Save Order"}</Button>}
      />

      {error ? <div className="rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div> : null}

      {loading || !order ? (
        <Card className="px-5 py-5 text-sm text-neutral-500">Loading order...</Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
          <Card className="px-5 py-5">
            <h2 className="text-lg font-semibold text-neutral-100">Order Details</h2>
            <FieldDescription className="mt-1">Update the lifecycle status for this order.</FieldDescription>
            <FieldGroup className="mt-4 grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel>Status</FieldLabel>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <SummaryTile label="Total" value={formatMoney(order.grand_total, order.currency)} />
              <SummaryTile label="Subtotal" value={formatMoney(order.subtotal, order.currency)} />
              <SummaryTile label="Tax" value={formatMoney(order.tax_total, order.currency)} />
              <SummaryTile label="Discount" value={formatMoney(order.discount_total, order.currency)} />
              <SummaryTile label="Created" value={formatDateTime(order.created_at)} />
            </FieldGroup>
          </Card>

          <Card className="px-5 py-5">
            <h2 className="text-lg font-semibold text-neutral-100">Links</h2>
            <div className="mt-4 grid gap-3">
              <LinkedTile label="Quote" value={order.quote_id ? `Quote #${order.quote_id}` : "No quote"} href={order.quote_id ? `/dashboard/sales/quotes/${order.quote_id}` : null} />
              <LinkedTile label="Account" value={order.organization_id ? `Account #${order.organization_id}` : "No account"} href={order.organization_id ? `/dashboard/sales/organizations/${order.organization_id}` : null} />
              <LinkedTile label="Contact" value={order.contact_id ? `Contact #${order.contact_id}` : "No contact"} href={order.contact_id ? `/dashboard/sales/contacts/${order.contact_id}` : null} />
              <LinkedTile label="Deal" value={order.opportunity_id ? `Deal #${order.opportunity_id}` : "No deal"} href={order.opportunity_id ? `/dashboard/sales/opportunities/${order.opportunity_id}` : null} />
            </div>
          </Card>

          <Card className="px-5 py-5 lg:col-span-2">
            <h2 className="text-lg font-semibold text-neutral-100">Items</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Qty</th>
                    <th className="py-2 pr-4">Unit</th>
                    <th className="py-2 pr-4">Discount</th>
                    <th className="py-2 pr-4">Tax</th>
                    <th className="py-2 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {(order.items ?? []).map((item) => (
                    <tr key={item.id}>
                      <td className="py-3 pr-4 text-neutral-100">
                        <div>{item.name}</div>
                        {item.description ? <div className="mt-1 text-xs text-neutral-500">{item.description}</div> : null}
                      </td>
                      <td className="py-3 pr-4 tabular-nums text-neutral-300">{String(item.quantity)}</td>
                      <td className="py-3 pr-4 tabular-nums text-neutral-300">{formatMoney(item.unit_price, order.currency)}</td>
                      <td className="py-3 pr-4 tabular-nums text-neutral-300">{formatMoney(item.discount_amount, order.currency)}</td>
                      <td className="py-3 pr-4 tabular-nums text-neutral-300">{formatMoney(item.tax_amount, order.currency)}</td>
                      <td className="py-3 text-right tabular-nums text-neutral-100">{formatMoney(item.line_total, order.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <CrmRecordActivitySection
            className="lg:col-span-2"
            moduleKey="sales_orders"
            entityId={order.id}
            recordLabel="Order"
            taskSourceLabel={order.order_number}
          />
        </div>
      )}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-2 text-sm text-neutral-100">{value}</div>
    </div>
  );
}

function LinkedTile({ label, value, href }: { label: string; value: string; href: string | null }) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-2 text-sm text-neutral-100">
        {href ? <Link href={href} className="hover:text-white">{value}</Link> : value}
      </div>
    </div>
  );
}
