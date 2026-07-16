"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";

import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { FormSection, RecordFormLayout } from "@/components/forms/RecordFormLayout";
import { areTransactionItemsValid, calculateTransactionTotals, createTransactionLineItem, formatTransactionMoney, serializeTransactionItems, TransactionLineItemsEditor, type TransactionLineItem } from "@/components/transactions/TransactionLineItemsEditor";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/PageHeader";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useCompanyCurrencies } from "@/hooks/useCompanyCurrencies";
import type { Order } from "@/hooks/sales/useOrders";
import { apiFetch } from "@/lib/api";

type OrderForm = { order_number: string; organization_id: number | null; organization_name: string; contact_id: number | null; contact_name: string; opportunity_id: number | null; opportunity_name: string; owner_id: number | null; owner_name: string; status: string; currency: string; delivery_date: string; delivery_address: string; payment_terms: string; notes: string };
const EMPTY_FORM: OrderForm = { order_number: "", organization_id: null, organization_name: "", contact_id: null, contact_name: "", opportunity_id: null, opportunity_name: "", owner_id: null, owner_name: "", status: "draft", currency: "USD", delivery_date: "", delivery_address: "", payment_terms: "", notes: "" };
const STATUSES = [{ value: "draft", label: "Draft" }, { value: "confirmed", label: "Confirmed" }, { value: "fulfilled", label: "Fulfilled" }, { value: "cancelled", label: "Cancelled" }];

type OrderSeed = { form: OrderForm; items: TransactionLineItem[] };

async function fetchOrderForEdit(orderId: string) {
  const res = await apiFetch(`/sales/orders/${orderId}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? "We could not load this order.");
  return body as Order;
}

function orderSeed(order?: Order): OrderSeed {
  if (!order) return { form: EMPTY_FORM, items: [createTransactionLineItem("order")] };
  return {
    form: {
      order_number: order.order_number,
      organization_id: order.organization_id,
      organization_name: order.organization_name ?? "",
      contact_id: order.contact_id,
      contact_name: order.contact_name ?? "",
      opportunity_id: order.opportunity_id,
      opportunity_name: order.opportunity_name ?? "",
      owner_id: order.owner_id,
      owner_name: order.owner_name ?? "",
      status: order.status,
      currency: order.currency,
      delivery_date: order.delivery_date ?? "",
      delivery_address: order.delivery_address ?? "",
      payment_terms: order.payment_terms ?? "",
      notes: order.notes ?? "",
    },
    items: order.items?.length ? order.items.map((item) => ({ ...createTransactionLineItem("order"), name: item.name, description: item.description ?? "", quantity: String(item.quantity), unit_price: String(item.unit_price), discount_amount: String(item.discount_amount), tax_amount: String(item.tax_amount) })) : [createTransactionLineItem("order")],
  };
}

export default function OrderRecordFormPage({ mode = "create", orderId }: { mode?: "create" | "edit"; orderId?: string }) {
  const query = useQuery({ queryKey: ["sales-order-edit", orderId], queryFn: () => fetchOrderForEdit(orderId as string), enabled: mode === "edit" && Boolean(orderId), staleTime: 30_000 });
  if (mode === "edit" && query.isLoading) return <div className="space-y-6"><Skeleton className="h-16 w-full" /><Skeleton className="h-[640px] w-full rounded-[var(--radius-card)]" /></div>;
  if (mode === "edit" && query.error) return <div role="alert" className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted p-6"><h1 className="text-lg font-semibold text-copy-primary">Unable to load order</h1><p className="mt-2 text-sm text-copy-secondary">It may have been deleted or you may not have access.</p><Button className="mt-4" asChild variant="outline"><Link href="/dashboard/sales/orders">Back to orders</Link></Button></div>;
  const seed = orderSeed(query.data);
  return <OrderRecordFormEditor key={`${mode}:${orderId ?? "new"}:${query.data?.updated_at ?? ""}`} mode={mode} orderId={orderId} seed={seed} />;
}

function OrderRecordFormEditor({ mode, orderId, seed }: { mode: "create" | "edit"; orderId?: string; seed: OrderSeed }) {
  const router = useRouter(); const queryClient = useQueryClient(); const currencies = useCompanyCurrencies(true);
  const [form, setForm] = useState<OrderForm>(seed.form); const [items, setItems] = useState<TransactionLineItem[]>(seed.items); const [initialSnapshot] = useState(() => JSON.stringify([seed.form, seed.items]));
  const [customerError, setCustomerError] = useState<string | null>(null); const [itemsError, setItemsError] = useState<string | null>(null); const [submitError, setSubmitError] = useState<string | null>(null); const [submitting, setSubmitting] = useState(false);
  const totals = useMemo(() => calculateTransactionTotals(items), [items]); const snapshot = useMemo(() => JSON.stringify([form, items]), [form, items]); const dirty = snapshot !== initialSnapshot;
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (!dirty || submitting) return; event.preventDefault(); }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty, submitting]);
  function validate() { const validCustomer = Boolean(form.organization_id || form.contact_id); const validItems = areTransactionItemsValid(items); setCustomerError(validCustomer ? null : "Select an account or contact for this order."); setItemsError(validItems ? null : "Each line needs a name, positive quantity, and valid non-negative amounts."); if (!validCustomer) document.getElementById("order-customer-anchor")?.focus(); else if (!validItems) document.querySelector<HTMLInputElement>("[data-transaction-field='name']")?.focus(); return validCustomer && validItems; }
  async function submit() { if (!validate()) return; try { setSubmitting(true); setSubmitError(null); const res = await apiFetch(mode === "edit" ? `/sales/orders/${orderId}` : "/sales/orders", { method: mode === "edit" ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_number: form.order_number.trim() || null, organization_id: form.organization_id, contact_id: form.contact_id, opportunity_id: form.opportunity_id, owner_id: form.owner_id, status: form.status, currency: form.currency, delivery_date: form.delivery_date || null, delivery_address: form.delivery_address.trim() || null, payment_terms: form.payment_terms.trim() || null, notes: form.notes.trim() || null, items: serializeTransactionItems(items) }) }); const body = await res.json().catch(() => null) as { id?: number; detail?: string } | null; if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`); await Promise.all([queryClient.invalidateQueries({ queryKey: ["sales-orders"] }), queryClient.invalidateQueries({ queryKey: ["sales-order-edit", orderId] })]); toast.success(mode === "edit" ? "Order updated." : "Order created."); const targetId = body?.id ?? (orderId ? Number(orderId) : null); router.push(targetId ? `/dashboard/sales/orders/${targetId}` : "/dashboard/sales/orders"); } catch (error) { setSubmitError(error instanceof Error ? error.message : `Failed to ${mode === "edit" ? "update" : "create"} order`); } finally { setSubmitting(false); } }
  const backHref = mode === "edit" && orderId ? `/dashboard/sales/orders/${orderId}` : "/dashboard/sales/orders";
  return <div className="flex flex-col gap-6"><PageHeader title={mode === "edit" ? `Edit ${form.order_number}` : "Create order"} description={mode === "edit" ? "Update customer links, line items, fulfillment details, and ownership." : "Create an itemized order with customer, fulfillment, and payment context."} actions={<Button asChild variant="ghost" size="sm"><Link href={backHref}><ArrowLeft />Back to {mode === "edit" ? "order" : "orders"}</Link></Button>} />{submitError ? <div role="alert" className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary"><div className="font-medium">We could not {mode === "edit" ? "update" : "create"} this order.</div><div className="mt-1 text-copy-secondary">{submitError}</div></div> : null}<RecordFormLayout sidebar={<OrderSidebar form={form} onChange={setForm} totals={totals} currencies={currencies.data ?? ["USD"]} mode={mode} />} footer={<div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-copy-muted">{dirty ? "You have unsaved changes." : mode === "edit" ? "No unsaved changes." : "Add a customer and line items to create this order."}</span><div className="flex items-center gap-2"><Button asChild variant="outline"><Link href={backHref}>Cancel</Link></Button><Button onClick={() => void submit()} disabled={submitting}><Save />{submitting ? "Saving…" : mode === "edit" ? "Save changes" : "Create order"}</Button></div></div>}>
    <FormSection title="Customer and billing details" description="Link this order to the customer records used throughout the CRM."><span id="order-customer-anchor" tabIndex={-1} />{customerError ? <FieldError>{customerError}</FieldError> : null}<div className="mt-3 grid gap-4 md:grid-cols-2"><Field><FieldLabel>Account <RequiredMark /></FieldLabel><LinkedRecordPicker recordType="organization" valueId={form.organization_id} displayValue={form.organization_name} onDisplayValueChange={(organization_name) => setForm({ ...form, organization_id: null, organization_name, contact_id: null, contact_name: "", opportunity_id: null, opportunity_name: "" })} onSelect={(option) => { setCustomerError(null); setForm({ ...form, organization_id: option.id, organization_name: option.label, contact_id: null, contact_name: "", opportunity_id: null, opportunity_name: "" }); }} onClear={() => setForm({ ...form, organization_id: null, organization_name: "", contact_id: null, contact_name: "", opportunity_id: null, opportunity_name: "" })} placeholder="Search accounts" queryKeyPrefix="order-page-account" /></Field><Field><FieldLabel>Contact <RequiredMark /></FieldLabel><LinkedRecordPicker recordType="contact" valueId={form.contact_id} displayValue={form.contact_name} onDisplayValueChange={(contact_name) => setForm({ ...form, contact_id: null, contact_name, opportunity_id: null, opportunity_name: "" })} onSelect={(option) => { setCustomerError(null); setForm({ ...form, contact_id: option.id, contact_name: option.label, organization_id: option.organization_id ?? form.organization_id, organization_name: option.organization_name ?? form.organization_name }); }} onClear={() => setForm({ ...form, contact_id: null, contact_name: "" })} placeholder="Search contacts" queryKeyPrefix="order-page-contact" filters={{ organizationId: form.organization_id }} /></Field><Field className="md:col-span-2"><FieldLabel>Deal</FieldLabel><LinkedRecordPicker recordType="opportunity" valueId={form.opportunity_id} displayValue={form.opportunity_name} onDisplayValueChange={(opportunity_name) => setForm({ ...form, opportunity_id: null, opportunity_name })} onSelect={(option) => { setCustomerError(null); setForm({ ...form, opportunity_id: option.id, opportunity_name: option.label, contact_id: option.contact_id ?? form.contact_id, organization_id: option.organization_id ?? form.organization_id }); }} onClear={() => setForm({ ...form, opportunity_id: null, opportunity_name: "" })} placeholder="Search deals" queryKeyPrefix="order-page-deal" filters={{ contactId: form.contact_id, organizationId: form.organization_id }} /><FieldDescription>Orders linked to accepted quotes should continue to use the quote conversion action.</FieldDescription></Field></div></FormSection>
    <TransactionLineItemsEditor items={items} onChange={(nextItems) => { setItems(nextItems); setItemsError(null); }} currency={form.currency} error={itemsError} idPrefix="order" />
    <FormSection title="Delivery and payment details" description="Set fulfillment expectations and customer-facing payment terms."><div className="grid gap-4 md:grid-cols-2"><Field><FieldLabel htmlFor="order-delivery-date">Delivery date</FieldLabel><Input id="order-delivery-date" type="date" value={form.delivery_date} onChange={(event) => setForm({ ...form, delivery_date: event.target.value })} /></Field><Field><FieldLabel htmlFor="order-payment-terms">Payment terms</FieldLabel><Input id="order-payment-terms" value={form.payment_terms} onChange={(event) => setForm({ ...form, payment_terms: event.target.value })} placeholder="Net 30" /></Field><Field className="md:col-span-2"><FieldLabel htmlFor="order-delivery-address">Delivery address</FieldLabel><Textarea id="order-delivery-address" rows={4} value={form.delivery_address} onChange={(event) => setForm({ ...form, delivery_address: event.target.value })} /></Field></div></FormSection>
    <FormSection title="Terms and notes" description="Internal or fulfillment notes associated with this order."><Field><FieldLabel htmlFor="order-notes">Notes</FieldLabel><Textarea id="order-notes" rows={6} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field></FormSection>
  </RecordFormLayout></div>;
}

function OrderSidebar({ form, onChange, totals, currencies, mode }: { form: OrderForm; onChange: (form: OrderForm) => void; totals: ReturnType<typeof calculateTransactionTotals>; currencies: string[]; mode: "create" | "edit" }) { return <><FormSection title="Review summary" description="Totals are calculated from the items and verified by the server."><dl className="space-y-3"><SummaryRow label="Subtotal" value={formatTransactionMoney(totals.subtotal, form.currency)} /><SummaryRow label="Discount" value={`− ${formatTransactionMoney(totals.discount, form.currency)}`} /><SummaryRow label="Tax" value={formatTransactionMoney(totals.tax, form.currency)} /><div className="border-t border-line-default pt-3"><SummaryRow label="Total" value={formatTransactionMoney(totals.total, form.currency)} strong /></div></dl></FormSection><FormSection title="Order settings" description="Control numbering, currency, and lifecycle status."><div className="space-y-4"><Field><FieldLabel htmlFor="order-number">Order number</FieldLabel><Input id="order-number" value={form.order_number} onChange={(event) => onChange({ ...form, order_number: event.target.value })} placeholder="Auto-generated if blank" /></Field><Field><FieldLabel>Currency</FieldLabel><Select value={form.currency} onValueChange={(currency) => onChange({ ...form, currency })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{currencies.map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}</SelectContent></Select></Field><Field><FieldLabel>Status</FieldLabel><Select value={form.status} onValueChange={(status) => onChange({ ...form, status })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{STATUSES.map((status) => <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>)}</SelectContent></Select></Field></div></FormSection><FormSection title="Ownership" description="Assign responsibility for fulfillment."><Field><FieldLabel>Owner</FieldLabel><LinkedRecordPicker recordType="user" valueId={form.owner_id} displayValue={form.owner_name} onDisplayValueChange={(owner_name) => onChange({ ...form, owner_id: null, owner_name })} onSelect={(option) => onChange({ ...form, owner_id: option.id, owner_name: option.label })} onClear={() => onChange({ ...form, owner_id: null, owner_name: "" })} placeholder="Search owners (defaults to you)" queryKeyPrefix="order-page-owner" sourceModuleKey="sales_orders" sourceAction={mode === "edit" ? "edit" : "create"} /></Field></FormSection></>; }
function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) { return <div className={`flex items-center justify-between gap-3 ${strong ? "text-base font-semibold text-copy-primary" : "text-sm text-copy-secondary"}`}><dt>{label}</dt><dd className="tabular-nums">{value}</dd></div>; }
