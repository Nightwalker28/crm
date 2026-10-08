"use client";

import { useState } from "react";
import { toast } from "sonner";

import { DocumentDetailHeader } from "@/components/transactions/DocumentLayoutHeader";
import { Button } from "@/components/ui/button";
import { EditorPanel } from "@/components/ui/EditorPanel";
import { Fact, FactList } from "@/components/ui/Fact";
import { Field, FieldLabel } from "@/components/ui/field";
import { Money } from "@/components/ui/Money";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable } from "@/components/ui/RecordTable";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusValue } from "@/components/ui/StatusValue";
import { Textarea } from "@/components/ui/textarea";
import { TextLink } from "@/components/ui/TextLink";
import { useFinanceDocumentActions, usePayment } from "@/hooks/finance/useFinanceDocuments";
import type { PaymentAllocation } from "@/hooks/finance/usePosInvoices";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { isForbiddenError } from "@/lib/api";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { getPaymentRecordStatus } from "@/lib/statusStyles";
import { DocumentHistory } from "@/components/recordActivity/DocumentHistory";

function documentHref(allocation: PaymentAllocation) {
  if (allocation.document_type === "invoice") return `${DASHBOARD_ROUTES.invoices}/${allocation.document_id}`;
  if (allocation.document_type === "credit_note") return `${DASHBOARD_ROUTES.creditNotes}/${allocation.document_id}`;
  if (allocation.document_type === "vendor_credit") return `${DASHBOARD_ROUTES.vendorCredits}/${allocation.document_id}`;
  return `${DASHBOARD_ROUTES.purchaseBills}/${allocation.document_id}`;
}

/**
 * One payment (12c-erp-invoicing.md §3.5). A payment is never edited or removed: a wrong one
 * is voided, which gives the documents it settled their balance back.
 */
export function PaymentRecordPage({ paymentId }: { paymentId: number | null }) {
  const { modules } = useAccessibleModules();
  const canEdit = Boolean(modules.find((module) => module.name === "finance_payments")?.actions?.can_edit);
  const query = usePayment(paymentId);
  const payment = query.data;
  const { voidPayment, isSaving } = useFinanceDocumentActions();
  const [voidOpen, setVoidOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submitVoid() {
    if (!payment) return;
    if (!reason.trim()) { setError("Enter a reason."); return; }
    try {
      setError(null);
      await voidPayment({ id: payment.id, reason: reason.trim() });
      toast.success(`${payment.number} voided; the balance is due again.`);
      setVoidOpen(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The payment could not be voided."); }
  }

  const what = payment ? (payment.kind === "refund" ? "Refund" : payment.direction === "received" ? "Payment received" : "Payment made") : "Payment";

  return (
    <PageShell
      variant="document"
      title={payment ? `${what} ${payment.number}` : "Payment"}
      description={payment ? [payment.party_name, `Paid on ${formatDateOnly(payment.paid_on)}`].filter(Boolean).join(" · ") : undefined}
      backHref={DASHBOARD_ROUTES.payments}
      isLoading={query.isLoading}
      isPermissionDenied={isForbiddenError(query.error)}
      hasError={(Boolean(query.error) && !isForbiddenError(query.error)) || paymentId === null}
      onRetry={() => void query.refetch()}
      actions={payment ? (
        <div className="flex flex-wrap gap-2">
          <StatusValue status={getPaymentRecordStatus(payment.status)} context="record" />
          {payment.status === "posted" && canEdit ? <Button variant="destructiveGhost" onClick={() => { setError(null); setVoidOpen(true); }}>Void payment</Button> : null}
        </div>
      ) : null}
    >
      {payment ? (
        <>
          <DocumentDetailHeader
            moduleKey="finance_payments"
            record={payment}
            currency={payment.currency}
            renderValue={(field, value) => {
              // The payment carries the party's name, not the account's or contact's own.
              if (field.field_key === "organization_id" && typeof value === "number") {
                return <TextLink href={`/dashboard/sales/organizations/${value}`}>{payment.party_name ?? "Open account"}</TextLink>;
              }
              if (field.field_key === "contact_id" && typeof value === "number") {
                return <TextLink href={`/dashboard/sales/contacts/${value}`}>{payment.organization_id ? "Open contact" : payment.party_name ?? "Open contact"}</TextLink>;
              }
              return undefined;
            }}
          />
          <FactList className="grid-cols-2 lg:grid-cols-4">
            <Fact label="Recorded">{formatDateTime(payment.created_at)}</Fact>
            {payment.void_reason ? <Fact label="Voided because">{payment.void_reason}</Fact> : null}
          </FactList>
          <section className="flex flex-col gap-3">
            <SectionHeading>Settles</SectionHeading>
            <RecordTable<PaymentAllocation>
              variant="readOnly"
              label="Documents this payment settles"
              rows={payment.allocations}
              rowKey={(row) => row.id}
              emptyState={{ title: "Nothing allocated" }}
              columns={[
                { key: "document", label: "Document", size: "lg", render: (row) => <TextLink href={documentHref(row)}>{row.document_label ?? "Document"}</TextLink> },
                { key: "type", label: "Type", size: "sm", render: (row) => ({ invoice: "Invoice", bill: "Bill", credit_note: "Credit note", vendor_credit: "Vendor credit" }[row.document_type]) },
                { key: "amount", label: "Amount", size: "sm", align: "right", render: (row) => <Money amount={row.amount} currency={payment.currency} /> },
              ]}
            />
          </section>
        </>
      ) : null}
      {payment ? <DocumentHistory moduleKey="finance_payments" entityId={payment.id} canEdit={canEdit} /> : null}

      <EditorPanel
        open={voidOpen}
        onOpenChange={setVoidOpen}
        title={`Void ${payment?.number ?? "payment"}`}
        description="The payment stays on record as void, and what it settled is due again."
        closeLabel="Close panel"
        onSubmit={() => void submitVoid()}
        status={error ? <span role="alert">{error}</span> : null}
        footer={<><Button variant="outline" onClick={() => setVoidOpen(false)}>Back</Button><Button type="submit" variant="destructive" disabled={isSaving}>Void payment</Button></>}
      >
        <Field><FieldLabel htmlFor="payment-void-reason">Reason</FieldLabel><Textarea id="payment-void-reason" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
      </EditorPanel>
    </PageShell>
  );
}
