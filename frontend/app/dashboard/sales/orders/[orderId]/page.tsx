"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";

import RecordDocumentsPanel from "@/components/documents/RecordDocumentsPanel";
import { ReadOnlyRecordLayout } from "@/components/forms/ReadOnlyRecordLayout";
import RecordAuditHistory from "@/components/recordActivity/RecordAuditHistory";
import RecordTasksPanel from "@/components/recordActivity/RecordTasksPanel";
import RecordTimeline from "@/components/recordActivity/RecordTimeline";
import {
  RecordWorkspace,
  recordEditHref,
} from "@/components/recordWorkspace/RecordWorkspace";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { EMPTY_CELL_VALUE } from "@/components/ui/EmptyValue";
import { InlineFieldEdit, type InlineFieldEditOption } from "@/components/ui/InlineFieldEdit";
import { PanelError, PanelLoading } from "@/components/ui/PanelStates";
import {
  RecordSpine,
  RecordSpineBlock,
  RecordSpineField,
  RecordSpineLink,
  RecordSpineMeta,
  RecordSpineTrack,
} from "@/components/ui/RecordSpine";
import { RouteNotFoundState } from "@/components/ui/RouteStates";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusValue } from "@/components/ui/StatusValue";
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
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import {
  useResolvedRecordLayout,
  type ResolvedRecordLayout as ResolvedRecordLayoutContract,
} from "@/hooks/useResolvedRecordLayout";
import { apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/currency";
import { formatDateTime } from "@/lib/datetime";
import { getOrderStatus } from "@/lib/statusStyles";

const ORDER_STATUS_VALUES = ["draft", "confirmed", "fulfilled", "cancelled"] as const;

const ORDER_STATUS_OPTIONS: InlineFieldEditOption[] = ORDER_STATUS_VALUES.map((value) => ({
  value,
  ...getOrderStatus(value),
}));

/** `cancelled` ends the order without fulfilling it, so it is an exit rather than a step. */
const ORDER_TRACK_VALUES = ["draft", "confirmed", "fulfilled"] as const;

const ORDER_TRACK_STEPS = ORDER_TRACK_VALUES.map((value) => ({
  id: value,
  label: getOrderStatus(value).label,
}));

/**
 * Fields `Details` must not draw a second time (design.md §4.7): the header owns the order
 * number, and the spine owns status, owner and every relationship.
 */
const SPINE_OWNED_FIELDS = ["order_number", "status", "owner_id"] as const;

/** Money fields in the seeded layout, which render through the order's own currency. */
const MONEY_FIELDS = new Set(["subtotal", "discount_total", "tax_total", "grand_total"]);

class OrderRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function fetchOrder(orderId: string) {
  const res = await apiFetch(`/sales/orders/${orderId}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new OrderRequestError(body?.detail ?? "We could not load this order.", res.status);
  }
  return body as Order;
}

export default function OrderDetailPage() {
  const params = useParams<{ orderId: string }>();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { modules } = useAccessibleModules();
  const activeTab = searchParams.get("tab");

  const moduleActions = (moduleKey: string) =>
    modules.find((module) => module.name === moduleKey)?.actions;
  const orderActions = moduleActions("sales_orders");
  const taskActions = moduleActions("tasks");
  const documentActions = moduleActions("documents");
  const canEdit = Boolean(orderActions?.can_edit);
  const canViewTasks = Boolean(taskActions?.can_view);
  const canCreateTasks = Boolean(taskActions?.can_create);
  const canEditTasks = Boolean(taskActions?.can_edit);
  const canViewDocuments = Boolean(documentActions?.can_view);
  const canCreateDocuments = Boolean(documentActions?.can_create);
  const canEditDocuments = Boolean(documentActions?.can_edit);
  const canDeleteDocuments = Boolean(documentActions?.can_delete);

  const orderQuery = useQuery({
    queryKey: ["sales-order", params.orderId],
    queryFn: () => fetchOrder(params.orderId),
    enabled: Boolean(params.orderId),
    refetchOnWindowFocus: false,
  });
  const detailLayoutQuery = useResolvedRecordLayout("sales_orders", "detail");

  const order = orderQuery.data ?? null;
  const orderError = orderQuery.error;
  const notFound = orderError instanceof OrderRequestError && orderError.status === 404;
  const orderName = order?.order_number || "Order";
  const recordHref = `/dashboard/sales/orders/${params.orderId}`;
  const orderTotal = order ? formatMoney(order.grand_total, order.currency) : null;

  async function updateStatus(next: string) {
    if (!order || order.status === next) return;
    const res = await apiFetch(`/sales/orders/${params.orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) throw new Error("The order status could not be saved.");
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
      queryClient.invalidateQueries({
        queryKey: ["record-audit-history", "sales_orders", params.orderId],
      }),
      orderQuery.refetch(),
    ]);
  }

  return (
    <RecordWorkspace
      title={orderName}
      description="Review the order's fulfillment status, linked quote, line items, and activity."
      backHref="/dashboard/sales/orders"
      backLabel="Orders"
      isPermissionDenied={orderError instanceof OrderRequestError && orderError.status === 403}
      isLoading={orderQuery.isLoading || (!order && !orderError)}
      hasError={Boolean(orderError)}
      onRetry={() => void orderQuery.refetch()}
      errorState={notFound ? (
        <RouteNotFoundState
          titleAs="p"
          recordLabel="Order"
          backHref="/dashboard/sales/orders"
          backLabel="Back to orders"
        />
      ) : undefined}
      status={order ? <StatusValue status={getOrderStatus(order.status)} context="record" /> : null}
      subtitle={order ? (
        <>
          {order.organization_name || order.contact_name ? (
            <span>{order.organization_name || order.contact_name}</span>
          ) : null}
          {orderTotal ? <span>{orderTotal}</span> : null}
        </>
      ) : null}
      /*
       * No filled button: an order moves forward by changing its status, and the rail owns
       * that field (§4.7). The pre-5.3 page agreed by accident — it shipped `Edit order`
       * alone — and this makes it the archetype rather than an omission.
       */
      actions={order && canEdit ? (
        <Button asChild variant="outline">
          <Link href={recordEditHref(`${recordHref}/edit`, activeTab)}>
            <Pencil />
            Edit
          </Link>
        </Button>
      ) : null}
      spine={
        <RecordSpine>
          {order ? (
            <>
              {ORDER_TRACK_VALUES.includes(order.status as (typeof ORDER_TRACK_VALUES)[number]) ? (
                <RecordSpineTrack
                  steps={ORDER_TRACK_STEPS}
                  currentId={order.status}
                  label="Order lifecycle"
                />
              ) : null}

              <RecordSpineBlock title="State">
                <RecordSpineField label="Status">
                  {canEdit ? (
                    <InlineFieldEdit
                      fieldLabel="Status"
                      value={order.status}
                      options={ORDER_STATUS_OPTIONS}
                      onCommit={(next) => updateStatus(next.value)}
                    />
                  ) : (
                    <StatusValue status={getOrderStatus(order.status)} context="record" />
                  )}
                </RecordSpineField>
              </RecordSpineBlock>

              <RecordSpineBlock title="Connected">
                <RecordSpineLink label="Owner" value={order.owner_name} />
                {/* `Quote #12` until the response started carrying the number — the same
                    response-shape defect the contract rebuild found, in the same place. */}
                <RecordSpineLink
                  label="Quote"
                  value={order.quote_number}
                  href={order.quote_id ? `/dashboard/sales/quotes/${order.quote_id}` : null}
                />
                <RecordSpineLink
                  label="Contact"
                  value={order.contact_name}
                  href={order.contact_id ? `/dashboard/sales/contacts/${order.contact_id}` : null}
                />
                <RecordSpineLink
                  label="Account"
                  value={order.organization_name}
                  href={order.organization_id ? `/dashboard/sales/organizations/${order.organization_id}` : null}
                />
                <RecordSpineLink
                  label="Deal"
                  value={order.opportunity_name}
                  href={order.opportunity_id ? `/dashboard/sales/opportunities/${order.opportunity_id}` : null}
                />
              </RecordSpineBlock>

              <RecordSpineMeta
                createdLabel={`Created ${formatDateTime(order.created_at)}`}
                updatedLabel={`Updated ${formatDateTime(order.updated_at)}`}
                history={<RecordAuditHistory moduleKey="sales_orders" entityId={order.id} />}
              />
            </>
          ) : null}
        </RecordSpine>
      }
      details={order ? (
        <OrderOverview
          order={order}
          layout={detailLayoutQuery.data}
          isLayoutLoading={detailLayoutQuery.isLoading}
          layoutError={detailLayoutQuery.error}
          onRetryLayout={() => void detailLayoutQuery.refetch()}
        />
      ) : null}
      timeline={order ? (
        // Note-only: an order has no follow-up endpoint, and inventing channels here would
        // offer the operator buttons that post nowhere. You call the contact, from the contact.
        <RecordTimeline moduleKey="sales_orders" entityId={order.id} canEdit={canEdit} />
      ) : undefined}
      tasks={order && canViewTasks ? (
        <RecordTasksPanel
          moduleKey="sales_orders"
          entityId={order.id}
          sourceLabel={orderName}
          canCreate={canCreateTasks}
          canEdit={canEditTasks}
          createActionVariant="outline"
        />
      ) : undefined}
      files={order && canViewDocuments ? (
        <RecordDocumentsPanel
          moduleKey="sales_orders"
          entityId={order.id}
          canUpload={canCreateDocuments && canEdit}
          canEdit={canEditDocuments && canEdit}
          canDelete={canDeleteDocuments && canEdit}
        />
      ) : undefined}
    />
  );
}

/**
 * `Details` for a line-item document: the layout, then the items, read-only.
 *
 * Editing is `/[id]/edit` behind a manual save — R1 will not autosave totals derived from
 * lines, discount and tax, and the write is a whole-document call, so an in-place editor
 * would be the edit page rebuilt inside the record page (§4.7).
 */
function OrderOverview({
  order,
  layout,
  isLayoutLoading,
  layoutError,
  onRetryLayout,
}: {
  order: Order;
  layout?: ResolvedRecordLayoutContract;
  isLayoutLoading: boolean;
  layoutError: Error | null;
  onRetryLayout: () => void;
}) {
  if (isLayoutLoading || !layout) {
    return (
      <Card className="px-5 py-5">
        {layoutError ? (
          <PanelError message="The order details layout could not be loaded." onRetry={onRetryLayout} />
        ) : (
          <PanelLoading label="Loading order details…" />
        )}
      </Card>
    );
  }

  const money = (value: string | number | null | undefined) =>
    formatMoney(value, order.currency) ?? EMPTY_CELL_VALUE;

  return (
    <div className="grid gap-4">
      <ReadOnlyRecordLayout
        layout={layout}
        values={order as unknown as Record<string, unknown>}
        omitFieldKeys={SPINE_OWNED_FIELDS}
        renderValue={(field, value) =>
          MONEY_FIELDS.has(field.field_key)
            ? formatMoney(value as string | number | null, order.currency) ?? undefined
            : undefined
        }
      />
      {order.items?.length ? (
        <Card className="px-5 py-5">
          <SectionHeading>Line items</SectionHeading>
          <div className="mt-4 overflow-x-auto">
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableHeaderRow>
                  <TableHead className="px-3 py-2">Item</TableHead>
                  <TableHead className="px-3 py-2 text-right">Quantity</TableHead>
                  <TableHead className="px-3 py-2 text-right">Unit price</TableHead>
                  <TableHead className="px-3 py-2 text-right">Discount</TableHead>
                  <TableHead className="px-3 py-2 text-right">Tax</TableHead>
                  <TableHead className="px-3 py-2 text-right">Total</TableHead>
                </TableHeaderRow>
              </TableHeader>
              <TableBody>
                {order.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="px-3 py-3">
                      <div className="font-medium text-copy-primary">{item.name}</div>
                      {item.description ? (
                        <div className="mt-1 text-xs text-copy-muted">{item.description}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-right tabular-nums text-copy-secondary">
                      {Number(item.quantity)}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-right tabular-nums text-copy-secondary">
                      {money(item.unit_price)}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-right tabular-nums text-copy-secondary">
                      {money(item.discount_amount)}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-right tabular-nums text-copy-secondary">
                      {money(item.tax_amount)}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-right font-medium tabular-nums text-copy-primary">
                      {money(item.line_total)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
