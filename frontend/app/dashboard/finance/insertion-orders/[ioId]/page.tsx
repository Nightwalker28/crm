"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { FileDown, Pencil } from "lucide-react";

import RecordDocumentsPanel from "@/components/documents/RecordDocumentsPanel";
import { ReadOnlyRecordLayout } from "@/components/forms/ReadOnlyRecordLayout";
import RecordAuditHistory from "@/components/recordActivity/RecordAuditHistory";
import RecordTasksPanel from "@/components/recordActivity/RecordTasksPanel";
import RecordTimeline from "@/components/recordActivity/RecordTimeline";
import {
  RecordWorkspace,
  useRecordTabHref,
} from "@/components/recordWorkspace/RecordWorkspace";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
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
import { StatusValue } from "@/components/ui/StatusValue";
import { useInsertionOrder, type InsertionOrder } from "@/hooks/finance/useInsertionOrders";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import {
  useResolvedRecordLayout,
  type ResolvedRecordLayout as ResolvedRecordLayoutContract,
} from "@/hooks/useResolvedRecordLayout";
import { apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/currency";
import { formatDateTime } from "@/lib/datetime";
import { getInsertionOrderStatus } from "@/lib/statusStyles";

const IO_STATUS_VALUES = ["draft", "issued", "active", "completed", "cancelled", "imported"] as const;

const IO_STATUS_OPTIONS: InlineFieldEditOption[] = IO_STATUS_VALUES.map((value) => ({
  value,
  ...getInsertionOrderStatus(value),
}));

/**
 * `cancelled` ends the order without completing it, and `imported` is where a spreadsheet
 * row arrives rather than a step an operator moves through — so neither is on the track,
 * the same rule the lead, deal, quote and order tracks follow.
 */
const IO_TRACK_VALUES = ["draft", "issued", "active", "completed"] as const;

const IO_TRACK_STEPS = IO_TRACK_VALUES.map((value) => ({
  id: value,
  label: getInsertionOrderStatus(value).label,
}));

/**
 * Fields `Details` must not draw a second time (design.md §4.7): the header owns the IO
 * number and the customer, and the spine owns the status.
 */
const SPINE_OWNED_FIELDS = ["io_number", "customer_name", "status"] as const;

/** Money fields in the seeded layout, which render through the order's own currency. */
const MONEY_FIELDS = new Set(["subtotal_amount", "tax_amount", "total_amount"]);

/**
 * An import writes a placeholder filename ending `.manual` when there was no real upload,
 * so a truthy `file_url` is not on its own evidence that there is a file to download.
 */
function attachmentHref(order: InsertionOrder) {
  const usable =
    order.file_url && order.file_name && !order.file_name.toLowerCase().endsWith(".manual");
  return usable ? order.file_url : null;
}

export default function InsertionOrderDetailPage() {
  const params = useParams<{ ioId: string }>();
  const queryClient = useQueryClient();
  const { modules } = useAccessibleModules();

  const moduleActions = (moduleKey: string) =>
    modules.find((module) => module.name === moduleKey)?.actions;
  const orderActions = moduleActions("finance_io");
  const taskActions = moduleActions("tasks");
  const documentActions = moduleActions("documents");
  const canEdit = Boolean(orderActions?.can_edit);
  const canViewTasks = Boolean(taskActions?.can_view);
  const canViewDocuments = Boolean(documentActions?.can_view);

  const orderQuery = useInsertionOrder(params.ioId);
  const detailLayoutQuery = useResolvedRecordLayout("finance_io", "detail");

  const order = orderQuery.data ?? null;
  const orderName = order?.io_number || "Insertion order";
  const recordHref = `/dashboard/finance/insertion-orders/${params.ioId}`;
  const editHref = useRecordTabHref(`${recordHref}/edit`);
  const download = order ? attachmentHref(order) : null;

  async function updateStatus(next: string) {
    if (!order || order.status === next) return;
    const res = await apiFetch(`/finance/insertion-orders/${params.ioId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) throw new Error("The insertion order status could not be saved.");
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["insertion-orders"] }),
      queryClient.invalidateQueries({
        queryKey: ["record-audit-history", "finance_io", params.ioId],
      }),
      orderQuery.refetch(),
    ]);
  }

  return (
    <RecordWorkspace
      title={orderName}
      description="Review the insertion order's delivery period, commercial terms, and activity."
      backHref="/dashboard/finance/insertion-orders"
      backLabel="Insertion orders"
      isLoading={orderQuery.isLoading || (!order && !orderQuery.error)}
      hasError={Boolean(orderQuery.error)}
      onRetry={() => void orderQuery.refetch()}
      status={
        order ? (
          <StatusValue status={getInsertionOrderStatus(order.status)} context="record" />
        ) : null
      }
      subtitle={order ? (
        <>
          {order.customer_name ? <span>{order.customer_name}</span> : null}
          {formatMoney(order.total_amount, order.currency) ? (
            <span>{formatMoney(order.total_amount, order.currency)}</span>
          ) : null}
        </>
      ) : null}
      /*
       * No filled button: an insertion order moves forward by changing its status, and the
       * rail owns that field (§4.7). §2.2's one fill is simply unspent.
       */
      actions={order && canEdit ? (
        <Button asChild variant="outline">
          <Link href={editHref}>
            <Pencil />
            Edit
          </Link>
        </Button>
      ) : null}
      /*
       * The source file is a rare action on an imported record rather than a field, so it is
       * in the overflow — and it is rendered only when there is a file, the same rule the
       * quote's `Convert to order` follows (A12).
       */
      overflowActions={download ? (
        <DropdownMenuItem asChild>
          <a href={download}>
            <FileDown />
            Download source file
          </a>
        </DropdownMenuItem>
      ) : undefined}
      spine={
        <RecordSpine>
          {order ? (
            <>
              {IO_TRACK_VALUES.includes(order.status as (typeof IO_TRACK_VALUES)[number]) ? (
                <RecordSpineTrack
                  steps={IO_TRACK_STEPS}
                  currentId={order.status}
                  label="Insertion order lifecycle"
                />
              ) : null}

              <RecordSpineBlock title="State">
                <RecordSpineField label="Status">
                  {canEdit ? (
                    <InlineFieldEdit
                      fieldLabel="Status"
                      value={order.status}
                      options={IO_STATUS_OPTIONS}
                      onCommit={(next) => updateStatus(next.value)}
                    />
                  ) : (
                    <StatusValue status={getInsertionOrderStatus(order.status)} context="record" />
                  )}
                </RecordSpineField>
              </RecordSpineBlock>

              <RecordSpineBlock title="Connected">
                <RecordSpineLink label="Owner" value={order.user_name} />
                {/* One customer, held as either a contact or an account. The account wins
                    where both are set, because that is the party the order is against. */}
                {order.customer_organization_id ? (
                  <RecordSpineLink
                    label="Account"
                    value={order.customer_name}
                    href={`/dashboard/sales/organizations/${order.customer_organization_id}`}
                  />
                ) : (
                  <RecordSpineLink
                    label="Contact"
                    value={order.customer_name}
                    href={order.customer_contact_id ? `/dashboard/sales/contacts/${order.customer_contact_id}` : null}
                  />
                )}
              </RecordSpineBlock>

              <RecordSpineMeta
                createdLabel={order.created_at ? `Created ${formatDateTime(order.created_at)}` : undefined}
                updatedLabel={order.updated_at ? `Updated ${formatDateTime(order.updated_at)}` : undefined}
                history={<RecordAuditHistory moduleKey="finance_io" entityId={order.id} />}
              />
            </>
          ) : null}
        </RecordSpine>
      }
      details={order ? (
        <InsertionOrderOverview
          order={order}
          layout={detailLayoutQuery.data}
          isLayoutLoading={detailLayoutQuery.isLoading}
          layoutError={detailLayoutQuery.error}
          onRetryLayout={() => void detailLayoutQuery.refetch()}
        />
      ) : null}
      timeline={order ? (
        // Note-only: an insertion order has no follow-up endpoint, and inventing channels
        // here would offer the operator buttons that post nowhere.
        <RecordTimeline moduleKey="finance_io" entityId={order.id} canEdit={canEdit} />
      ) : undefined}
      tasks={order && canViewTasks ? (
        <RecordTasksPanel
          moduleKey="finance_io"
          entityId={order.id}
          sourceLabel={orderName}
          canCreate={Boolean(taskActions?.can_create)}
          canEdit={Boolean(taskActions?.can_edit)}
          createActionVariant="outline"
        />
      ) : undefined}
      files={order && canViewDocuments ? (
        <RecordDocumentsPanel
          moduleKey="finance_io"
          entityId={order.id}
          canUpload={Boolean(documentActions?.can_create) && canEdit}
          canEdit={Boolean(documentActions?.can_edit) && canEdit}
          canDelete={Boolean(documentActions?.can_delete) && canEdit}
        />
      ) : undefined}
    />
  );
}

/**
 * `Details` for an insertion order: the resolved layout, and nothing else.
 *
 * The page used to draw three private panels here — a details grid, a commercial summary and
 * a `Custom fields` card. The first two are the layout's `References` / `Dates` / `Totals`
 * sections, and the third is what `_append_detail_custom_fields` merges into the same layout,
 * so the tenant's custom fields now sit beside the system ones instead of below them.
 */
function InsertionOrderOverview({
  order,
  layout,
  isLayoutLoading,
  layoutError,
  onRetryLayout,
}: {
  order: InsertionOrder;
  layout?: ResolvedRecordLayoutContract;
  isLayoutLoading: boolean;
  layoutError: Error | null;
  onRetryLayout: () => void;
}) {
  if (isLayoutLoading || !layout) {
    return (
      <Card className="px-5 py-5">
        {layoutError ? (
          <PanelError
            message="The insertion order details layout could not be loaded."
            onRetry={onRetryLayout}
          />
        ) : (
          <PanelLoading label="Loading insertion order details…" />
        )}
      </Card>
    );
  }

  return (
    <ReadOnlyRecordLayout
      layout={layout}
      values={order as unknown as Record<string, unknown>}
      customValues={order.custom_fields ?? {}}
      omitFieldKeys={SPINE_OWNED_FIELDS}
      renderValue={(field, value) =>
        MONEY_FIELDS.has(field.field_key)
          ? formatMoney(value as string | number | null, order.currency) ?? undefined
          : undefined
      }
    />
  );
}
