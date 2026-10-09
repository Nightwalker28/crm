"use client";

import { ClientPdfButton } from "@/components/client-portal/ClientPdfButton";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListRow, RowList } from "@/components/ui/ListRow";
import { Money } from "@/components/ui/Money";
import { PageShell } from "@/components/ui/PageShell";
import { StatusValue } from "@/components/ui/StatusValue";
import { useClientOrders, type ClientPortalOrder } from "@/hooks/useClientPortal";
import { formatDateTime } from "@/lib/datetime";
import { getClientOrderStatus, getOrderDeliveryStatus } from "@/lib/statusStyles";

function firstLine(order: ClientPortalOrder) {
  const line = order.line_items[0];
  if (!line) return "No items";
  return order.line_items.length > 1 ? `${line.name} + ${order.line_items.length - 1} more` : line.name;
}

function meta(order: ClientPortalOrder) {
  const parts = [order.order_number, formatDateTime(order.created_at)];
  if (order.is_request) parts.push("Requested here");
  if (order.status !== "draft" && order.delivery_status && order.delivery_status !== "none") {
    parts.push(getOrderDeliveryStatus(order.delivery_status).label);
  }
  return parts.join(" · ");
}

/** Every order on the account, and the requests made here (13d §3.7). */
export default function ClientOrdersPage() {
  const ordersQuery = useClientOrders();
  const orders = ordersQuery.data?.results ?? [];

  return (
    <PageShell
      title="Orders"
      description="Your orders with us, and the requests you made here. A request shows as awaiting confirmation until we confirm it."
      isLoading={ordersQuery.isLoading}
      hasError={Boolean(ordersQuery.error)}
      backHref="/client"
      backLabel="Return to the portal"
      onRetry={() => ordersQuery.refetch()}
    >
      {orders.length === 0 ? (
        <EmptyState
          title="No orders yet"
          description="Your orders appear here once we confirm them, with their items, delivery and a PDF copy."
        />
      ) : (
        <Card className="p-0">
          <RowList label="Orders" inset>
            {orders.map((order) => (
              <ListRow
                key={order.id}
                title={firstLine(order)}
                href={`/client/orders/${order.id}`}
                meta={meta(order)}
                trailing={
                  <span className="flex items-center gap-3">
                    <StatusValue status={getClientOrderStatus(order.status)} />
                    <Money amount={order.grand_total} currency={order.currency} className="font-medium text-copy-primary" />
                  </span>
                }
                actions={order.has_document ? <ClientPdfButton kind="orders" id={order.id} name={order.order_number} variant="ghost" size="sm" /> : null}
              />
            ))}
          </RowList>
        </Card>
      )}
    </PageShell>
  );
}
