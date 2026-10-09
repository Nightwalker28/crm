"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { LayoutRecordFormBody } from "@/components/forms/LayoutRecordFormBody";
import type { RecordFormValue } from "@/components/forms/RecordForm";
import { validateLayoutDrivenQuickCreate } from "@/components/forms/quickCreateLayout";
import { vendorFieldRenderer } from "@/components/purchasing/vendorFieldRenderer";
import {
  emptyPurchaseLineTax, PurchaseLineTaxCell, purchaseLinePreview, purchaseLineTaxFrom, purchaseLineTaxPayload, usePurchaseTaxRates, type PurchaseLineTax,
} from "@/components/finance/tax/purchaseLineTax";
import { TaxSummary } from "@/components/finance/tax/TaxSummary";
import { DocumentSendAction } from "@/components/transactions/DocumentSendAction";
import { DocumentPdfButton } from "@/components/transactions/DocumentPdfButton";
import { DocumentDetailHeader } from "@/components/transactions/DocumentLayoutHeader";
import { LineItemsEditor, LineNumberInput, LineTextInput } from "@/components/transactions/LineItemsEditor";
import { FormFooter } from "@/components/ui/ActionBar";
import { Button } from "@/components/ui/button";
import { EditorPanel } from "@/components/ui/EditorPanel";
import { Fact, FactList } from "@/components/ui/Fact";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/Money";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable } from "@/components/ui/RecordTable";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusValue } from "@/components/ui/StatusValue";
import { Textarea } from "@/components/ui/textarea";
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
import { OVERDUE_STATUS, getBillMatchStatus, getBillStatus, getPaymentRecordStatus, getPosPaymentStatus, getVendorCreditStatus } from "@/lib/statusStyles";
import { formatQuantity as quantity } from "@/lib/quantity";
import { PicklistField } from "@/components/picklists/PicklistSelect";
import { PicklistText } from "@/components/picklists/PicklistText";
import { useResolvedRecordLayout } from "@/hooks/useResolvedRecordLayout";
import { DocumentHistory } from "@/components/recordActivity/DocumentHistory";

type DraftLine = {
  key: number; orderLineId: number | null; receiptLineId: number | null; name: string; description: string;
  quantity: string; unitCost: string; tax: PurchaseLineTax; poCost: string | null; billable: number | null;
};
let nextKey = 1;
const blankLine = (): DraftLine => ({ key: nextKey++, orderLineId: null, receiptLineId: null, name: "", description: "", quantity: "1", unitCost: "0", tax: emptyPurchaseLineTax(), poCost: null, billable: null });

/** The header the `full_form` layout draws (13b Phase 4e), keyed by field key. */
type BillHeader = RecordFormValue & {
  vendor_id: number | null;
  vendor_name: string;
  vendor_invoice_number: string;
  bill_date: string;
  due_date: string;
  order_id: number | null;
  order_name: string;
  receipt_id: number | null;
  receipt_name: string;
  currency: string;
  notes: string;
};

/** The ids these inputs had before the layout drew them; specs and focus still use them. */
const BILL_INPUT_IDS: Record<string, string> = {
  vendor_id: "bill-vendor",
  vendor_invoice_number: "bill-reference",
  bill_date: "bill-date",
  due_date: "bill-due",
  currency: "bill-currency",
  notes: "bill-notes",
};
const billInputId = (fieldKey: string) => BILL_INPUT_IDS[fieldKey] ?? `bill-${fieldKey.replace(/_/g, "-")}`;


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
  const canCredit = Boolean(modules.find((module) => module.name === "purchase_vendor_credits")?.actions?.can_create);
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
  const [header, setHeader] = useState<BillHeader | null>(null);
  const layoutQuery = useResolvedRecordLayout("purchase_bills", "full_form");
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [error, setError] = useState<string | null>(null);
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
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
    setCustomValues(bill?.custom_fields ?? {});
    setHeader({
      vendor_id: bill?.vendor_id ?? order.data?.vendor_id ?? null,
      vendor_name: bill?.vendor_name ?? order.data?.vendor_name ?? "",
      vendor_invoice_number: bill?.vendor_invoice_number ?? "",
      bill_date: bill?.bill_date ?? todayIsoDate(),
      due_date: bill?.due_date ?? "",
      order_id: effectiveOrderId,
      order_name: order.data?.number ?? bill?.order_number ?? "",
      receipt_id: bill?.receipt_id ?? receiptId,
      receipt_name: receipt.data?.number ?? "",
      currency: bill?.currency ?? order.data?.currency ?? "",
      notes: bill?.notes ?? "",
    });
    if (bill?.lines?.length) {
      setLines(bill.lines.map((line) => ({
        key: nextKey++, orderLineId: line.order_line_id, receiptLineId: line.receipt_line_id, name: line.description, description: line.description,
        quantity: String(Number(line.quantity)), unitCost: String(Number(line.unit_cost)), tax: purchaseLineTaxFrom(line),
        poCost: line.po_unit_cost, billable: line.billable != null ? Number(line.billable) : null,
      })));
    } else if (order.data) {
      const fromReceipt = receipt.data?.lines;
      setLines((order.data.lines ?? []).map((line) => {
        const toBill = Number(line.to_bill ?? 0);
        const received = fromReceipt?.find((item) => item.order_line_id === line.id);
        const wanted = fromReceipt ? Math.min(Number(received?.quantity ?? 0), toBill) : toBill;
        return { key: nextKey++, orderLineId: line.id, receiptLineId: received?.id ?? null, name: line.product_name, description: line.description ?? line.product_name,
          // *Automatic* takes the PO line's tax (13d §3.1).
          quantity: String(wanted), unitCost: String(Number(line.net_unit_cost ?? line.unit_cost)), tax: { ...emptyPurchaseLineTax(), auto_rate_id: line.tax_rate_id ?? null },
          poCost: line.net_unit_cost ?? line.unit_cost, billable: toBill };
      }));
    } else {
      setLines([blankLine()]);
    }
  }

  const currencyCode = header?.currency || bill?.currency || baseCurrency.data || currencies?.[0] || "USD";
  // The source documents show only when there is one; a bill from an order takes its vendor and currency.
  const omitFieldKeys = [...(header?.order_id ? [] : ["order_id"]), ...(header?.receipt_id ? [] : ["receipt_id"])];
  const updateLine = (updated: DraftLine) => setLines((current) => current.map((line) => (line.key === updated.key ? updated : line)));
  const taxRates = usePurchaseTaxRates();
  const total = lines.reduce((sum, line) => sum + purchaseLinePreview(line, taxRates).total, 0);
  // The match posting will find (H19): shown while the bill is still a draft, not after.
  const priceDifferences = lines.filter((line) => line.poCost != null && Number(line.quantity) > 0 && Number(line.unitCost) !== Number(line.poCost));

  async function save(andPost: boolean) {
    if (!header) return;
    const nextErrors = layoutQuery.data ? validateLayoutDrivenQuickCreate(layoutQuery.data, header, customValues, omitFieldKeys) : {};
    if (!header.vendor_id) nextErrors.vendor_id = "Choose a vendor.";
    if (!header.vendor_invoice_number.trim()) nextErrors.vendor_invoice_number = "Enter the vendor's invoice number.";
    setFieldErrors(nextErrors);
    const firstInvalid = Object.keys(nextErrors)[0];
    if (firstInvalid) {
      setError("Check the highlighted field.");
      document.getElementById(firstInvalid.startsWith("custom:") ? `custom-field-purchase_bills-${firstInvalid.slice(7)}` : billInputId(firstInvalid))?.focus();
      return;
    }
    const chosen = lines.filter((line) => Number(line.quantity) > 0);
    if (!chosen.length) { setError("Bill at least one line."); return; }
    if (chosen.some((line) => !line.orderLineId && !line.description.trim())) { setError("Describe every line."); return; }
    const over = chosen.find((line) => line.billable != null && Number(line.quantity) > line.billable);
    if (over) { setError(`${over.name}: only ${quantity(over.billable)} received and not yet billed.`); return; }
    const payload = {
      custom_fields: customValues,
      vendor_id: fromOrder ? null : header.vendor_id, vendor_invoice_number: header.vendor_invoice_number.trim(), bill_date: header.bill_date || null, due_date: header.due_date || null,
      currency: fromOrder ? null : currencyCode, notes: header.notes.trim() || null,
      lines: chosen.map((line) => ({ order_line_id: line.orderLineId, receipt_line_id: line.receiptLineId, description: line.description.trim() || null,
        quantity: line.quantity, unit_cost: line.unitCost, ...purchaseLineTaxPayload(line.tax) })),
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
        setFieldErrors({ vendor_invoice_number: clash });
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
        await money.recordPayment({ direction: "made", kind: "payment", paid_on: payDate || null, method: payMethod || null,
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
          {bill?.id ? <DocumentPdfButton moduleKey="purchase_bills" recordId={bill.id} /> : null}
          {bill?.id && bill.status !== "draft" ? <DocumentSendAction moduleKey="purchase_bills" recordId={bill.id} /> : null}
          {bill?.status === "draft" && actions?.can_edit ? <Button onClick={() => void post()} disabled={mutations.isSaving}>Post bill</Button> : null}
          {owing && canPay ? <Button onClick={() => { setError(null); setPayAmount(String(Number(bill?.balance_due ?? 0))); setPanel("pay"); }}>Record payment</Button> : null}
          {/* 13c §3.6: what the vendor owes back on this bill. */}
          {bill?.status === "posted" && canCredit ? (
            <Button asChild variant="outline"><Link href={`${DASHBOARD_ROUTES.vendorCredits}/new?bill_id=${bill.id}`}>Create vendor credit</Link></Button>
          ) : null}
          {bill?.status === "posted" && !paid && actions?.can_edit && !(bill.vendor_credits ?? []).some((credit) => credit.status === "issued") ? (
            <Button variant="outline" onClick={() => { setError(null); setPanel("void"); }}>Void</Button>
          ) : null}
          {bill?.status === "draft" && actions?.can_delete ? <Button variant="destructiveGhost" onClick={() => void remove()}>Remove draft</Button> : null}
        </div>
      }
    >
      {editable && header ? (
        <LayoutRecordFormBody<BillHeader>
          moduleKey="purchase_bills"
          value={header}
          onChange={setHeader}
          customValues={customValues}
          onCustomChange={(key, value) => setCustomValues((current) => ({ ...current, [key]: value }))}
          inputId={billInputId}
          action={isNew ? "create" : "edit"}
          errors={fieldErrors}
          lockedFieldKeys={fromOrder ? ["vendor_id", "currency"] : []}
          renderField={vendorFieldRenderer(header)}
          slots={{ omitFieldKeys }}
        />
      ) : bill ? (
        <>
          <DocumentDetailHeader
            moduleKey="purchase_bills"
            record={bill}
            currency={bill.currency}
            links={{
              vendor_id: `/dashboard/sales/organizations/${bill.vendor_id}`,
              order_id: bill.order_id ? `${DASHBOARD_ROUTES.purchaseOrders}/${bill.order_id}` : null,
              receipt_id: bill.receipt_id ? `${DASHBOARD_ROUTES.purchaseReceipts}/${bill.receipt_id}` : null,
            }}
            omitFieldKeys={[
              ...(bill.order_id ? [] : ["order_id", "match_status"]),
              ...(bill.receipt_id ? [] : ["receipt_id"]),
              // Payment is the posted bill's story.
              ...(bill.status === "posted" ? [] : ["amount_paid", "balance_due", "payment_status"]),
            ]}
            renderValue={(field, value) => {
              if (field.field_key === "payment_status" && typeof value === "string") return <StatusValue status={getPosPaymentStatus(value)} />;
              if (field.field_key === "match_status" && typeof value === "string") return <StatusValue status={getBillMatchStatus(value)} />;
              return undefined;
            }}
          />
          {bill.void_reason ? (
            <FactList className="grid-cols-2 lg:grid-cols-4">
              <Fact label="Voided because">{bill.void_reason}</Fact>
            </FactList>
          ) : null}
        </>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <SectionHeading description={editable ? `Total ${formatMoney(total, currencyCode, { maximumFractionDigits: 2 }) ?? total}` : undefined}>Lines</SectionHeading>
        </div>
        {editable ? (
          <LineItemsEditor<DraftLine>
            id="bill-lines"
            label="Bill lines"
            lines={lines}
            lineKey={(line) => line.key}
            onChange={setLines}
            // Lines billed against an order or receipt are that order's; only a standalone bill adds its own.
            createLine={fromOrder ? undefined : blankLine}
            addLabel="Add line"
            lineLabel={(line) => line.name || "line"}
            columns={[
              { key: "description", label: "Description", size: "lg", share: 4, render: (line, { index, cellProps }) => (line.orderLineId
                ? <span className="block truncate">{line.name}</span>
                : <LineTextInput cellProps={cellProps("description")} ariaLabel={`Description, line ${index + 1}`} value={line.description}
                    onChange={(value) => updateLine({ ...line, description: value, name: value })} />) },
              ...(fromOrder ? [{ key: "billable", label: "To bill", size: "sm" as const, align: "right" as const, share: 1, render: (line: DraftLine) => <span className="tabular-nums">{quantity(line.billable)}</span> }] : []),
              { key: "quantity", label: "Quantity", size: "sm", align: "right", share: 1.25, render: (line, { cellProps }) => (
                <LineNumberInput cellProps={cellProps("quantity")} ariaLabel={`Quantity for ${line.name || "line"}`} step="0.0001" value={line.quantity} onChange={(value) => updateLine({ ...line, quantity: value })} />
              ) },
              { key: "cost", label: "Unit cost", size: "sm", align: "right", share: 1.5, render: (line, { cellProps }) => (
                <LineNumberInput cellProps={cellProps("cost")} ariaLabel={`Unit cost for ${line.name || "line"}`} step="0.0001" value={line.unitCost} onChange={(value) => updateLine({ ...line, unitCost: value })} />
              ) },
              { key: "tax", label: "Tax", size: "md", share: 1.75, render: (line, { cellProps }) => (
                <PurchaseLineTaxCell value={line.tax} rates={taxRates} label={line.name || "line"} cellProps={cellProps("tax")}
                  onChange={(tax) => updateLine({ ...line, tax })} />
              ) },
              { key: "total", label: "Total", size: "sm", align: "right", share: 1.5, render: (line) => <span className="block truncate tabular-nums"><Money amount={purchaseLinePreview(line, taxRates).total} currency={currencyCode} /></span> },
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
        {!editable ? <TaxSummary rows={bill?.tax_summary} currency={bill?.currency} /> : null}
        {editable && priceDifferences.length ? (
          <p role="status" className="text-p-sm text-state-warning">
            {priceDifferences.length === 1 ? `${priceDifferences[0].name} is` : `${priceDifferences.length} lines are`} priced differently from the
            purchase order. Posting records the difference: stock still on hand is revalued, and the share on goods already sold goes to cost of goods.
          </p>
        ) : null}
      </section>

      {bill?.vendor_credits?.length ? (
        <section className="flex flex-col gap-3">
          <SectionHeading>Vendor credits</SectionHeading>
          <RecordTable
            variant="readOnly"
            label="Vendor credits for this bill"
            rows={bill.vendor_credits}
            rowKey={(row) => row.id}
            rowHref={(row) => `${DASHBOARD_ROUTES.vendorCredits}/${row.id}`}
            emptyState={{ title: "No vendor credits" }}
            columns={[
              { key: "number", label: "Number", size: "sm", render: (row) => <span className="font-semibold text-copy-primary">{row.number ?? "Draft"}</span> },
              { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getVendorCreditStatus(row.status)} /> },
              { key: "applied", label: "Applied here", size: "sm", align: "right", render: (row) => <Money amount={row.applied} currency={row.currency} /> },
              { key: "total", label: "Credit total", size: "sm", align: "right", render: (row) => <Money amount={row.total} currency={row.currency} /> },
            ]}
          />
        </section>
      ) : null}

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
              { key: "method", label: "Method", size: "sm", render: (row) => <PicklistText listKey="payment_method" value={row.method} /> },
              { key: "reference", label: "Reference", size: "md", render: (row) => row.reference ?? "—" },
              { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getPaymentRecordStatus(row.status)} /> },
              { key: "amount", label: "Amount", size: "sm", align: "right", render: (row) => <Money amount={row.amount} currency={row.currency} /> },
            ]}
          />
        </section>
      ) : null}

      {bill ? <DocumentHistory moduleKey="purchase_bills" entityId={bill.id} canEdit={Boolean(actions?.can_edit)} /> : null}

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
            <PicklistField id="bill-pay-method" listKey="payment_method" label="Method" value={payMethod} onChange={setPayMethod} />
            <Field><FieldLabel htmlFor="bill-pay-reference">Reference</FieldLabel><Input id="bill-pay-reference" maxLength={200} value={payReference} onChange={(event) => setPayReference(event.target.value)} /></Field>
          </>
        ) : (
          <Field><FieldLabel htmlFor="bill-void-reason">Reason</FieldLabel><Textarea id="bill-void-reason" maxLength={500} value={voidReason} onChange={(event) => setVoidReason(event.target.value)} /></Field>
        )}
      </EditorPanel>
    </PageShell>
  );
}
