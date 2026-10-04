"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { FormFooter } from "@/components/ui/ActionBar";
import { Button } from "@/components/ui/button";
import { EditorPanel } from "@/components/ui/EditorPanel";
import { Fact, FactList } from "@/components/ui/Fact";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Money } from "@/components/ui/Money";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable } from "@/components/ui/RecordTable";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusValue } from "@/components/ui/StatusValue";
import { Textarea } from "@/components/ui/textarea";
import { TextLink } from "@/components/ui/TextLink";
import { useFinanceDocumentActions } from "@/hooks/finance/useFinanceDocuments";
import type { PaymentRecord } from "@/hooks/finance/usePosInvoices";
import { usePurchaseBill, usePurchaseOrder, usePurchaseReceipt, usePurchasingActions, type PurchaseBillLine } from "@/hooks/purchasing/usePurchasing";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useBaseCurrency, useCompanyCurrencies } from "@/hooks/useCompanyCurrencies";
import { useConfirm } from "@/hooks/useConfirm";
import { ApiError, isForbiddenError } from "@/lib/api";
import { formErrorMessage, formFieldErrors } from "@/lib/apiErrors";
import { formatMoney } from "@/lib/currency";
import { formatDateOnly, todayIsoDate } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { OVERDUE_STATUS, getBillMatchStatus, getBillStatus, getPaymentRecordStatus, getPosPaymentStatus } from "@/lib/statusStyles";
import { formatQuantity as quantity } from "@/lib/quantity";

type DraftLine = {
  key: number; orderLineId: number | null; receiptLineId: number | null; name: string; description: string;
  quantity: string; unitCost: string; tax: string; poCost: string | null; billable: number | null;
};
let nextKey = 1;
const blankLine = (): DraftLine => ({ key: nextKey++, orderLineId: null, receiptLineId: null, name: "", description: "", quantity: "1", unitCost: "0", tax: "0", poCost: null, billable: null });


/**
 * A vendor bill (12c-erp-invoicing.md §3.3, §3.5): E3's document layout. From a purchase
 * order or a receipt, lines are billed against what was received; a different price is
 * allowed and flagged. Without a purchase order it is a service or expense bill.
 */
export function BillDocumentPage({ billId = null, orderId = null, receiptId = null }: { billId?: number | null; orderId?: number | null; receiptId?: number | null }) {
  const router = useRouter();
  const { confirm } = useConfirm();
  const { modules, isLoading: modulesLoading } = useAccessibleModules();
  const actions = modules.find((module) => module.name === "purchase_bills")?.actions;
  const canPay = Boolean(modules.find((module) => module.name === "finance_payments")?.actions?.can_create);
  const currencies = useCompanyCurrencies().data;
  const baseCurrency = useBaseCurrency();
  const query = usePurchaseBill(billId);
  const bill = query.data;
  const receipt = usePurchaseReceipt(billId === null ? receiptId : null);
  const effectiveOrderId = bill?.order_id ?? orderId ?? receipt.data?.order_id ?? null;
  const order = usePurchaseOrder(effectiveOrderId);
  const mutations = usePurchasingActions();
  const money = useFinanceDocumentActions();

  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [vendorId, setVendorId] = useState<number | null>(null);
  const [vendorName, setVendorName] = useState("");
  const [reference, setReference] = useState("");
  const [billDate, setBillDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [currency, setCurrency] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ vendor?: string; reference?: string }>({});
  const [panel, setPanel] = useState<"void" | "pay" | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(todayIsoDate);
  const [payMethod, setPayMethod] = useState("");
  const [payReference, setPayReference] = useState("");

  const isNew = billId === null;
  const fromOrder = effectiveOrderId !== null;
  const editable = isNew ? Boolean(actions?.can_create) : bill?.status === "draft" && Boolean(actions?.can_edit);

  // Seed once per loaded bill (or purchase order / receipt, for a new one), while rendering.
  const ready = isNew ? (!fromOrder || (order.data && (receiptId === null || receipt.data))) : Boolean(bill) && (!fromOrder || Boolean(order.data));
  const seedKey = ready ? (isNew ? `new-${effectiveOrderId ?? "blank"}-${receiptId ?? ""}` : `bill-${bill!.id}-${bill!.status}-${bill!.updated_at}`) : null;
  if (seedKey && seedKey !== loadedKey) {
    setLoadedKey(seedKey);
    setVendorId(bill?.vendor_id ?? order.data?.vendor_id ?? null);
    setVendorName(bill?.vendor_name ?? order.data?.vendor_name ?? "");
    setReference(bill?.vendor_invoice_number ?? "");
    setBillDate(bill?.bill_date ?? todayIsoDate());
    setDueDate(bill?.due_date ?? "");
    setCurrency(bill?.currency ?? order.data?.currency ?? "");
    setNotes(bill?.notes ?? "");
    if (bill?.lines?.length) {
      setLines(bill.lines.map((line) => ({
        key: nextKey++, orderLineId: line.order_line_id, receiptLineId: line.receipt_line_id, name: line.description, description: line.description,
        quantity: String(Number(line.quantity)), unitCost: String(Number(line.unit_cost)), tax: String(Number(line.tax_amount)),
        poCost: line.po_unit_cost, billable: line.billable != null ? Number(line.billable) : null,
      })));
    } else if (order.data) {
      const fromReceipt = receipt.data?.lines;
      setLines((order.data.lines ?? []).map((line) => {
        const toBill = Number(line.to_bill ?? 0);
        const received = fromReceipt?.find((item) => item.order_line_id === line.id);
        const wanted = fromReceipt ? Math.min(Number(received?.quantity ?? 0), toBill) : toBill;
        return { key: nextKey++, orderLineId: line.id, receiptLineId: received?.id ?? null, name: line.product_name, description: line.description ?? line.product_name,
          quantity: String(wanted), unitCost: String(Number(line.unit_cost)), tax: "0", poCost: line.unit_cost, billable: toBill };
      }));
    } else {
      setLines([blankLine()]);
    }
  }

  const currencyCode = currency || bill?.currency || currencies?.[0] || "USD";
  const updateLine = (updated: DraftLine) => setLines((current) => current.map((line) => (line.key === updated.key ? updated : line)));
  const total = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitCost) || 0) + (Number(line.tax) || 0), 0);

  async function save(andPost: boolean) {
    setFieldErrors({});
    if (!vendorId) { setFieldErrors({ vendor: "Choose a vendor." }); setError("Check the highlighted field."); document.getElementById("bill-vendor")?.focus(); return; }
    if (!reference.trim()) { setFieldErrors({ reference: "Enter the vendor's invoice number." }); setError("Check the highlighted field."); document.getElementById("bill-reference")?.focus(); return; }
    const chosen = lines.filter((line) => Number(line.quantity) > 0);
    if (!chosen.length) { setError("Bill at least one line."); return; }
    if (chosen.some((line) => !line.orderLineId && !line.description.trim())) { setError("Describe every line."); return; }
    const over = chosen.find((line) => line.billable != null && Number(line.quantity) > line.billable);
    if (over) { setError(`${over.name}: only ${quantity(over.billable)} received and not yet billed.`); return; }
    const payload = {
      vendor_id: fromOrder ? null : vendorId, vendor_invoice_number: reference.trim(), bill_date: billDate || null, due_date: dueDate || null,
      currency: fromOrder ? null : currencyCode, notes: notes.trim() || null,
      lines: chosen.map((line) => ({ order_line_id: line.orderLineId, receipt_line_id: line.receiptLineId, description: line.description.trim() || null,
        quantity: line.quantity, unit_cost: line.unitCost, tax_amount: line.tax || "0" })),
    };
    try {
      setError(null);
      let id = bill?.id ?? null;
      if (isNew) {
        const created = await mutations.createBill({ ...payload, order_id: effectiveOrderId, receipt_id: receiptId });
        id = created.id;
      } else if (bill) {
        await mutations.updateBill({ id: bill.id, payload });
      }
      if (id && andPost) {
        const posted = await mutations.postBill(id);
        toast.success(`Bill ${posted.number} posted${posted.match_status === "variance" ? "; prices differ from the purchase order" : ""}.`);
      } else {
        toast.success("Draft saved.");
      }
      if (isNew && id) router.push(`${DASHBOARD_ROUTES.purchaseBills}/${id}`);
    } catch (failure) {
      // H2: a clash with another bill's vendor invoice number belongs on that field, not the footer.
      const clash = formFieldErrors(failure).vendor_invoice_number
        ?? (failure instanceof ApiError && failure.status === 409 && /vendor's invoice/i.test(failure.message) ? failure.message : null);
      if (clash) {
        setFieldErrors({ reference: clash });
        setError("Check the highlighted field.");
        document.getElementById("bill-reference")?.focus();
      } else {
        setError(formErrorMessage(failure, "The bill could not be saved."));
      }
    }
  }

  async function post() {
    if (!bill) return;
    if (!(await confirm({ title: `Post ${bill.number}?`, description: `${bill.vendor_name ?? "The vendor"} is owed ${formatMoney(bill.total, bill.currency) ?? bill.total}. A posted bill cannot be edited.`, confirmLabel: "Post bill" }))) return;
    try { setError(null); const posted = await mutations.postBill(bill.id); toast.success(`Bill ${posted.number} posted.`); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The bill could not be posted."); }
  }

  async function submitPanel() {
    if (!bill || !panel) return;
    try {
      setError(null);
      if (panel === "void") {
        if (!voidReason.trim()) { setError("Enter a reason."); return; }
        await mutations.voidBill({ id: bill.id, reason: voidReason.trim() });
        toast.success(`${bill.number} voided.`);
      } else {
        if (!(Number(payAmount) > 0) || Number(payAmount) > Number(bill.balance_due)) { setError("Enter an amount above zero and no more than the balance due."); return; }
        await money.recordPayment({ direction: "made", kind: "payment", paid_on: payDate || null, method: payMethod.trim() || null,
          reference: payReference.trim() || null, allocations: [{ bill_id: bill.id, amount: payAmount }] });
        toast.success("Payment recorded.");
      }
      setPanel(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The bill could not be changed."); }
  }

  async function remove() {
    if (!bill || !(await confirm({ title: `Remove ${bill.number}?`, description: "This draft can be restored from the recycle bin.", confirmLabel: "Remove draft", variant: "destructive" }))) return;
    try { await mutations.removeBill(bill.id); toast.success("Draft removed."); router.push(DASHBOARD_ROUTES.purchaseBills); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Removal failed."); }
  }

  const owing = bill?.status === "posted" && Number(bill.balance_due) > 0;
  const paid = (bill?.payments ?? []).some((payment) => payment.status === "posted");

  return (
    <PageShell
      variant="document"
      title={bill ? `Bill ${bill.number}` : "New bill"}
      description={bill
        ? [bill.vendor_name, `Vendor invoice ${bill.vendor_invoice_number}`, bill.due_date ? `Due ${formatDateOnly(bill.due_date)}` : null].filter(Boolean).join(" · ")
        : fromOrder ? `Bill what was received on ${order.data?.number ?? "the purchase order"}.` : "A bill without a purchase order, for a service or an expense."}
      backHref={DASHBOARD_ROUTES.purchaseBills}
      isLoading={isNew ? modulesLoading || order.isLoading || receipt.isLoading : query.isLoading}
      isPermissionDenied={isForbiddenError(query.error) || (isNew && !modulesLoading && !actions?.can_create)}
      hasError={Boolean(query.error) && !isForbiddenError(query.error)}
      onRetry={() => void query.refetch()}
      actions={
        <div className="flex flex-wrap gap-2">
          {bill ? <StatusValue status={bill.is_overdue ? OVERDUE_STATUS : getBillStatus(bill.status)} context="record" /> : null}
          {bill?.status === "draft" && actions?.can_edit ? <Button onClick={() => void post()} disabled={mutations.isSaving}>Post bill</Button> : null}
          {owing && canPay ? <Button onClick={() => { setError(null); setPayAmount(String(Number(bill?.balance_due ?? 0))); setPanel("pay"); }}>Record payment</Button> : null}
          {bill?.status === "posted" && !paid && actions?.can_edit ? <Button variant="outline" onClick={() => { setError(null); setPanel("void"); }}>Void</Button> : null}
          {bill?.status === "draft" && actions?.can_delete ? <Button variant="destructiveGhost" onClick={() => void remove()}>Remove draft</Button> : null}
        </div>
      }
    >
      {editable ? (
        <div className="grid gap-6 lg:grid-cols-3">
          {fromOrder ? (
            <FactList>
              <Fact label="Vendor">{vendorName || "—"}</Fact>
              <Fact label="Purchase order"><TextLink href={`${DASHBOARD_ROUTES.purchaseOrders}/${effectiveOrderId}`}>{order.data?.number ?? bill?.order_number ?? "Purchase order"}</TextLink></Fact>
            </FactList>
          ) : (
            <Field className="lg:col-span-2" data-invalid={Boolean(fieldErrors.vendor)}>
              <FieldLabel htmlFor="bill-vendor">Vendor <RequiredMark /></FieldLabel>
              <LinkedRecordPicker inputId="bill-vendor" recordType="vendor" valueId={vendorId} displayValue={vendorName}
                onDisplayValueChange={(value) => { setVendorName(value); setVendorId(null); }}
                onSelect={(option) => { setVendorId(option.id); setVendorName(option.label); }}
                onClear={() => { setVendorId(null); setVendorName(""); }} placeholder="Search vendors" />
              {fieldErrors.vendor ? <FieldError>{fieldErrors.vendor}</FieldError> : null}
            </Field>
          )}
          <Field data-invalid={Boolean(fieldErrors.reference)}>
            <FieldLabel htmlFor="bill-reference">Vendor invoice number <RequiredMark /></FieldLabel>
            <Input id="bill-reference" maxLength={120} value={reference} aria-required aria-invalid={Boolean(fieldErrors.reference)} aria-describedby={fieldErrors.reference ? "bill-reference-error" : undefined} onChange={(event) => setReference(event.target.value)} />
            {fieldErrors.reference ? <FieldError id="bill-reference-error">{fieldErrors.reference}</FieldError> : <FieldDescription>As printed on the vendor&apos;s invoice; used to catch a bill entered twice.</FieldDescription>}
          </Field>
          <Field><FieldLabel htmlFor="bill-date">Bill date</FieldLabel><Input id="bill-date" type="date" value={billDate} onChange={(event) => setBillDate(event.target.value)} /></Field>
          <Field>
            <FieldLabel htmlFor="bill-due">Due date</FieldLabel>
            <Input id="bill-due" type="date" min={billDate || undefined} value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            {!dueDate ? <FieldDescription>Blank uses the vendor&apos;s payment terms.</FieldDescription> : null}
          </Field>
          {!fromOrder ? (
            <Field>
              <FieldLabel htmlFor="bill-currency">Currency</FieldLabel>
              <Select value={currencyCode} onValueChange={setCurrency}>
                <SelectTrigger id="bill-currency"><SelectValue /></SelectTrigger>
                <SelectContent>{Array.from(new Set([currencyCode, ...(currencies ?? [])])).map((code) => <SelectItem key={code} value={code}>{code}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          ) : null}
          <Field className="lg:col-span-3"><FieldLabel htmlFor="bill-notes">Notes</FieldLabel><Textarea id="bill-notes" value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
        </div>
      ) : bill ? (
        <FactList className="grid-cols-2 lg:grid-cols-4">
          <Fact label="Vendor"><TextLink href={`/dashboard/sales/organizations/${bill.vendor_id}`}>{bill.vendor_name ?? "Vendor"}</TextLink></Fact>
          {bill.order_id ? <Fact label="Purchase order"><TextLink href={`${DASHBOARD_ROUTES.purchaseOrders}/${bill.order_id}`}>{bill.order_number ?? "Purchase order"}</TextLink></Fact> : null}
          <Fact label="Bill date">{formatDateOnly(bill.bill_date)}</Fact>
          <Fact label="Total"><Money amount={bill.total} currency={bill.currency} context="field" /></Fact>
          {bill.status === "posted" ? <Fact label="Balance due"><Money amount={bill.balance_due} currency={bill.currency} context="field" /></Fact> : null}
          {bill.status === "posted" ? <Fact label="Payment"><StatusValue status={getPosPaymentStatus(bill.payment_status)} /></Fact> : null}
          {bill.order_id ? <Fact label="Matching"><StatusValue status={getBillMatchStatus(bill.match_status)} /></Fact> : null}
          {bill.void_reason ? <Fact label="Voided because">{bill.void_reason}</Fact> : null}
        </FactList>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <SectionHeading description={editable ? `Total ${formatMoney(total, currencyCode, { maximumFractionDigits: 2 }) ?? total}` : undefined}>Lines</SectionHeading>
          {editable && !fromOrder ? <Button type="button" variant="outline" size="sm" onClick={() => setLines((current) => [...current, blankLine()])}><Plus />Add line</Button> : null}
        </div>
        {editable ? (
          <RecordTable<DraftLine>
            variant="lineItems"
            label="Bill lines"
            rows={lines}
            rowKey={(line) => line.key}
            columns={[
              { key: "description", label: "Description", size: "lg", interactive: true, render: (line) => (line.orderLineId
                ? <span>{line.name}</span>
                : <Input aria-label={`Description, line ${lines.indexOf(line) + 1}`} value={line.description} onChange={(event) => updateLine({ ...line, description: event.target.value, name: event.target.value })} />) },
              ...(fromOrder ? [{ key: "billable", label: "To bill", size: "sm" as const, align: "right" as const, render: (line: DraftLine) => <span className="tabular-nums">{quantity(line.billable)}</span> }] : []),
              { key: "quantity", label: "Quantity", size: "sm", align: "right", interactive: true, render: (line) => (
                <Input aria-label={`Quantity for ${line.name || "line"}`} type="number" min={0} step="0.0001" inputMode="decimal" value={line.quantity} onChange={(event) => updateLine({ ...line, quantity: event.target.value })} />
              ) },
              { key: "cost", label: "Unit cost", size: "sm", align: "right", interactive: true, render: (line) => (
                <Input aria-label={`Unit cost for ${line.name || "line"}`} type="number" min={0} step="0.0001" inputMode="decimal" value={line.unitCost} onChange={(event) => updateLine({ ...line, unitCost: event.target.value })} />
              ) },
              { key: "tax", label: "Tax", size: "sm", align: "right", interactive: true, render: (line) => (
                <Input aria-label={`Tax for ${line.name || "line"}`} type="number" min={0} step="0.01" inputMode="decimal" value={line.tax} onChange={(event) => updateLine({ ...line, tax: event.target.value })} />
              ) },
              { key: "total", label: "Total", size: "sm", align: "right", render: (line) => <Money amount={(Number(line.quantity) || 0) * (Number(line.unitCost) || 0) + (Number(line.tax) || 0)} currency={currencyCode} /> },
              ...(!fromOrder ? [{ key: "remove", label: <span className="sr-only">Remove</span>, size: "sm" as const, interactive: true, render: (line: DraftLine) => (
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${line.name || "line"}`} disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}><Trash2 /></Button>
              ) }] : []),
            ]}
          />
        ) : (
          <RecordTable<PurchaseBillLine>
            variant="readOnly"
            label="Bill lines"
            rows={bill?.lines ?? []}
            rowKey={(line) => line.id}
            emptyState={{ title: "No lines" }}
            // E6 (12d §3.5): what a price difference did to stock value, in the base currency.
            rowDetail={(line) => line.variance_stock_change != null ? (
              <p className="text-p-sm text-copy-secondary">
                The price difference added {formatMoney(line.variance_stock_change, baseCurrency.data)} to stock value
                {Number(line.variance_cogs_change) ? ` and ${formatMoney(line.variance_cogs_change, baseCurrency.data)} to cost of goods already sold` : ""}
                {bill?.status === "void" ? "; voiding the bill undid it." : "."}
              </p>
            ) : null}
            columns={[
              { key: "description", label: "Description", size: "lg", render: (line) => line.description },
              { key: "quantity", label: "Quantity", size: "sm", align: "right", render: (line) => <span className="tabular-nums">{quantity(line.quantity)}</span> },
              { key: "po_cost", label: "PO cost", size: "sm", align: "right", render: (line) => (line.po_unit_cost != null ? <Money amount={line.po_unit_cost} currency={bill?.currency} /> : "—") },
              { key: "cost", label: "Billed cost", size: "sm", align: "right", render: (line) => <Money amount={line.unit_cost} currency={bill?.currency} /> },
              { key: "variance", label: "Matching", size: "md", render: (line) => (line.order_line_id ? <StatusValue status={getBillMatchStatus(line.price_variance ? "variance" : "matched")} /> : "—") },
              { key: "tax", label: "Tax", size: "sm", align: "right", render: (line) => <Money amount={line.tax_amount} currency={bill?.currency} /> },
              { key: "total", label: "Total", size: "sm", align: "right", render: (line) => <Money amount={line.line_total} currency={bill?.currency} /> },
            ]}
          />
        )}
      </section>

      {bill?.payments?.length ? (
        <section className="flex flex-col gap-3">
          <SectionHeading>Payments</SectionHeading>
          <RecordTable<PaymentRecord>
            variant="readOnly"
            label="Payments on this bill"
            rows={bill.payments}
            rowKey={(row) => row.id}
            rowHref={(row) => `${DASHBOARD_ROUTES.payments}/${row.id}`}
            emptyState={{ title: "No payments" }}
            columns={[
              { key: "number", label: "Number", size: "sm", render: (row) => <span className="font-semibold text-copy-primary">{row.number}</span> },
              { key: "paid_on", label: "Paid on", size: "sm", render: (row) => formatDateOnly(row.paid_on) },
              { key: "method", label: "Method", size: "sm", render: (row) => row.method ?? "—" },
              { key: "reference", label: "Reference", size: "md", render: (row) => row.reference ?? "—" },
              { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getPaymentRecordStatus(row.status)} /> },
              { key: "amount", label: "Amount", size: "sm", align: "right", render: (row) => <Money amount={row.amount} currency={row.currency} /> },
            ]}
          />
        </section>
      ) : null}

      {editable ? (
        <FormFooter status={error ? <span role="alert" className="text-state-danger">{error}</span> : "A draft is not owed until it is posted."}>
          <Button type="button" variant="outline" asChild><Link href={DASHBOARD_ROUTES.purchaseBills}>Back</Link></Button>
          <Button type="button" variant="outline" onClick={() => void save(false)} disabled={mutations.isSaving}>Save draft</Button>
          {actions?.can_edit ? <Button type="button" onClick={() => void save(true)} disabled={mutations.isSaving}>{mutations.isSaving ? "Saving…" : "Save and post"}</Button> : null}
        </FormFooter>
      ) : error ? <p role="alert" className="text-sm text-state-danger">{error}</p> : null}

      <EditorPanel
        open={panel !== null}
        onOpenChange={(open) => { if (!open) setPanel(null); }}
        title={panel === "pay" ? "Record payment" : `Void ${bill?.number ?? "bill"}`}
        description={panel === "pay" ? `Money paid to ${bill?.vendor_name ?? "the vendor"} against ${bill?.vendor_invoice_number ?? "this bill"}.` : "The bill stays on record as void and is no longer owed."}
        closeLabel="Close panel"
        onSubmit={() => void submitPanel()}
        status={error ? <span role="alert">{error}</span> : null}
        footer={<><Button variant="outline" onClick={() => setPanel(null)}>Back</Button><Button type="submit" variant={panel === "void" ? "destructive" : "default"} disabled={mutations.isSaving || money.isSaving}>{panel === "pay" ? "Record payment" : "Void bill"}</Button></>}
      >
        {panel === "pay" ? (
          <>
            <Field><FieldLabel htmlFor="bill-pay-amount">Amount</FieldLabel><Input id="bill-pay-amount" type="number" min="0.01" step="0.01" inputMode="decimal" value={payAmount} onChange={(event) => setPayAmount(event.target.value)} /></Field>
            <Field><FieldLabel htmlFor="bill-pay-date">Paid on</FieldLabel><Input id="bill-pay-date" type="date" max={todayIsoDate()} value={payDate} onChange={(event) => setPayDate(event.target.value)} /></Field>
            <Field><FieldLabel htmlFor="bill-pay-method">Method</FieldLabel><Input id="bill-pay-method" maxLength={100} value={payMethod} onChange={(event) => setPayMethod(event.target.value)} placeholder="Bank transfer, card…" /></Field>
            <Field><FieldLabel htmlFor="bill-pay-reference">Reference</FieldLabel><Input id="bill-pay-reference" maxLength={200} value={payReference} onChange={(event) => setPayReference(event.target.value)} /></Field>
          </>
        ) : (
          <Field><FieldLabel htmlFor="bill-void-reason">Reason</FieldLabel><Textarea id="bill-void-reason" maxLength={500} value={voidReason} onChange={(event) => setVoidReason(event.target.value)} /></Field>
        )}
      </EditorPanel>
    </PageShell>
  );
}
