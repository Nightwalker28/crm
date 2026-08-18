"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Pencil } from "lucide-react";

import CrmRecordActivitySection from "@/components/recordActivity/CrmRecordActivitySection";
import RecordPageHeader from "@/components/recordActivity/RecordPageHeader";
import { InlineFieldEdit } from "@/components/ui/InlineFieldEdit";
import { PageShell } from "@/components/ui/PageShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  RouteErrorState,
  RouteLoadingState,
} from "@/components/ui/RouteStates";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableHeaderRow,
  TableRow,
} from "@/components/ui/Table";
import type { Order } from "@/hooks/sales/useOrders";
import { apiFetch } from "@/lib/api";
import { EMPTY_CELL_VALUE, EMPTY_FIELD_VALUE } from "@/components/ui/EmptyValue";
import { formatDateTime } from "@/lib/datetime";
import { formatMoney } from "@/lib/currency";
import { getOrderStatus } from "@/lib/statusStyles";

const ORDER_STATUS_VALUES = ["draft", "confirmed", "fulfilled", "cancelled"] as const;
const ORDER_STATUS_OPTIONS = ORDER_STATUS_VALUES.map((value) => ({
  value,
  ...getOrderStatus(value),
}));

export default function OrderDetailPage() {
  const params = useParams<{ orderId: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  async function loadOrder(signal?: { cancelled: boolean }) {
    try {
      setLoading(true);
      setLoadError(false);
      const res = await apiFetch(`/sales/orders/${params.orderId}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error("Unable to load order");
      if (signal?.cancelled) return;
      setOrder(body);
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

  async function updateStatus(next: string) {
    if (!order || order.status === next) return;
    const previous = order;
    setOrder({ ...order, status: next });
    try {
      const res = await apiFetch(`/sales/orders/${params.orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) throw new Error("Unable to update order");
      setOrder(body);
    } catch (error) {
      setOrder(previous);
      throw error;
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
    <PageShell
      title={order ? order.order_number : "Order"}
      description="Review order value, linked quote, and fulfillment status."
    >
      <RecordPageHeader
        backHref="/dashboard/sales/orders"
        backLabel="Back to Orders"
        primaryAction={
          <Button asChild variant="outline">
            <Link href={`/dashboard/sales/orders/${params.orderId}/edit`}>
              <Pencil />
              Edit order
            </Link>
          </Button>
        }
      />

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
              <InlineFieldEdit
                fieldLabel="Status"
                value={order.status}
                options={ORDER_STATUS_OPTIONS}
                onCommit={(next) => updateStatus(next.value)}
              />
            </Field>
            <SummaryTile
              label="Total"
              value={formatMoney(order.grand_total, order.currency) ?? EMPTY_FIELD_VALUE}
            />
            <SummaryTile
              label="Subtotal"
              value={formatMoney(order.subtotal, order.currency) ?? EMPTY_FIELD_VALUE}
            />
            <SummaryTile
              label="Tax"
              value={formatMoney(order.tax_total, order.currency) ?? EMPTY_FIELD_VALUE}
            />
            <SummaryTile
              label="Discount"
              value={formatMoney(order.discount_total, order.currency) ?? EMPTY_FIELD_VALUE}
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
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableHeaderRow>
                  <TableHead className="py-2 pr-4">Name</TableHead>
                  <TableHead className="py-2 pr-4">Qty</TableHead>
                  <TableHead className="py-2 pr-4">Unit</TableHead>
                  <TableHead className="py-2 pr-4">Discount</TableHead>
                  <TableHead className="py-2 pr-4">Tax</TableHead>
                  <TableHead className="py-2 text-right">Line Total</TableHead>
                </TableHeaderRow>
              </TableHeader>
              <TableBody>
                {(order.items ?? []).map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="py-3 pr-4 text-copy-primary">
                      <div>{item.name}</div>
                      {item.description ? (
                        <div className="mt-1 text-xs text-copy-muted">
                          {item.description}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="py-3 pr-4 tabular-nums text-copy-secondary">
                      {String(item.quantity)}
                    </TableCell>
                    <TableCell className="py-3 pr-4 tabular-nums text-copy-secondary">
                      {formatMoney(item.unit_price, order.currency) ?? EMPTY_CELL_VALUE}
                    </TableCell>
                    <TableCell className="py-3 pr-4 tabular-nums text-copy-secondary">
                      {formatMoney(item.discount_amount, order.currency) ?? EMPTY_CELL_VALUE}
                    </TableCell>
                    <TableCell className="py-3 pr-4 tabular-nums text-copy-secondary">
                      {formatMoney(item.tax_amount, order.currency) ?? EMPTY_CELL_VALUE}
                    </TableCell>
                    <TableCell className="py-3 text-right tabular-nums text-copy-primary">
                      {formatMoney(item.line_total, order.currency) ?? EMPTY_CELL_VALUE}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
    </PageShell>
  );
}

// An ink group, not a box: a read-only field display is static, so it is not earned by
// interactivity, and it groups rather than separates (design.md 1.3). It sits inside a
// Card already, so a border here is the third container level 1.3 forbids.
function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-copy-label">{label}</div>
      <div className="mt-1 text-sm text-copy-primary">{value}</div>
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
    <div>
      <div className="text-xs font-medium text-copy-label">{label}</div>
      <div className="mt-1 text-sm text-copy-primary">
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
