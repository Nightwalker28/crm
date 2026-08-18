"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Pencil, ReceiptText } from "lucide-react";

import RecordDocumentsPanel from "@/components/documents/RecordDocumentsPanel";
import { ReadOnlyRecordLayout } from "@/components/forms/ReadOnlyRecordLayout";
import RecordAuditHistory from "@/components/recordActivity/RecordAuditHistory";
import RecordDeleteButton from "@/components/recordActivity/RecordDeleteButton";
import RecordTasksPanel from "@/components/recordActivity/RecordTasksPanel";
import RecordTimeline from "@/components/recordActivity/RecordTimeline";
import {
  RecordWorkspace,
  recordEditHref,
} from "@/components/recordWorkspace/RecordWorkspace";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
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
import {
  usePosInvoice,
  PosInvoiceRequestError,
  type PosInvoice,
} from "@/hooks/finance/usePosInvoices";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import {
  useResolvedRecordLayout,
  type ResolvedRecordLayout as ResolvedRecordLayoutContract,
} from "@/hooks/useResolvedRecordLayout";
import { apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/currency";
import { formatDateTime } from "@/lib/datetime";
import { getPosInvoiceStatus, getPosPaymentStatus } from "@/lib/statusStyles";

const INVOICE_STATUS_VALUES = ["draft", "issued", "paid", "void"] as const;

const INVOICE_STATUS_OPTIONS: InlineFieldEditOption[] = INVOICE_STATUS_VALUES.map((value) => ({
  value,
  ...getPosInvoiceStatus(value),
}));

/** `void` cancels the invoice rather than completing it, so it is an exit, not a step. */
const INVOICE_TRACK_VALUES = ["draft", "issued", "paid"] as const;

const INVOICE_TRACK_STEPS = INVOICE_TRACK_VALUES.map((value) => ({
  id: value,
  label: getPosInvoiceStatus(value).label,
}));

/**
 * Fields `Details` must not draw a second time (design.md §4.7): the header owns the invoice
 * number and the customer, and the rail owns both statuses and the balance.
 */
const SPINE_OWNED_FIELDS = [
  "invoice_number",
  "customer_name",
  "status",
  "payment_status",
  "balance_due",
] as const;

/** Money fields in the seeded layout, which render through the invoice's own currency. */
const MONEY_FIELDS = new Set([
  "subtotal_amount",
  "discount_amount",
  "tax_amount",
  "total_amount",
  "amount_paid",
]);

export default function InvoiceDetailPage() {
  const params = useParams<{ invoiceId: string }>();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { modules } = useAccessibleModules();
  const activeTab = searchParams.get("tab");

  const invoiceId = /^\d+$/.test(params.invoiceId) ? Number(params.invoiceId) : null;
  const query = usePosInvoice(invoiceId);
  const detailLayoutQuery = useResolvedRecordLayout("finance_pos", "detail");

  const moduleActions = (moduleKey: string) =>
    modules.find((module) => module.name === moduleKey)?.actions;
  const invoiceActions = moduleActions("finance_pos");
  const taskActions = moduleActions("tasks");
  const documentActions = moduleActions("documents");
  const canEdit = Boolean(invoiceActions?.can_edit);
  const canDelete = Boolean(invoiceActions?.can_delete);
  const canViewTasks = Boolean(taskActions?.can_view);
  const canCreateTasks = Boolean(taskActions?.can_create);
  const canEditTasks = Boolean(taskActions?.can_edit);
  const canViewDocuments = Boolean(documentActions?.can_view);
  const canCreateDocuments = Boolean(documentActions?.can_create);
  const canEditDocuments = Boolean(documentActions?.can_edit);
  const canDeleteDocuments = Boolean(documentActions?.can_delete);

  const invoice = query.data ?? null;
  const invoiceError = query.error;
  const notFound =
    invoiceId === null
    || (invoiceError instanceof PosInvoiceRequestError && invoiceError.status === 404);
  const invoiceName = invoice?.invoice_number || "Invoice";
  const recordHref = `/dashboard/finance/pos/${params.invoiceId}`;

  async function updateStatus(next: string) {
    if (!invoice || invoice.status === next) return;
    const res = await apiFetch(`/finance/pos-invoices/${invoice.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) throw new Error("The invoice status could not be saved.");
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["pos-invoices"] }),
      queryClient.invalidateQueries({
        queryKey: ["record-audit-history", "finance_pos", String(invoice.id)],
      }),
      query.refetch(),
    ]);
  }

  return (
    <RecordWorkspace
      title={invoiceName}
      description="Review the invoice's balance, line items, terms, and activity."
      backHref="/dashboard/finance/pos"
      backLabel="Invoices"
      isPermissionDenied={
        invoiceError instanceof PosInvoiceRequestError && invoiceError.status === 403
      }
      isLoading={invoiceId !== null && (query.isLoading || (!invoice && !invoiceError))}
      hasError={Boolean(invoiceError) || invoiceId === null}
      onRetry={() => void query.refetch()}
      errorState={notFound ? (
        <RouteNotFoundState
          titleAs="p"
          recordLabel="Invoice"
          backHref="/dashboard/finance/pos"
          backLabel="Back to invoices"
        />
      ) : undefined}
      status={invoice ? <StatusValue status={getPosInvoiceStatus(invoice.status)} context="record" /> : null}
      subtitle={invoice ? (
        <>
          <span>{invoice.customer_name}</span>
          <span>{money(invoice.total_amount, invoice.currency)}</span>
        </>
      ) : null}
      /*
       * No filled button: an invoice moves forward by changing its status, and the rail owns
       * that field (§4.7). `Print` and `Open payments` are neither destructive nor primary,
       * so they sit in the `[⋯]` menu rather than setting a second and third control beside
       * `Edit` — the pre-5.3 header carried all four in a row.
       */
      actions={invoice && canEdit ? (
        <Button asChild variant="outline">
          <Link href={recordEditHref(`${recordHref}/edit`, activeTab)}>
            <Pencil />
            Edit
          </Link>
        </Button>
      ) : null}
      overflowActions={invoice ? (
        <>
          <DropdownMenuItem asChild>
            <Link href={`${recordHref}/print`}>
              <ExternalLink />
              Print
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/dashboard/finance/payments">
              <ReceiptText />
              Open payments
            </Link>
          </DropdownMenuItem>
          {canDelete ? (
            <RecordDeleteButton
              as="menuItem"
              endpoint={`/finance/pos-invoices/${invoice.id}`}
              label="Invoice"
              recordName={invoiceName}
              redirectHref="/dashboard/finance/pos"
              queryKeys={["pos-invoices"]}
            />
          ) : null}
        </>
      ) : null}
      spine={
        <RecordSpine>
          {invoice ? (
            <>
              {INVOICE_TRACK_VALUES.includes(invoice.status as (typeof INVOICE_TRACK_VALUES)[number]) ? (
                <RecordSpineTrack
                  steps={INVOICE_TRACK_STEPS}
                  currentId={invoice.status}
                  label="Invoice lifecycle"
                />
              ) : null}

              <RecordSpineBlock title="State">
                <RecordSpineField label="Status">
                  {canEdit ? (
                    <InlineFieldEdit
                      fieldLabel="Status"
                      value={invoice.status}
                      options={INVOICE_STATUS_OPTIONS}
                      onCommit={(next) => updateStatus(next.value)}
                    />
                  ) : (
                    <StatusValue status={getPosInvoiceStatus(invoice.status)} context="record" />
                  )}
                </RecordSpineField>
                {/*
                  Read-only although it is enum-shaped, which is §4.7's one exception to R2's
                  shape rule: `payment_status` is written by recording a payment, from
                  `amount_paid`. An `InlineFieldEdit` here could say `Paid` over an
                  outstanding balance.
                */}
                <RecordSpineField label="Payment">
                  <StatusValue status={getPosPaymentStatus(invoice.payment_status)} context="record" />
                </RecordSpineField>
                <RecordSpineField label="Balance due">
                  <span className="tabular-nums">
                    {money(invoice.balance_due, invoice.currency)}
                  </span>
                </RecordSpineField>
              </RecordSpineBlock>

              <RecordSpineBlock title="Connected">
                <RecordSpineLink label="Raised by" value={invoice.user_name} />
                <RecordSpineLink
                  label="Contact"
                  value={invoice.customer_contact_name}
                  href={invoice.customer_contact_id ? `/dashboard/sales/contacts/${invoice.customer_contact_id}` : null}
                />
                <RecordSpineLink
                  label="Account"
                  value={invoice.customer_organization_name}
                  href={invoice.customer_organization_id ? `/dashboard/sales/organizations/${invoice.customer_organization_id}` : null}
                />
              </RecordSpineBlock>

              <RecordSpineMeta
                createdLabel={
                  invoice.created_at ? `Created ${formatDateTime(invoice.created_at)}` : undefined
                }
                updatedLabel={
                  invoice.updated_at ? `Updated ${formatDateTime(invoice.updated_at)}` : undefined
                }
                history={<RecordAuditHistory moduleKey="finance_pos" entityId={invoice.id} />}
              />
            </>
          ) : null}
        </RecordSpine>
      }
      details={invoice ? (
        <InvoiceOverview
          invoice={invoice}
          layout={detailLayoutQuery.data}
          isLayoutLoading={detailLayoutQuery.isLoading}
          layoutError={detailLayoutQuery.error}
          onRetryLayout={() => void detailLayoutQuery.refetch()}
        />
      ) : null}
      timeline={invoice ? (
        // Note-only: an invoice has no follow-up endpoint. Chasing payment is a call to the
        // contact, logged on the contact.
        <RecordTimeline moduleKey="finance_pos" entityId={invoice.id} canEdit={canEdit} />
      ) : undefined}
      tasks={invoice && canViewTasks ? (
        <RecordTasksPanel
          moduleKey="finance_pos"
          entityId={invoice.id}
          sourceLabel={invoiceName}
          canCreate={canCreateTasks}
          canEdit={canEditTasks}
          createActionVariant="outline"
        />
      ) : undefined}
      files={invoice && canViewDocuments ? (
        <RecordDocumentsPanel
          moduleKey="finance_pos"
          entityId={invoice.id}
          canUpload={canCreateDocuments && canEdit}
          canEdit={canEditDocuments && canEdit}
          canDelete={canDeleteDocuments && canEdit}
        />
      ) : undefined}
    />
  );
}

/**
 * `Details` for a line-item document: the layout, then the lines, read-only.
 *
 * The pre-5.3 page drew a private `Balance` panel here. Its six rows are the seeded layout's
 * `Totals` section now, and the two figures an operator acts on — payment status and balance
 * due — moved into the rail beside the status they qualify.
 */
function InvoiceOverview({
  invoice,
  layout,
  isLayoutLoading,
  layoutError,
  onRetryLayout,
}: {
  invoice: PosInvoice;
  layout?: ResolvedRecordLayoutContract;
  isLayoutLoading: boolean;
  layoutError: Error | null;
  onRetryLayout: () => void;
}) {
  if (isLayoutLoading || !layout) {
    return (
      <Card className="px-5 py-5">
        {layoutError ? (
          <PanelError message="The invoice details layout could not be loaded." onRetry={onRetryLayout} />
        ) : (
          <PanelLoading label="Loading invoice details…" />
        )}
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <ReadOnlyRecordLayout
        layout={layout}
        values={invoice as unknown as Record<string, unknown>}
        omitFieldKeys={SPINE_OWNED_FIELDS}
        renderValue={(field, value) => {
          if (MONEY_FIELDS.has(field.field_key)) {
            return formatMoney(value as number | null, invoice.currency) ?? undefined;
          }
          if (field.field_key !== "tax_rate") return undefined;
          return value === null || value === undefined || value === "" ? undefined : `${Number(value)}%`;
        }}
      />
      {invoice.lines?.length ? (
        <Card className="px-5 py-5">
          <SectionHeading>Line items</SectionHeading>
          <div className="mt-4 overflow-x-auto">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableHeaderRow>
                  <TableHead className="px-3 py-2">Description</TableHead>
                  <TableHead className="px-3 py-2 text-right">Quantity</TableHead>
                  <TableHead className="px-3 py-2 text-right">Unit price</TableHead>
                  <TableHead className="px-3 py-2 text-right">Total</TableHead>
                </TableHeaderRow>
              </TableHeader>
              <TableBody>
                {invoice.lines.map((line, index) => (
                  <TableRow key={line.id ?? index}>
                    <TableCell className="px-3 py-3 font-medium text-copy-primary">
                      {line.description}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-right tabular-nums text-copy-secondary">
                      {line.quantity}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-right tabular-nums text-copy-secondary">
                      {money(line.unit_price, invoice.currency)}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-right font-medium tabular-nums text-copy-primary">
                      {money(line.line_total ?? line.quantity * line.unit_price, invoice.currency)}
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

// The unknown-code fallback lives in lib/currency.ts now, so this is only the
// null spelling this surface wants (design.md 3.6, 7.1).
function money(amount: number, currency: string) {
  return formatMoney(amount, currency) ?? EMPTY_CELL_VALUE;
}
