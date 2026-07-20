"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Pencil } from "lucide-react";
import { toast } from "sonner";

import CrmRecordActivitySection from "@/components/recordActivity/CrmRecordActivitySection";
import RecordPageHeader from "@/components/recordActivity/RecordPageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RouteErrorState,
  RouteLoadingState,
} from "@/components/ui/RouteStates";
import type { Order } from "@/hooks/sales/useOrders";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";

const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "confirmed", label: "Confirmed" },
  { value: "fulfilled", label: "Fulfilled" },
  { value: "cancelled", label: "Cancelled" },
];

function formatMoney(
  value: string | number | null | undefined,
  currency: string | null | undefined,
) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "-";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency || "USD",
  }).format(amount);
}

export default function OrderDetailPage() {
  const params = useParams<{ orderId: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [status, setStatus] = useState("confirmed");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);

  async function loadOrder(signal?: { cancelled: boolean }) {
    try {
      setLoading(true);
      setLoadError(false);
      const res = await apiFetch(`/sales/orders/${params.orderId}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error("Unable to load order");
      if (signal?.cancelled) return;
      setOrder(body);
      setStatus(body.status ?? "confirmed");
    } catch {
      if (!signal?.cancelled) setLoadError(true);
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
      setSaveError(false);
      const res = await apiFetch(`/sales/orders/${params.orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error("Unable to update order");
      setOrder(body);
      toast.success("Order updated.");
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <RouteLoadingState />;
  if (loadError || !order)
    return (
      <RouteErrorState
        title="Unable to load order"
        backHref="/dashboard/sales/orders"
        backLabel="Back to orders"
        reset={() => void loadOrder()}
      />
    );

  return (
    <div className="flex flex-col gap-6 text-copy-primary">
      <RecordPageHeader
        backHref="/dashboard/sales/orders"
        backLabel="Back to Orders"
        title={order ? order.order_number : "Order"}
        description="Review order value, linked quote, and fulfillment status."
        primaryAction={
          <>
            <Button asChild variant="outline">
              <Link href={`/dashboard/sales/orders/${params.orderId}/edit`}>
                <Pencil />
                Edit order
              </Link>
            </Button>
            <Button onClick={handleSave} disabled={saving || loading}>
              {saving ? "Saving..." : "Save status"}
            </Button>
          </>
        }
      />

      {saveError ? (
        <div
          role="alert"
          className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary"
        >
          We could not update this order. Check your connection and try again.
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
        <Card className="px-5 py-5">
          <h2 className="text-lg font-semibold text-copy-primary">
            Order details
          </h2>
          <FieldDescription className="mt-1">
            Update the lifecycle status for this order.
          </FieldDescription>
          <FieldGroup className="mt-4 grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>Status</FieldLabel>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <SummaryTile
              label="Total"
              value={formatMoney(order.grand_total, order.currency)}
            />
            <SummaryTile
              label="Subtotal"
              value={formatMoney(order.subtotal, order.currency)}
            />
            <SummaryTile
              label="Tax"
              value={formatMoney(order.tax_total, order.currency)}
            />
            <SummaryTile
              label="Discount"
              value={formatMoney(order.discount_total, order.currency)}
            />
            <SummaryTile
              label="Created"
              value={formatDateTime(order.created_at)}
            />
            <SummaryTile
              label="Delivery date"
              value={order.delivery_date || "Not scheduled"}
            />
            <SummaryTile
              label="Payment terms"
              value={order.payment_terms || "Not set"}
            />
          </FieldGroup>
        </Card>

        <Card className="px-5 py-5">
          <h2 className="text-lg font-semibold text-copy-primary">Links</h2>
          <div className="mt-4 grid gap-3">
            <LinkedTile
              label="Quote"
              value={order.quote_id ? `Quote #${order.quote_id}` : "No quote"}
              href={
                order.quote_id
                  ? `/dashboard/sales/quotes/${order.quote_id}`
                  : null
              }
            />
            <LinkedTile
              label="Account"
              value={
                order.organization_name ||
                (order.organization_id
                  ? `Account #${order.organization_id}`
                  : "No account")
              }
              href={
                order.organization_id
                  ? `/dashboard/sales/organizations/${order.organization_id}`
                  : null
              }
            />
            <LinkedTile
              label="Contact"
              value={
                order.contact_name ||
                (order.contact_id
                  ? `Contact #${order.contact_id}`
                  : "No contact")
              }
              href={
                order.contact_id
                  ? `/dashboard/sales/contacts/${order.contact_id}`
                  : null
              }
            />
            <LinkedTile
              label="Deal"
              value={
                order.opportunity_name ||
                (order.opportunity_id
                  ? `Deal #${order.opportunity_id}`
                  : "No deal")
              }
              href={
                order.opportunity_id
                  ? `/dashboard/sales/opportunities/${order.opportunity_id}`
                  : null
              }
            />
            <SummaryTile
              label="Owner"
              value={order.owner_name || "Unassigned"}
            />
            {order.delivery_address ? (
              <SummaryTile
                label="Delivery address"
                value={order.delivery_address}
              />
            ) : null}
            {order.notes ? (
              <SummaryTile label="Notes" value={order.notes} />
            ) : null}
          </div>
        </Card>

        <Card className="px-5 py-5 lg:col-span-2">
          <h2 className="text-lg font-semibold text-copy-primary">Items</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-copy-muted">
                <tr>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Qty</th>
                  <th className="py-2 pr-4">Unit</th>
                  <th className="py-2 pr-4">Discount</th>
                  <th className="py-2 pr-4">Tax</th>
                  <th className="py-2 text-right">Line Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-default">
                {(order.items ?? []).map((item) => (
                  <tr key={item.id}>
                    <td className="py-3 pr-4 text-copy-primary">
                      <div>{item.name}</div>
                      {item.description ? (
                        <div className="mt-1 text-xs text-copy-muted">
                          {item.description}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4 tabular-nums text-copy-secondary">
                      {String(item.quantity)}
                    </td>
                    <td className="py-3 pr-4 tabular-nums text-copy-secondary">
                      {formatMoney(item.unit_price, order.currency)}
                    </td>
                    <td className="py-3 pr-4 tabular-nums text-copy-secondary">
                      {formatMoney(item.discount_amount, order.currency)}
                    </td>
                    <td className="py-3 pr-4 tabular-nums text-copy-secondary">
                      {formatMoney(item.tax_amount, order.currency)}
                    </td>
                    <td className="py-3 text-right tabular-nums text-copy-primary">
                      {formatMoney(item.line_total, order.currency)}
                    </td>
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
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-copy-muted">
        {label}
      </div>
      <div className="mt-2 text-sm text-copy-primary">{value}</div>
    </div>
  );
}

function LinkedTile({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href: string | null;
}) {
  return (
    <div className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-copy-muted">
        {label}
      </div>
      <div className="mt-2 text-sm text-copy-primary">
        {href ? (
          <Link href={href} className="hover:underline">
            {value}
          </Link>
        ) : (
          value
        )}
      </div>
    </div>
  );
}
