"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import CrmRecordActivitySection from "@/components/recordActivity/CrmRecordActivitySection";
import RecordPageHeader from "@/components/recordActivity/RecordPageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/button";
import { RouteErrorState, RouteLoadingState, RouteNotFoundState } from "@/components/ui/RouteStates";
import { useInsertionOrder } from "@/hooks/finance/useInsertionOrders";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";
import { getInsertionOrderStatusStyle } from "@/lib/statusStyles";

function formatMoney(amount?: number | null, currency?: string | null) {
  if (amount == null) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

export default function InsertionOrderDetailPage() {
  const params = useParams<{ ioId: string }>();
  const orderQuery = useInsertionOrder(params.ioId);
  const order = orderQuery.data;

  if (orderQuery.isLoading) {
    return <RouteLoadingState label="insertion order" />;
  }

  if (orderQuery.error) {
    return (
      <RouteErrorState
        title="Unable to load insertion order"
        description="This insertion order could not be loaded. Check your connection and try again."
        reset={() => void orderQuery.refetch()}
        backHref="/dashboard/finance/insertion-orders"
        backLabel="Back to insertion orders"
      />
    );
  }

  if (!order) {
    return <RouteNotFoundState recordLabel="Insertion order" backHref="/dashboard/finance/insertion-orders" backLabel="Back to insertion orders" />;
  }

  const status = getInsertionOrderStatusStyle(order.status);

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <RecordPageHeader
        backHref="/dashboard/finance/insertion-orders"
        backLabel="Back to insertion orders"
        title={order.io_number}
        description={order.customer_name || "Finance insertion order"}
        primaryAction={<Button asChild><Link href={`/dashboard/finance/insertion-orders/${order.id}/edit`}>Edit</Link></Button>}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="px-5 py-5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">Insertion Order Details</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <div className="text-xs text-neutral-500">Customer</div>
              <div className="mt-1 text-sm font-medium text-neutral-100">{order.customer_name || "-"}</div>
            </div>
            <div>
              <div className="text-xs text-neutral-500">Reference</div>
              <div className="mt-1 text-sm text-neutral-300">{order.external_reference || order.counterparty_reference || "-"}</div>
            </div>
            <div>
              <div className="text-xs text-neutral-500">Issue Date</div>
              <div className="mt-1 text-sm text-neutral-300">{order.issue_date ? formatDateOnly(order.issue_date) : "-"}</div>
            </div>
            <div>
              <div className="text-xs text-neutral-500">Due Date</div>
              <div className="mt-1 text-sm text-neutral-300">{order.due_date ? formatDateOnly(order.due_date) : "-"}</div>
            </div>
            <div>
              <div className="text-xs text-neutral-500">Start</div>
              <div className="mt-1 text-sm text-neutral-300">{order.start_date ? formatDateOnly(order.start_date) : "-"}</div>
            </div>
            <div>
              <div className="text-xs text-neutral-500">End</div>
              <div className="mt-1 text-sm text-neutral-300">{order.end_date ? formatDateOnly(order.end_date) : "-"}</div>
            </div>
          </div>
          {order.notes ? <p className="mt-5 rounded-md border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-neutral-300">{order.notes}</p> : null}
        </Card>

        <Card className="px-5 py-5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">Commercial Summary</h2>
          <div className="mt-4 space-y-3">
            <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${status.bg} ${status.text} ${status.border}`}>
              {status.label}
            </span>
            <div className="grid gap-2 text-sm">
              <div className="flex justify-between gap-3"><span className="text-neutral-500">Subtotal</span><span>{formatMoney(order.subtotal_amount, order.currency)}</span></div>
              <div className="flex justify-between gap-3"><span className="text-neutral-500">Tax</span><span>{formatMoney(order.tax_amount, order.currency)}</span></div>
              <div className="flex justify-between gap-3 border-t border-neutral-800 pt-2 text-base font-semibold text-neutral-100"><span>Total</span><span>{formatMoney(order.total_amount, order.currency)}</span></div>
            </div>
            {order.updated_at ? <div className="text-xs text-neutral-500">Updated {formatDateTime(order.updated_at)}</div> : null}
          </div>
        </Card>
      </div>

      <CrmRecordActivitySection
        moduleKey="finance_io"
        entityId={order.id}
        recordLabel="Insertion order"
        taskSourceLabel={order.io_number}
      />
    </div>
  );
}
