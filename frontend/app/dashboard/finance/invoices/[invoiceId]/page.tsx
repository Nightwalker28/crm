"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Ban, CopyX, CreditCard, Eraser, ExternalLink, FileMinus, Pencil, ReceiptText, Repeat } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import RecordDocumentsPanel from "@/components/documents/RecordDocumentsPanel";
import RecordPaymentDialog from "@/components/finance/payments/RecordPaymentDialog";
import { ReadOnlyRecordLayout } from "@/components/forms/ReadOnlyRecordLayout";
import RecordAuditHistory from "@/components/recordActivity/RecordAuditHistory";
import RecordDeleteButton from "@/components/recordActivity/RecordDeleteButton";
import RecordTasksPanel from "@/components/recordActivity/RecordTasksPanel";
import RecordTimeline from "@/components/recordActivity/RecordTimeline";
import {
  RecordWorkspace,
  useRecordTabHref,
} from "@/components/recordWorkspace/RecordWorkspace";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { EditorPanel } from "@/components/ui/EditorPanel";
import { EMPTY_CELL_VALUE } from "@/components/ui/EmptyValue";
import { Field, FieldLabel } from "@/components/ui/field";
import { Money } from "@/components/ui/Money";
import { PanelError, PanelLoading } from "@/components/ui/PanelStates";
import { RecordTable } from "@/components/ui/RecordTable";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Textarea } from "@/components/ui/textarea";
import { TextLink } from "@/components/ui/TextLink";
import {
  RecordSpine,
  RecordSpineBlock,
  RecordSpineField,
  RecordSpineLink,
  RecordSpineMeta,
  RecordSpineTrack,
} from "@/components/ui/RecordSpine";
import { RouteNotFoundState } from "@/components/ui/RouteStates";
import { StatusValue } from "@/components/ui/StatusValue";
import { DocumentSendAction } from "@/components/transactions/DocumentSendAction";
import { TransactionLineItemsTable } from "@/components/transactions/TransactionLineItemsTable";
import {
  invoiceDisplayNumber,
  useInvoiceActions,
  usePosInvoice,
  PosInvoiceRequestError,
  type PosInvoice,
} from "@/hooks/finance/usePosInvoices";
import { jsonBody, receivablesRequest } from "@/hooks/finance/useReceivables";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useConfirm } from "@/hooks/useConfirm";
import {
  useResolvedRecordLayout,
  type ResolvedRecordLayout as ResolvedRecordLayoutContract,
} from "@/hooks/useResolvedRecordLayout";
import { formatMoney } from "@/lib/currency";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { OVERDUE_STATUS, getCreditNoteStatus, getPaymentRecordStatus, getPosInvoiceStatus, getPosPaymentStatus } from "@/lib/statusStyles";
import { PicklistText } from "@/components/picklists/PicklistText";

/**
 * Draft → issued → paid (12c-erp-invoicing.md §3.3). `Paid` is the payment status reaching
 * paid, not a status of its own; `void` ends the invoice, so it is an exit, not a step.
 */
const INVOICE_TRACK_STEPS = [
  { id: "draft", label: "Draft" },
  { id: "issued", label: "Issued" },
  { id: "paid", label: "Paid" },
];

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
  "amount_credited",
]);

export default function InvoiceDetailPage() {
  const params = useParams<{ invoiceId: string }>();
  const router = useRouter();
  const { modules } = useAccessibleModules();
  const lifecycle = useInvoiceActions();
  const [paying, setPaying] = useState(false);
  const [voidPanel, setVoidPanel] = useState<"void" | "copy" | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidError, setVoidError] = useState<string | null>(null);
  const [writingOff, setWritingOff] = useState(false);
  const [writeOffReason, setWriteOffReason] = useState("");
  const [writeOffError, setWriteOffError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();

  const invoiceId = /^\d+$/.test(params.invoiceId) ? Number(params.invoiceId) : null;
  const query = usePosInvoice(invoiceId);
  const detailLayoutQuery = useResolvedRecordLayout("finance_pos", "detail");

  const moduleActions = (moduleKey: string) =>
    modules.find((module) => module.name === moduleKey)?.actions;
  const invoiceActions = moduleActions("finance_pos");
  const taskActions = moduleActions("tasks");
  const documentActions = moduleActions("documents");
  const canEdit = Boolean(invoiceActions?.can_edit);
  const canCreate = Boolean(invoiceActions?.can_create);
  const canDelete = Boolean(invoiceActions?.can_delete);
  const canRecordPayment = Boolean(moduleActions("finance_payments")?.can_create);
  const canViewPayments = Boolean(moduleActions("finance_payments")?.can_view);
  const canCreateCredit = Boolean(moduleActions("finance_credit_notes")?.can_create);
  const canViewCredits = Boolean(moduleActions("finance_credit_notes")?.can_view);
  const canCreateRecurring = Boolean(moduleActions("finance_recurring_invoices")?.can_create);
  const canViewRecurring = Boolean(moduleActions("finance_recurring_invoices")?.can_view);
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
  const invoiceName = invoice ? invoiceDisplayNumber(invoice) : "Invoice";
  const recordHref = `/dashboard/finance/invoices/${params.invoiceId}`;
  const editHref = useRecordTabHref(`${recordHref}/edit`);

  async function issue() {
    if (!invoice) return;
    try {
      const issued = await lifecycle.issue(invoice.id);
      toast.success(issued.invoice_number ? `Invoice ${issued.invoice_number} issued.` : "Invoice issued.");
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "The invoice could not be issued.");
    }
  }

  async function submitVoid() {
    if (!invoice || !voidPanel) return;
    if (!voidReason.trim()) { setVoidError("Enter a reason."); return; }
    try {
      setVoidError(null);
      if (voidPanel === "copy") {
        const copy = await lifecycle.voidAndCopy({ id: invoice.id, reason: voidReason.trim() });
        toast.success(`${invoiceName} voided; correct the draft copy and issue it.`);
        router.push(`/dashboard/finance/invoices/${copy.id}/edit`);
      } else {
        await lifecycle.voidInvoice({ id: invoice.id, reason: voidReason.trim() });
        toast.success(`${invoiceName} voided.`);
      }
      setVoidPanel(null);
      setVoidReason("");
    } catch (failure) {
      setVoidError(failure instanceof Error ? failure.message : "The invoice could not be voided.");
    }
  }

  /** *Write off balance* (13d §3.6): the open balance, as a tracked adjustment. */
  async function submitWriteOff() {
    if (!invoice) return;
    if (!writeOffReason.trim()) { setWriteOffError("Enter a reason."); return; }
    try {
      setWriteOffError(null);
      await receivablesRequest(`/finance/invoices/${invoice.id}/write-off`, jsonBody("POST", { reason: writeOffReason.trim() }),
        "The balance could not be written off.");
      await Promise.all([query.refetch(), queryClient.invalidateQueries({ queryKey: ["pos-invoices"] })]);
      toast.success(`${invoiceName}: balance written off.`);
      setWritingOff(false);
      setWriteOffReason("");
    } catch (failure) {
      setWriteOffError(failure instanceof Error ? failure.message : "The balance could not be written off.");
    }
  }

  async function reverseWriteOff(writeOffId: number) {
    if (!invoice) return;
    const ok = await confirm({
      title: "Reverse this write-off?",
      description: "The amount is owed again and the invoice reopens. Payment reminders can be sent for it again.",
      confirmLabel: "Reverse write-off",
    });
    if (!ok) return;
    try {
      await receivablesRequest(`/finance/invoices/${invoice.id}/write-offs/${writeOffId}`, { method: "DELETE" }, "The write-off could not be reversed.");
      await Promise.all([query.refetch(), queryClient.invalidateQueries({ queryKey: ["pos-invoices"] })]);
      toast.success("Write-off reversed.");
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "The write-off could not be reversed.");
    }
  }

  const issued = invoice?.status === "issued";
  const isDraft = invoice?.status === "draft";
  const owing = issued && (invoice?.balance_due ?? 0) > 0;
  const hasMoney = Boolean(invoice?.payments?.some((payment) => payment.status === "posted"))
    || Boolean(invoice?.credit_notes?.some((note) => note.status !== "void"))
    || Boolean(invoice?.write_offs?.length);
  // Anyone who edits invoices may write off up to the company's limit; above it, finance admins.
  const canWriteOff = owing && canEdit && Boolean(invoice)
    && ((invoice?.balance_due ?? 0) <= (invoice?.write_off_limit ?? 0) || Boolean(invoice?.can_write_off_any));
  const trackId = invoice ? (invoice.status === "issued" && invoice.payment_status === "paid" ? "paid" : invoice.status) : "draft";

  return (
    <>
    <RecordWorkspace
      title={invoiceName}
      description="Review the invoice's balance, line items, terms, and activity."
      backHref="/dashboard/finance/invoices"
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
          backHref="/dashboard/finance/invoices"
          backLabel="Back to invoices"
        />
      ) : undefined}
      status={invoice ? <StatusValue status={invoice.is_overdue ? OVERDUE_STATUS : getPosInvoiceStatus(invoice.status)} context="record" /> : null}
      subtitle={invoice ? (
        <>
          <span>{invoice.customer_name}</span>
          <span>{money(invoice.total_amount, invoice.currency)}</span>
        </>
      ) : null}
      /*
       * One filled button, the invoice's next step (§2.2): *Issue* on a draft, *Record payment*
       * while a balance is due. Credit, void and print are in the `[⋯]` menu.
       */
      actions={invoice ? (
        <div className="flex flex-wrap gap-2">
          {isDraft && canEdit ? <Button onClick={() => void issue()} disabled={lifecycle.isSaving}>Issue invoice</Button> : null}
          {owing && canRecordPayment ? <Button onClick={() => setPaying(true)}><CreditCard />Record payment</Button> : null}
          {issued ? <DocumentSendAction moduleKey="finance_pos" recordId={invoice.id} /> : null}
          {(isDraft || issued) && canEdit ? (
            <Button asChild variant="outline">
              <Link href={editHref}>
                <Pencil />
                Edit
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}
      overflowActions={invoice ? (
        <>
          <DropdownMenuItem asChild>
            <Link href={`${recordHref}/print`}>
              <ExternalLink />
              Preview and PDF
            </Link>
          </DropdownMenuItem>
          {issued && canCreateCredit ? (
            <DropdownMenuItem asChild>
              <Link href={`${DASHBOARD_ROUTES.creditNotes}/new?invoice_id=${invoice.id}`}>
                <FileMinus />
                Create credit note
              </Link>
            </DropdownMenuItem>
          ) : null}
          {canWriteOff ? (
            <DropdownMenuItem onSelect={() => { setWriteOffError(null); setWritingOff(true); }}>
              <Eraser />
              Write off balance
            </DropdownMenuItem>
          ) : null}
          {canCreateRecurring && invoice.status !== "void" ? (
            <DropdownMenuItem asChild>
              <Link href={`${DASHBOARD_ROUTES.recurringInvoices}/new?from_invoice=${invoice.id}`}>
                <Repeat />
                Make recurring
              </Link>
            </DropdownMenuItem>
          ) : null}
          {issued && canEdit && !hasMoney ? (
            <>
              <DropdownMenuItem onSelect={() => { setVoidError(null); setVoidPanel("void"); }}>
                <Ban />
                Void invoice
              </DropdownMenuItem>
              {canCreate ? (
                <DropdownMenuItem onSelect={() => { setVoidError(null); setVoidPanel("copy"); }}>
                  <CopyX />
                  Void and correct
                </DropdownMenuItem>
              ) : null}
            </>
          ) : null}
          <DropdownMenuItem asChild>
            <Link href="/dashboard/finance/payments">
              <ReceiptText />
              Open payments
            </Link>
          </DropdownMenuItem>
          {isDraft && canDelete ? (
            <RecordDeleteButton
              as="menuItem"
              endpoint={`/finance/invoices/${invoice.id}`}
              label="Invoice"
              recordName={invoiceName}
              redirectHref="/dashboard/finance/invoices"
              queryKeys={["pos-invoices"]}
            />
          ) : null}
        </>
      ) : null}
      spine={
        <RecordSpine>
          {invoice ? (
            <>
              {invoice.status !== "void" ? (
                <RecordSpineTrack
                  steps={INVOICE_TRACK_STEPS}
                  currentId={trackId}
                  label="Invoice lifecycle"
                />
              ) : null}

              <RecordSpineBlock title="State">
                {/*
                  Both read-only (§4.7): the status moves by its actions (Issue, Void), and the
                  payment status is derived from payments and credit notes (12c §3.2).
                */}
                <RecordSpineField label="Status">
                  <StatusValue status={getPosInvoiceStatus(invoice.status)} context="record" />
                </RecordSpineField>
                {issued ? (
                  <RecordSpineField label="Payment">
                    <StatusValue status={invoice.is_overdue ? OVERDUE_STATUS : getPosPaymentStatus(invoice.payment_status)} context="record" />
                  </RecordSpineField>
                ) : null}
                <RecordSpineField label="Total">
                  <span className="tabular-nums">{money(invoice.total_amount, invoice.currency)}</span>
                </RecordSpineField>
                {issued && (invoice.amount_credited ?? 0) > 0 ? (
                  <RecordSpineField label="Credited">
                    <span className="tabular-nums">{money(invoice.amount_credited ?? 0, invoice.currency)}</span>
                  </RecordSpineField>
                ) : null}
                {issued && (invoice.amount_written_off ?? 0) > 0 ? (
                  <RecordSpineField label="Written off">
                    <span className="tabular-nums">{money(invoice.amount_written_off ?? 0, invoice.currency)}</span>
                  </RecordSpineField>
                ) : null}
                {issued ? (
                  <RecordSpineField label="Paid">
                    <span className="tabular-nums">{money(invoice.amount_paid, invoice.currency)}</span>
                  </RecordSpineField>
                ) : null}
                {issued ? (
                  <RecordSpineField label="Balance due">
                    <span className="tabular-nums">
                      {money(invoice.balance_due, invoice.currency)}
                    </span>
                  </RecordSpineField>
                ) : null}
                {invoice.void_reason ? (
                  <RecordSpineField label="Voided because">{invoice.void_reason}</RecordSpineField>
                ) : null}
              </RecordSpineBlock>

              <RecordSpineBlock title="Connected">
                <RecordSpineLink label="Raised by" value={invoice.user_name} />
                {invoice.recurring_invoice_id ? (
                  <RecordSpineLink
                    label="Recurring invoice"
                    value={invoice.recurring_invoice_name ?? "Recurring invoice"}
                    href={canViewRecurring ? `${DASHBOARD_ROUTES.recurringInvoices}/${invoice.recurring_invoice_id}` : null}
                  />
                ) : null}
                <RecordSpineLink
                  label="Order"
                  value={invoice.sales_order_number ?? null}
                  href={invoice.sales_order_id ? `/dashboard/sales/orders/${invoice.sales_order_id}?tab=invoicing` : null}
                />
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
          showPayments={canViewPayments}
          showCredits={canViewCredits}
          onReverseWriteOff={invoice.can_write_off_any ? (id) => void reverseWriteOff(id) : undefined}
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
    <RecordPaymentDialog
      key={paying ? `pay-${invoice?.id}-${invoice?.balance_due}` : "closed"}
      open={paying}
      invoice={invoice}
      isSubmitting={lifecycle.isSaving}
      onClose={() => setPaying(false)}
      onSubmit={async (payload) => {
        if (!invoice) return;
        await lifecycle.recordPayment({ id: invoice.id, payload });
        toast.success("Payment recorded.");
      }}
    />
    <EditorPanel
      open={voidPanel !== null}
      onOpenChange={(open) => { if (!open) setVoidPanel(null); }}
      title={voidPanel === "copy" ? `Void and correct ${invoiceName}` : `Void ${invoiceName}`}
      description={voidPanel === "copy"
        ? "The invoice stays on record as void, and a draft copy opens for you to correct and issue under a new number."
        : "The invoice stays on record as void and no longer counts as owed. Use a credit note instead once money has been received."}
      closeLabel="Close panel"
      onSubmit={() => void submitVoid()}
      status={voidError ? <span role="alert">{voidError}</span> : null}
      footer={<><Button variant="outline" onClick={() => setVoidPanel(null)}>Back</Button><Button type="submit" variant="destructive" disabled={lifecycle.isSaving}>{voidPanel === "copy" ? "Void and copy" : "Void invoice"}</Button></>}
    >
      <Field><FieldLabel htmlFor="invoice-void-reason">Reason</FieldLabel><Textarea id="invoice-void-reason" maxLength={500} value={voidReason} onChange={(event) => setVoidReason(event.target.value)} /></Field>
    </EditorPanel>
    <EditorPanel
      open={writingOff}
      onOpenChange={(open) => { if (!open) setWritingOff(false); }}
      title={`Write off ${invoiceName}`}
      description={invoice
        ? `${money(invoice.balance_due, invoice.currency)} stops being owed and the invoice reads Paid. The write-off stays on the invoice and can be reversed by a finance administrator.`
        : ""}
      closeLabel="Close panel"
      onSubmit={() => void submitWriteOff()}
      status={writeOffError ? <span role="alert">{writeOffError}</span> : null}
      footer={<><Button variant="outline" onClick={() => setWritingOff(false)}>Back</Button><Button type="submit" variant="destructive">Write off balance</Button></>}
    >
      <Field><FieldLabel htmlFor="invoice-write-off-reason">Reason</FieldLabel><Textarea id="invoice-write-off-reason" maxLength={500} value={writeOffReason} placeholder="Bank charges, a small short payment, an uncollectable debt" onChange={(event) => setWriteOffReason(event.target.value)} /></Field>
    </EditorPanel>
    </>
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
  showPayments,
  showCredits,
  onReverseWriteOff,
}: {
  invoice: PosInvoice;
  layout?: ResolvedRecordLayoutContract;
  isLayoutLoading: boolean;
  layoutError: Error | null;
  onRetryLayout: () => void;
  showPayments: boolean;
  showCredits: boolean;
  onReverseWriteOff?: (writeOffId: number) => void;
}) {
  if (isLayoutLoading || !layout) {
    return (
      <Card className="p-6">
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
        customValues={invoice.custom_fields ?? undefined}
        omitFieldKeys={SPINE_OWNED_FIELDS}
        renderValue={(field, value) => {
          if (MONEY_FIELDS.has(field.field_key)) {
            return formatMoney(value as number | null, invoice.currency) ?? undefined;
          }
          return undefined;
        }}
      />
      {invoice.lines?.length ? (
        <TransactionLineItemsTable
          items={invoice.lines.map((line, index) => ({
            id: line.id ?? index,
            name: line.description,
            quantity: line.quantity,
            unit_price: line.unit_price,
            discount_amount: line.discount_amount ?? 0,
            tax_amount: line.tax_amount ?? 0,
            line_total: line.line_total ?? line.quantity * line.unit_price,
            catalog_product_id: line.catalog_product_id,
            catalog_service_id: line.catalog_service_id, line_type: line.line_type, unit: line.unit,
          }))}
          currency={invoice.currency}
          itemLabel="Description"
          linkCatalogItems
          taxSummary={invoice.tax_summary}
          taxInclusive={invoice.tax_mode === "inclusive"}
        />
      ) : null}
      {showPayments && invoice.status !== "draft" ? (
        <section className="flex flex-col gap-3">
          <SectionHeading>Payments</SectionHeading>
          <RecordTable
            variant="readOnly"
            label="Payments on this invoice"
            rows={invoice.payments ?? []}
            rowKey={(row) => row.id}
            rowHref={(row) => `${DASHBOARD_ROUTES.payments}/${row.id}`}
            emptyState={{ title: "No payments yet" }}
            columns={[
              { key: "number", label: "Number", size: "sm", render: (row) => <span className="font-semibold text-copy-primary">{row.number}</span> },
              { key: "paid_on", label: "Paid on", size: "sm", render: (row) => formatDateOnly(row.paid_on) },
              { key: "method", label: "Method", size: "sm", render: (row) => <PicklistText listKey="payment_method" value={row.method} /> },
              { key: "reference", label: "Reference", size: "md", render: (row) => row.reference ?? "—" },
              { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getPaymentRecordStatus(row.status)} /> },
              { key: "amount", label: "Amount", size: "sm", align: "right", render: (row) => <Money amount={row.allocations.find((allocation) => allocation.document_type === "invoice" && allocation.document_id === invoice.id)?.amount ?? row.amount} currency={invoice.currency} /> },
            ]}
          />
        </section>
      ) : null}
      {showCredits && (invoice.credit_notes?.length ?? 0) > 0 ? (
        <section className="flex flex-col gap-3">
          <SectionHeading>Credit notes</SectionHeading>
          <RecordTable
            variant="readOnly"
            label="Credit notes against this invoice"
            rows={invoice.credit_notes ?? []}
            rowKey={(row) => row.id}
            rowHref={(row) => `${DASHBOARD_ROUTES.creditNotes}/${row.id}`}
            emptyState={{ title: "No credit notes" }}
            columns={[
              { key: "number", label: "Number", size: "sm", rendersLink: true, render: (row) => <TextLink href={`${DASHBOARD_ROUTES.creditNotes}/${row.id}`}>{row.number ?? "Draft"}</TextLink> },
              { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getCreditNoteStatus(row.status)} /> },
              { key: "issue_date", label: "Issued", size: "sm", render: (row) => (row.issue_date ? formatDateOnly(row.issue_date) : "—") },
              { key: "reason", label: "Reason", size: "lg", render: (row) => row.reason ?? "—" },
              { key: "total", label: "Amount", size: "sm", align: "right", render: (row) => <Money amount={row.total_amount} currency={row.currency} /> },
            ]}
          />
        </section>
      ) : null}
      {(invoice.write_offs?.length ?? 0) > 0 ? (
        <section className="flex flex-col gap-3">
          <SectionHeading>Write-offs</SectionHeading>
          <RecordTable
            variant="readOnly"
            label="Balances written off this invoice"
            rows={invoice.write_offs ?? []}
            rowKey={(row) => row.id}
            emptyState={{ title: "No write-offs" }}
            columns={[
              { key: "created_at", label: "Date", size: "sm", render: (row) => formatDateOnly(row.created_at) },
              { key: "reason", label: "Reason", size: "lg", render: (row) => row.reason },
              { key: "by", label: "By", size: "md", render: (row) => row.created_by_name ?? "—" },
              { key: "amount", label: "Amount", size: "sm", align: "right", render: (row) => <Money amount={row.amount} currency={invoice.currency} /> },
              ...(onReverseWriteOff ? [{ key: "reverse", label: <span className="sr-only">Actions</span>, size: "sm" as const, align: "right" as const, interactive: true,
                render: (row: NonNullable<PosInvoice["write_offs"]>[number]) => (
                  <Button variant="ghost" size="sm" onClick={() => onReverseWriteOff(row.id)}>Reverse</Button>
                ) }] : []),
            ]}
          />
        </section>
      ) : null}
      {(invoice.reminders?.length ?? 0) > 0 ? (
        <section className="flex flex-col gap-3">
          <SectionHeading>Payment reminders</SectionHeading>
          <RecordTable
            variant="readOnly"
            label="Payment reminders for this invoice"
            rows={invoice.reminders ?? []}
            rowKey={(row) => `${row.rule_name}-${row.sent_at}`}
            emptyState={{ title: "No reminders sent" }}
            columns={[
              { key: "sent_at", label: "Date", size: "sm", render: (row) => formatDateTime(row.sent_at) },
              { key: "rule_name", label: "Reminder", size: "md", render: (row) => row.rule_name },
              { key: "recipient", label: "To", size: "md", render: (row) => (row.outcome === "sent" ? row.recipient ?? "—" : `Not sent: ${row.detail ?? "no address"}`) },
            ]}
          />
        </section>
      ) : null}
    </div>
  );
}

// The unknown-code fallback lives in lib/currency.ts now, so this is only the
// null spelling this surface wants (design.md 3.6, 7.1).
function money(amount: number, currency: string) {
  return formatMoney(amount, currency) ?? EMPTY_CELL_VALUE;
}
