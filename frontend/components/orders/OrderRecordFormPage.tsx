"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";

import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { OwnerSelect } from "@/components/forms/OwnerSelect";
import { FormErrorBanner } from "@/components/forms/FormErrorBanner";
import { customFieldInputId, ServerFieldErrorsProvider, useServerFormErrors } from "@/components/forms/ServerFieldErrors";
import {
  FormSection,
  RecordFormLayout,
} from "@/components/forms/RecordFormLayout";
import { useRecordTabHref } from "@/components/recordWorkspace/RecordWorkspace";
import {
  areTransactionItemsValid,
  calculateTransactionTotals,
  createTransactionLineItem,
  serializeTransactionItems,
  transactionCatalogLink,
  TransactionLineItemsEditor,
  type TransactionLineItem,
} from "@/components/transactions/TransactionLineItemsEditor";
import { TransactionTotals } from "@/components/transactions/TransactionTotals";
import {
  DocumentAddressesSection,
  documentHeaderFrom,
  documentHeaderInputId,
  documentHeaderPayload,
  DocumentTermsSection,
  EMPTY_DOCUMENT_HEADER,
  shippingChargeAmount,
  type DocumentHeaderValue,
} from "@/components/transactions/DocumentHeaderFields";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import {
  RouteErrorState,
  RouteLoadingState,
} from "@/components/ui/RouteStates";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useBaseCurrency, useCompanyCurrencies } from "@/hooks/useCompanyCurrencies";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { useWarehouses } from "@/hooks/inventory/useInventory";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import type { Order } from "@/hooks/sales/useOrders";
import { apiFetch } from "@/lib/api";
import { apiErrorFromResponse } from "@/lib/apiErrors";
import { formatDateTime } from "@/lib/datetime";
import { fetchDealForDocument, type DealForDocument } from "@/components/transactions/dealPrefill";
import { RecordCustomFieldsSection } from "@/components/customFields/RecordCustomFields";

type OrderForm = {
  order_number: string;
  organization_id: number | null;
  organization_name: string;
  contact_id: number | null;
  contact_name: string;
  opportunity_id: number | null;
  opportunity_name: string;
  owner_id: number | null;
  owner_name: string;
  status: string;
  currency: string;
  /** E6: base units per one order-currency unit, for margin (12d §3.3). */
  exchange_rate: string;
  delivery_date: string;
  header: DocumentHeaderValue;
  payment_terms: string;
  notes: string;
  warehouse_id: number | null;
  priority: string;
  custom_fields: Record<string, unknown>;
};
const EMPTY_FORM: OrderForm = {
  order_number: "",
  organization_id: null,
  organization_name: "",
  contact_id: null,
  contact_name: "",
  opportunity_id: null,
  opportunity_name: "",
  owner_id: null,
  owner_name: "",
  status: "draft",
  currency: "USD",
  exchange_rate: "",
  delivery_date: "",
  header: EMPTY_DOCUMENT_HEADER,
  payment_terms: "",
  notes: "",
  custom_fields: {},
  warehouse_id: null,
  priority: "normal",
};
const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "confirmed", label: "Confirmed" },
  { value: "fulfilled", label: "Fulfilled" },
  { value: "cancelled", label: "Cancelled" },
];

type OrderSeed = { form: OrderForm; items: TransactionLineItem[] };

async function fetchOrderForEdit(orderId: string) {
  const res = await apiFetch(`/sales/orders/${orderId}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error("We could not load this order.");
  return body as Order;
}

function orderSeed(order?: Order, deal?: DealForDocument | null): OrderSeed {
  if (!order)
    return {
      // *Create order* on a deal (13a H13): the deal's customer, currency and link.
      form: deal
        ? {
            ...EMPTY_FORM,
            organization_id: deal.organization_id ?? null,
            organization_name: deal.organization_name ?? "",
            contact_id: deal.contact_id ?? null,
            contact_name: deal.contact_name ?? "",
            opportunity_id: deal.opportunity_id,
            opportunity_name: deal.opportunity_name,
            currency: deal.currency_type || EMPTY_FORM.currency,
          }
        : EMPTY_FORM,
      items: [createTransactionLineItem("order")],
    };
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
      exchange_rate: order.exchange_rate ?? order.suggested_exchange_rate ?? "",
      delivery_date: order.delivery_date ?? "",
      header: documentHeaderFrom(order as unknown as Record<string, unknown>),
      payment_terms: order.payment_terms ?? "",
      notes: order.notes ?? "",
      warehouse_id: order.warehouse_id ?? null,
      priority: order.priority ?? "normal",
      custom_fields: order.custom_fields ?? {},
    },
    items: order.items?.length
      ? order.items.map((item) => ({
          ...createTransactionLineItem("order"),
          id: item.id,
          ...transactionCatalogLink(item),
          name: item.name,
          description: item.description ?? "",
          quantity: String(item.quantity),
          unit_price: String(item.unit_price),
          discount_amount: String(item.discount_amount),
          tax_amount: String(item.tax_amount),
        }))
      : [createTransactionLineItem("order")],
  };
}

export default function OrderRecordFormPage({
  mode = "create",
  orderId,
}: {
  mode?: "create" | "edit";
  orderId?: string;
}) {
  const query = useQuery({
    queryKey: ["sales-order-edit", orderId],
    queryFn: () => fetchOrderForEdit(orderId as string),
    enabled: mode === "edit" && Boolean(orderId),
    staleTime: 30_000,
  });
  const dealId = useSearchParams().get("opportunity_id");
  const dealQuery = useQuery({
    queryKey: ["document-deal-prefill", dealId],
    queryFn: () => fetchDealForDocument(dealId as string),
    enabled: mode === "create" && Boolean(dealId),
    staleTime: 30_000,
  });
  if (mode === "edit" && query.isLoading) return <RouteLoadingState />;
  if (mode === "create" && dealId && dealQuery.isLoading) return <RouteLoadingState />;
  if (mode === "edit" && query.error)
    return (
      <RouteErrorState
        title="Order could not be loaded"
        reset={() => void query.refetch()}
        backHref="/dashboard/sales/orders"
        backLabel="Back to orders"
      />
    );
  const seed = orderSeed(query.data, dealQuery.data);
  return (
    <OrderRecordFormEditor
      key={`${mode}:${orderId ?? "new"}:${query.data?.updated_at ?? ""}:${dealQuery.data?.opportunity_id ?? ""}`}
      mode={mode}
      orderId={orderId}
      seed={seed}
      updatedAt={query.data?.updated_at}
    />
  );
}

function OrderRecordFormEditor({
  mode,
  orderId,
  seed,
  updatedAt,
}: {
  mode: "create" | "edit";
  orderId?: string;
  seed: OrderSeed;
  updatedAt?: string | null;
}) {
  const router = useRouter();
  // R2 travels in both directions: the tab the operator left is on this page's own URL,
  // so Back, Cancel and the post-save redirect all return to it.
  const listHref = "/dashboard/sales/orders";
  const backHref = useRecordTabHref(mode === "edit" && orderId ? `${listHref}/${orderId}` : listHref);
  const queryClient = useQueryClient();
  const currencies = useCompanyCurrencies(true);
  const baseCurrency = useBaseCurrency().data ?? currencies.data?.[0] ?? "USD";
  const [form, setForm] = useState<OrderForm>(seed.form);
  const { modules } = useAccessibleModules();
  const canViewStock = Boolean(modules.find((module) => module.name === "inventory_stock")?.actions?.can_view);
  const warehousesQuery = useWarehouses(false, canViewStock);
  // A tenant with one warehouse never sees the choice (12-erp-inventory.md §4.2).
  const warehouseOptions = (warehousesQuery.data ?? []).filter((warehouse) => warehouse.is_active || warehouse.id === form.warehouse_id);
  const showWarehouse = warehouseOptions.length > 1;
  const warehouseLocked = form.status === "fulfilled" || form.status === "cancelled";
  const [items, setItems] = useState<TransactionLineItem[]>(seed.items);
  const [initialSnapshot] = useState(() =>
    JSON.stringify([seed.form, seed.items]),
  );
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const inputIdFor = useCallback(
    (path: string) => documentHeaderInputId("order", path) ?? customFieldInputId("sales_orders", path),
    [],
  );
  const serverErrors = useServerFormErrors(inputIdFor);
  const [submitting, setSubmitting] = useState(false);
  const totals = useMemo(() => calculateTransactionTotals(items), [items]);
  const shippingCharge = shippingChargeAmount(form.header);
  const snapshot = useMemo(() => JSON.stringify([form, items]), [form, items]);
  const dirty = snapshot !== initialSnapshot;
  useUnsavedChangesGuard(dirty, submitting);
  function validate() {
    const validCustomer = Boolean(form.organization_id || form.contact_id);
    const validItems = areTransactionItemsValid(items);
    setCustomerError(
      validCustomer ? null : "Select an account or contact for this order.",
    );
    setItemsError(
      validItems
        ? null
        : "Each line needs a name, positive quantity, and valid non-negative amounts.",
    );
    if (!validCustomer) document.getElementById("order-account")?.focus();
    else if (!validItems)
      document
        .querySelector<HTMLInputElement>("[data-transaction-field='name']")
        ?.focus();
    return validCustomer && validItems;
  }
  async function submit() {
    if (!validate()) return;
    try {
      setSubmitting(true);
      serverErrors.clear();
      const res = await apiFetch(
        mode === "edit" ? `/sales/orders/${orderId}` : "/sales/orders",
        {
          method: mode === "edit" ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order_number: form.order_number.trim() || null,
            organization_id: form.organization_id,
            contact_id: form.contact_id,
            opportunity_id: form.opportunity_id,
            owner_id: form.owner_id,
            status: form.status,
            currency: form.currency,
            exchange_rate: form.currency !== baseCurrency && Number(form.exchange_rate) > 0 ? form.exchange_rate : null,
            delivery_date: form.delivery_date || null,
            ...documentHeaderPayload(form.header),
            payment_terms: form.payment_terms.trim() || null,
            notes: form.notes.trim() || null,
            ...(form.warehouse_id ? { warehouse_id: form.warehouse_id } : {}),
            priority: form.priority,
            custom_fields: form.custom_fields,
            items: serializeTransactionItems(items),
          }),
        },
      );
      if (!res.ok) {
        // A stock refusal ("Insufficient available stock … short by 2") is the operator's
        // next step, so it is shown as the server wrote it.
        throw await apiErrorFromResponse(res, "Check the form and your connection, then try again.");
      }
      const body = (await res.json().catch(() => null)) as { id?: number } | null;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-order-fulfilment"] }),
        queryClient.invalidateQueries({
          queryKey: ["sales-order-edit", orderId],
        }),
      ]);
      toast.success(mode === "edit" ? "Order updated." : "Order created.");
      const targetId = body?.id ?? (orderId ? Number(orderId) : null);
      router.push(mode === "edit" ? backHref : (targetId ? `${listHref}/${targetId}` : listHref));
    } catch (error) {
      serverErrors.report(error, "Check the form and your connection, then try again.");
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <PageShell
      eyebrow={
        mode === "edit" && updatedAt
          ? `Last modified ${formatDateTime(updatedAt)}`
          : undefined
      }
      title={mode === "edit" ? `Edit ${form.order_number}` : "Create order"}
      description={
        mode === "edit"
          ? "Update customer links, line items, fulfilment details, and ownership."
          : "Create an itemized order with customer, fulfilment, and payment context."
      }
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link href={backHref}>
            <ArrowLeft />
            Back to {mode === "edit" ? "order" : "orders"}
          </Link>
        </Button>
      }
    >
      {serverErrors.message ? (
        <FormErrorBanner title={`We could not ${mode === "edit" ? "update" : "create"} this order.`}>{serverErrors.message}</FormErrorBanner>
      ) : null}
      <ServerFieldErrorsProvider errors={serverErrors.errors} inputIdFor={inputIdFor}>
      <RecordFormLayout
        title={mode === "edit" ? form.order_number : "Create order"}
        sidebar={
          <OrderSidebar
            form={form}
            onChange={setForm}
            totals={totals}
            shippingCharge={shippingCharge}
            currencies={currencies.data ?? ["USD"]}
            baseCurrency={baseCurrency}
            mode={mode}
          />
        }
        status={dirty
          ? "Unsaved changes"
          : mode === "edit"
          ? null
          : "Add a customer and line items to create this order."}
        actions={(
          <>
            <Button asChild variant="outline">
              <Link href={backHref}>Cancel</Link>
            </Button>
            <Button onClick={() => void submit()} disabled={submitting}>
              <Save />
              {submitting
                ? "Saving…"
                : mode === "edit"
                  ? "Save changes"
                  : "Create order"}
            </Button>
          </>
        )}
      >
        {/* The requirement is `account || contact`, which no per-field `RequiredMark` can
            state — and the backend requires neither, so two marks made a claim that was
            wrong twice over (design.md §4.7). It is stated once in the description and
            enforced by the section's own `role="alert"`. */}
        <FormSection
          title="Customer and billing details"
          description="Link this order to the customer records used throughout the CRM. An account or a contact is required."
        >
          {customerError ? (
            <FieldError className="mb-3">{customerError}</FieldError>
          ) : null}
          <FieldGroup columns={2}>
            <Field>
              <FieldLabel htmlFor="order-account">Account</FieldLabel>
              <LinkedRecordPicker
                inputId="order-account"
                ariaInvalid={Boolean(customerError)}
                recordType="organization"
                valueId={form.organization_id}
                displayValue={form.organization_name}
                onDisplayValueChange={(organization_name) =>
                  setForm({
                    ...form,
                    organization_id: null,
                    organization_name,
                    contact_id: null,
                    contact_name: "",
                    opportunity_id: null,
                    opportunity_name: "",
                  })
                }
                onSelect={(option) => {
                  setCustomerError(null);
                  setForm({
                    ...form,
                    organization_id: option.id,
                    organization_name: option.label,
                    contact_id: null,
                    contact_name: "",
                    opportunity_id: null,
                    opportunity_name: "",
                  });
                }}
                onClear={() =>
                  setForm({
                    ...form,
                    organization_id: null,
                    organization_name: "",
                    contact_id: null,
                    contact_name: "",
                    opportunity_id: null,
                    opportunity_name: "",
                  })
                }
                placeholder="Search accounts"
                queryKeyPrefix="order-page-account"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="order-contact">Contact</FieldLabel>
              <LinkedRecordPicker
                inputId="order-contact"
                ariaInvalid={Boolean(customerError)}
                recordType="contact"
                valueId={form.contact_id}
                displayValue={form.contact_name}
                onDisplayValueChange={(contact_name) =>
                  setForm({
                    ...form,
                    contact_id: null,
                    contact_name,
                    opportunity_id: null,
                    opportunity_name: "",
                  })
                }
                onSelect={(option) => {
                  setCustomerError(null);
                  setForm({
                    ...form,
                    contact_id: option.id,
                    contact_name: option.label,
                    organization_id:
                      option.organization_id ?? form.organization_id,
                    organization_name:
                      option.organization_name ?? form.organization_name,
                  });
                }}
                onClear={() =>
                  setForm({ ...form, contact_id: null, contact_name: "" })
                }
                placeholder="Search contacts"
                queryKeyPrefix="order-page-contact"
                filters={{ organizationId: form.organization_id }}
              />
            </Field>
            <Field className="md:col-span-2">
              <FieldLabel htmlFor="order-deal">Deal</FieldLabel>
              <LinkedRecordPicker
                inputId="order-deal"
                recordType="opportunity"
                valueId={form.opportunity_id}
                displayValue={form.opportunity_name}
                onDisplayValueChange={(opportunity_name) =>
                  setForm({ ...form, opportunity_id: null, opportunity_name })
                }
                onSelect={(option) => {
                  setCustomerError(null);
                  setForm({
                    ...form,
                    opportunity_id: option.id,
                    opportunity_name: option.label,
                    contact_id: option.contact_id ?? form.contact_id,
                    organization_id:
                      option.organization_id ?? form.organization_id,
                  });
                }}
                onClear={() =>
                  setForm({
                    ...form,
                    opportunity_id: null,
                    opportunity_name: "",
                  })
                }
                placeholder="Search deals"
                queryKeyPrefix="order-page-deal"
                filters={{
                  contactId: form.contact_id,
                  organizationId: form.organization_id,
                }}
              />
              <FieldDescription>
                Orders linked to accepted quotes should continue to use the
                quote conversion action.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </FormSection>
        <TransactionLineItemsEditor
          items={items}
          onChange={(nextItems) => {
            setItems(nextItems);
            setItemsError(null);
          }}
          currency={form.currency}
          error={itemsError}
          idPrefix="order"
        />
        <FormSection
          title="Fulfilment"
          description="Set fulfilment expectations and customer-facing payment terms."
        >
          <FieldGroup columns={2}>
            {showWarehouse ? (
              <Field className="md:col-span-2">
                <FieldLabel htmlFor="order-warehouse">Warehouse</FieldLabel>
                <Select
                  value={String(form.warehouse_id ?? warehouseOptions.find((warehouse) => warehouse.is_default)?.id ?? "")}
                  onValueChange={(value) => setForm({ ...form, warehouse_id: Number(value) })}
                  disabled={warehouseLocked}
                >
                  <SelectTrigger id="order-warehouse"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {warehouseOptions.map((warehouse) => (
                      <SelectItem key={warehouse.id} value={String(warehouse.id)}>{warehouse.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {warehouseLocked ? "Stock has already left this warehouse." : "Stock is reserved and shipped from here."}
                </FieldDescription>
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor="order-priority">Priority</FieldLabel>
              <Select value={form.priority} onValueChange={(value) => setForm({ ...form, priority: value })}>
                <SelectTrigger id="order-priority"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>Arriving stock goes to waiting orders by priority, then oldest first.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="order-delivery-date">
                Delivery date
              </FieldLabel>
              <Input
                id="order-delivery-date"
                type="date"
                value={form.delivery_date}
                onChange={(event) =>
                  setForm({ ...form, delivery_date: event.target.value })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="order-payment-terms">
                Payment terms
              </FieldLabel>
              <Input
                id="order-payment-terms"
                value={form.payment_terms}
                onChange={(event) =>
                  setForm({ ...form, payment_terms: event.target.value })
                }
                placeholder="Net 30"
              />
            </Field>
          </FieldGroup>
        </FormSection>
        <DocumentAddressesSection idPrefix="order" value={form.header} onChange={(header) => setForm({ ...form, header })} />
        <DocumentTermsSection
          idPrefix="order"
          value={form.header}
          onChange={(header) => setForm({ ...form, header })}
          showLostReason={form.status === "cancelled"}
          lostReasonLabel="Cancellation reason"
        />
        <FormSection
          title="Terms and notes"
          description="Internal or fulfilment notes associated with this order."
        >
          <Field>
            <FieldLabel htmlFor="order-notes">Notes</FieldLabel>
            <Textarea
              id="order-notes"
              rows={6}
              value={form.notes}
              onChange={(event) =>
                setForm({ ...form, notes: event.target.value })
              }
            />
          </Field>
        </FormSection>
      </RecordFormLayout>
      </ServerFieldErrorsProvider>
    </PageShell>
  );
}

function OrderSidebar({
  form,
  onChange,
  totals,
  shippingCharge,
  currencies,
  baseCurrency,
  mode,
}: {
  form: OrderForm;
  onChange: (form: OrderForm) => void;
  totals: ReturnType<typeof calculateTransactionTotals>;
  shippingCharge: number;
  currencies: string[];
  baseCurrency: string;
  mode: "create" | "edit";
}) {
  return (
    <>
      <TransactionTotals
        description="Totals are calculated from the items and verified by the server."
        currency={form.currency}
        rows={[
          { label: "Subtotal", amount: totals.subtotal },
          { label: "Discount", amount: totals.discount, negative: true },
          { label: "Tax", amount: totals.tax },
          ...(shippingCharge ? [{ label: "Shipping", amount: shippingCharge }] : []),
          { label: "Total", amount: totals.total + shippingCharge, resolved: true },
        ]}
      />
      <FormSection
        title="Order details"
        description="Control numbering, currency, and lifecycle status."
      >
        <div className="space-y-4">
          <Field>
            <FieldLabel htmlFor="order-number">Order number</FieldLabel>
            <Input
              id="order-number"
              value={form.order_number}
              onChange={(event) =>
                onChange({ ...form, order_number: event.target.value })
              }
              placeholder="Auto-generated if blank"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="order-currency">Currency</FieldLabel>
            <Select
              value={form.currency}
              onValueChange={(currency) => onChange({ ...form, currency })}
            >
              <SelectTrigger id="order-currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {currencies.map((currency) => (
                  <SelectItem key={currency} value={currency}>
                    {currency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {form.currency !== baseCurrency ? (
            <Field>
              <FieldLabel htmlFor="order-exchange-rate">Exchange rate</FieldLabel>
              <Input
                id="order-exchange-rate"
                type="number"
                min="0"
                step="0.00000001"
                inputMode="decimal"
                value={form.exchange_rate}
                onChange={(event) => onChange({ ...form, exchange_rate: event.target.value })}
                aria-describedby="order-exchange-rate-description"
              />
              <FieldDescription id="order-exchange-rate-description">
                {baseCurrency} for one {form.currency}. Optional: used to show this order&apos;s margin in {baseCurrency}.
              </FieldDescription>
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="order-status">Status</FieldLabel>
            <Select
              value={form.status}
              onValueChange={(status) => onChange({ ...form, status })}
            >
              <SelectTrigger id="order-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((status) => (
                  <SelectItem key={status.value} value={status.value}>
                    {status.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </FormSection>
      <FormSection
        title="Ownership"
        description="Assign responsibility for fulfilment."
      >
        <Field>
          <FieldLabel htmlFor="order-owner">Owner</FieldLabel>
          <OwnerSelect
            id="order-owner"
            moduleKey="sales_orders"
            action={mode === "edit" ? "edit" : "create"}
            ownerId={form.owner_id}
            ownerName={form.owner_name}
            onChange={(owner_id, owner_name) =>
              onChange({ ...form, owner_id, owner_name })
            }
          />
        </Field>
      </FormSection>
      <RecordCustomFieldsSection moduleKey="sales_orders" values={form.custom_fields} onChange={(custom_fields) => onChange({ ...form, custom_fields })} />
    </>
  );
}
