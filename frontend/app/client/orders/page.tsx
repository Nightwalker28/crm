"use client";

import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListRow, RowList } from "@/components/ui/ListRow";
import { Money } from "@/components/ui/Money";
import { PageShell } from "@/components/ui/PageShell";
import { StatusValue } from "@/components/ui/StatusValue";
import { useClientOrders, type ClientPortalOrder } from "@/hooks/useClientPortal";
import { formatDateTime } from "@/lib/datetime";
import { getClientOrderStatus } from "@/lib/statusStyles";

function firstLine(order: ClientPortalOrder) {
  const line = order.line_items[0];
  if (!line) return "No items";
  return order.line_items.length > 1 ? `${line.name} + ${order.line_items.length - 1} more` : line.name;
}

export default function ClientOrdersPage() {
  const ordersQuery = useClientOrders();
  const orders = ordersQuery.data?.results ?? [];

  return (
    <PageShell
      title="Order history"
      isLoading={ordersQuery.isLoading}
      hasError={Boolean(ordersQuery.error)}
      backHref="/client"
      backLabel="Return to the portal"
      onRetry={() => ordersQuery.refetch()}
    >
      {orders.length === 0 ? (
        <EmptyState
          title="No orders yet"
          description="Orders placed against your account will appear here, with their line items and totals."
        />
      ) : (
        <Card className="p-0">
          <RowList label="Orders" inset>
            {orders.map((order) => (
              <ListRow
                key={order.id}
                title={firstLine(order)}
                href={`/client/orders/${order.id}`}
                meta={`${order.order_number} · ${formatDateTime(order.created_at)}`}
                trailing={
                  <span className="flex items-center gap-3">
                    <StatusValue status={getClientOrderStatus(order.status)} />
                    <Money amount={order.grand_total} currency={order.currency} className="font-medium text-copy-primary" />
                  </span>
                }
              />
            ))}
          </RowList>
        </Card>
      )}
    </PageShell>
  );
}
