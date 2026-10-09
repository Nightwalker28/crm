"use client";

import { useParams } from "next/navigation";

import { ClientPdfButton } from "@/components/client-portal/ClientPdfButton";
import { RecordWorkspace } from "@/components/recordWorkspace/RecordWorkspace";
import { TransactionLineItemsTable } from "@/components/transactions/TransactionLineItemsTable";
import { Money } from "@/components/ui/Money";
import { StatusValue } from "@/components/ui/StatusValue";
import { useClientOrder } from "@/hooks/useClientPortal";
import { formatDateTime } from "@/lib/datetime";
import { getClientOrderStatus, getOrderDeliveryStatus } from "@/lib/statusStyles";

export default function ClientOrderDetailPage() {
  const params = useParams();
  const orderId = String(params.orderId ?? "");
  const orderQuery = useClientOrder(orderId);
  const order = orderQuery.data;

  return (
    // Archetype 2, read-only (§4.7): no `spine`. Nothing on a portal order edits in place,
    // so the rail would be 20rem of read-only fields.
    <RecordWorkspace
      title={order?.order_number ?? "Order"}
      description={order?.notes ? `Your note: ${order.notes}` : order?.status === "draft"
        ? "We have your request and will confirm it shortly."
        : "The order's items and total."}
      backHref="/client/orders"
      backLabel="Orders"
      isLoading={orderQuery.isLoading}
      hasError={Boolean(orderQuery.error) || (!orderQuery.isLoading && !order)}
      onRetry={() => void orderQuery.refetch()}
      status={order ? <StatusValue status={getClientOrderStatus(order.status)} context="record" /> : null}
      actions={order?.has_document ? <ClientPdfButton kind="orders" id={order.id} name={order.order_number} /> : null}
      subtitle={
        order ? (
          <>
            <Money amount={order.grand_total} currency={order.currency} />
            <span>Placed {formatDateTime(order.created_at)}</span>
            {order.status !== "draft" && order.delivery_status && order.delivery_status !== "none"
              ? <span>{getOrderDeliveryStatus(order.delivery_status).label}</span> : null}
          </>
        ) : null
      }
      details={
        order ? (
          // The same table the quote, order and POS invoice already share — R10, and the
          // reason this page no longer holds a raw `Table`.
          <TransactionLineItemsTable
            items={order.line_items.map((line) => ({
              id: line.id,
              name: line.name,
              quantity: line.quantity,
              unit_price: line.unit_price,
              line_total: line.line_total,
            }))}
            currency={order.currency}
            showAdjustments={false}
          />
        ) : null
      }
    />
  );
}
