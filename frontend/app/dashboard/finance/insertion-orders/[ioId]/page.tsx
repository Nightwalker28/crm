"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FileDown, Pencil } from "lucide-react";

import CrmRecordActivitySection from "@/components/recordActivity/CrmRecordActivitySection";
import RecordPageHeader from "@/components/recordActivity/RecordPageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/Pill";
import { RouteErrorState, RouteLoadingState, RouteNotFoundState } from "@/components/ui/RouteStates";
import { useInsertionOrder } from "@/hooks/finance/useInsertionOrders";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";
import { getInsertionOrderStatusStyle } from "@/lib/statusStyles";

function formatMoney(amount?: number | null, currency?: string | null) {
  if (amount == null) return "Not set";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

export default function InsertionOrderDetailPage() {
  const params = useParams<{ ioId: string }>();
  const { modules } = useAccessibleModules();
  const orderQuery = useInsertionOrder(params.ioId);
  const order = orderQuery.data;
  const canEdit = Boolean(modules.find((module) => module.name === "finance_io")?.actions?.can_edit);

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
  const customerHref = order.customer_organization_id
    ? `/dashboard/sales/organizations/${order.customer_organization_id}`
    : order.customer_contact_id
      ? `/dashboard/sales/contacts/${order.customer_contact_id}`
      : null;
  const customFields = Object.entries(order.custom_fields ?? {}).filter(([, value]) => value !== null && value !== undefined && value !== "");
  const attachmentAvailable = Boolean(
    order.file_url
    && order.file_name
    && !order.file_name.toLowerCase().endsWith(".manual"),
  );

  return (
    <div className="flex flex-col gap-6">
      <RecordPageHeader
        backHref="/dashboard/finance/insertion-orders"
        backLabel="Back to insertion orders"
        title={order.io_number}
        description={order.customer_name || "Finance insertion order"}
        primaryAction={canEdit ? (
          <Button asChild>
            <Link href={`/dashboard/finance/insertion-orders/${order.id}/edit`}><Pencil />Edit insertion order</Link>
          </Button>
        ) : undefined}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card role="region" aria-labelledby="insertion-order-details-heading">
          <CardHeader>
            <div>
              <h2 id="insertion-order-details-heading" className="text-lg font-semibold text-copy-primary">Insertion order details</h2>
              <p className="mt-1 text-sm text-copy-muted">Customer references, delivery period, and ownership.</p>
            </div>
          </CardHeader>
          <CardBody>
            <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
              <DetailField label="Customer" value={order.customer_name || "Not set"} href={customerHref} />
              <DetailField label="External reference" value={order.external_reference || "Not set"} />
              <DetailField label="Counterparty reference" value={order.counterparty_reference || "Not set"} />
              <DetailField label="Assigned to" value={order.user_name || "Unassigned"} />
              <DetailField label="Issue date" value={formatOptionalDate(order.issue_date)} />
              <DetailField label="Effective date" value={formatOptionalDate(order.effective_date)} />
              <DetailField label="Due date" value={formatOptionalDate(order.due_date)} />
              <DetailField label="Start date" value={formatOptionalDate(order.start_date)} />
              <DetailField label="End date" value={formatOptionalDate(order.end_date)} />
            </dl>
            {order.notes ? (
              <div className="mt-6 border-t border-line-subtle pt-5">
                <h3 className="text-xs font-medium text-copy-label">Notes</h3>
                <p className="mt-2 whitespace-pre-wrap rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-4 py-3 text-p-sm text-copy-secondary">
                  {order.notes}
                </p>
              </div>
            ) : null}
          </CardBody>
        </Card>

        <div className="grid content-start gap-6">
          <Card role="region" aria-labelledby="insertion-order-commercial-heading">
            <CardHeader>
              <div>
                <h2 id="insertion-order-commercial-heading" className="text-lg font-semibold text-copy-primary">Commercial summary</h2>
                <p className="mt-1 text-sm text-copy-muted">Current status and order value.</p>
              </div>
              <Pill bg={status.bg} text={status.text} border={status.border}>{status.label}</Pill>
            </CardHeader>
            <CardBody>
              <dl className="grid gap-3 text-sm">
                <MoneyRow label="Subtotal" value={formatMoney(order.subtotal_amount, order.currency)} />
                <MoneyRow label="Tax" value={formatMoney(order.tax_amount, order.currency)} />
                <MoneyRow label="Total" value={formatMoney(order.total_amount, order.currency)} total />
              </dl>
              {order.updated_at ? <p className="mt-4 text-xs text-copy-muted">Updated {formatDateTime(order.updated_at)}</p> : null}
            </CardBody>
          </Card>

          {attachmentAvailable ? (
            <Card role="region" aria-labelledby="insertion-order-attachment-heading">
              <CardHeader>
                <div>
                  <h2 id="insertion-order-attachment-heading" className="text-lg font-semibold text-copy-primary">Attachment</h2>
                  <p className="mt-1 text-sm text-copy-muted">Original imported order file.</p>
                </div>
              </CardHeader>
              <CardBody className="pt-4">
                <Button asChild variant="outline" className="w-full justify-start">
                  <a href={order.file_url ?? undefined}>
                    <FileDown />
                    <span className="truncate">{order.file_name}</span>
                  </a>
                </Button>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>

      {customFields.length ? (
        <Card role="region" aria-labelledby="insertion-order-custom-fields-heading">
          <CardHeader>
            <div>
              <h2 id="insertion-order-custom-fields-heading" className="text-lg font-semibold text-copy-primary">Custom fields</h2>
              <p className="mt-1 text-sm text-copy-muted">Tenant-defined information recorded for this order.</p>
            </div>
          </CardHeader>
          <CardBody>
            <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
              {customFields.map(([key, value]) => (
                <DetailField key={key} label={readableLabel(key)} value={formatCustomFieldValue(value)} />
              ))}
            </dl>
          </CardBody>
        </Card>
      ) : null}

      <CrmRecordActivitySection
        moduleKey="finance_io"
        entityId={order.id}
        recordLabel="Insertion order"
        taskSourceLabel={order.io_number}
      />
    </div>
  );
}

function formatOptionalDate(value?: string | null) {
  return value ? formatDateOnly(value) : "Not set";
}

function readableLabel(value: string) {
  return value.replace(/^custom:/, "").replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatCustomFieldValue(value: unknown) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const values = value.filter((entry) => typeof entry === "string" || typeof entry === "number");
    return values.length ? values.join(", ") : "Recorded";
  }
  return "Recorded";
}

function DetailField({ label, value, href }: { label: string; value: string; href?: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium text-copy-label">{label}</dt>
      <dd className="mt-1 text-sm text-copy-primary">
        {href ? (
          <Link href={href} className="rounded-[var(--radius-control-sm)] text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {value}
          </Link>
        ) : value}
      </dd>
    </div>
  );
}

function MoneyRow({ label, value, total = false }: { label: string; value: string; total?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${total ? "border-t border-line-subtle pt-3 text-base font-semibold text-copy-primary" : "text-copy-secondary"}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
