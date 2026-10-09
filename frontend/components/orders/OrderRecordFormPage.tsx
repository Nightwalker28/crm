"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";

import { FormErrorBanner } from "@/components/forms/FormErrorBanner";
import { LayoutRecordFormBody } from "@/components/forms/LayoutRecordFormBody";
import type { RecordFormFieldContext, RecordFormValue } from "@/components/forms/RecordForm";
import { QuickCreateField, validateLayoutDrivenQuickCreate } from "@/components/forms/quickCreateLayout";
import {
  customFieldInputId,
  ServerFieldError,
  ServerFieldErrorsProvider,
  useServerFormErrors,
} from "@/components/forms/ServerFieldErrors";
import {
  FormSection,
  RecordFormLayout,
} from "@/components/forms/RecordFormLayout";
import { PicklistField } from "@/components/picklists/PicklistSelect";
import { useRecordTabHref } from "@/components/recordWorkspace/RecordWorkspace";
import {
  areTransactionItemsValid,
  calculateTransactionTotals,
  createTransactionLineItem,
  serializeTransactionItems,
  transactionCatalogLink,
  transactionItemsFromCopy,
  transactionLineFields,
  transactionTaxFields,
  TransactionLineItemsEditor,
  useTransactionTax,
  type TransactionLineItem,
} from "@/components/transactions/TransactionLineItemsEditor";
import { TransactionTotals } from "@/components/transactions/TransactionTotals";
import { customerFieldRenderer } from "@/components/transactions/customerFieldRenderer";
import {
  documentHeaderFrom,
  documentHeaderInputId,
  documentHeaderPayload,
  EMPTY_DOCUMENT_HEADER,
  SameAsBillingButton,
  shippingChargeAmount,
} from "@/components/transactions/DocumentHeaderFields";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
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
import { useDefaultTaxMode, type TaxMode } from "@/hooks/finance/useTaxRates";
import { useCloneDraft, type CloneDraft } from "@/hooks/useCloneDraft";
import { useBaseCurrency, useCompanyCurrencies } from "@/hooks/useCompanyCurrencies";
import { useResolvedRecordLayout, type ResolvedRecordLayoutField } from "@/hooks/useResolvedRecordLayout";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { useWarehouses } from "@/hooks/inventory/useInventory";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import type { Order } from "@/hooks/sales/useOrders";
import { apiFetch } from "@/lib/api";
import { apiErrorFromResponse } from "@/lib/apiErrors";
import { formatDateTime } from "@/lib/datetime";
import { formValuesFromCopy } from "@/lib/formValues";
import { fetchDealForDocument, type DealForDocument } from "@/components/transactions/dealPrefill";

/** The order form's value: flat, keyed by field key, as `RecordForm` draws it (13b Phase 4e). */
type OrderForm = RecordFormValue & {
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
  payment_terms: string;
  notes: string;
  warehouse_id: number | null;
  warehouse_name: string;
  priority: string;
  /** "" until chosen: the company's default applies (13d §3.1). */
  tax_mode: string;
};
const EMPTY_FORM: OrderForm = {
  ...EMPTY_DOCUMENT_HEADER,
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
  currency: "",
  exchange_rate: "",
  delivery_date: "",
  payment_terms: "",
  notes: "",
  warehouse_id: null,
  warehouse_name: "",
  priority: "normal",
  tax_mode: "",
};
const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "confirmed", label: "Confirmed" },
  { value: "fulfilled", label: "Fulfilled" },
  { value: "cancelled", label: "Cancelled" },
];
const PRIORITIES = [
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

/** The ids these inputs had before the layout drew them; specs and focus still use them. */
const ORDER_INPUT_IDS: Record<string, string> = {
  organization_id: "order-account",
  contact_id: "order-contact",
  opportunity_id: "order-deal",
  warehouse_id: "order-warehouse",
  priority: "order-priority",
  delivery_date: "order-delivery-date",
  payment_terms: "order-payment-terms",
  notes: "order-notes",
  order_number: "order-number",
  currency: "order-currency",
  exchange_rate: "order-exchange-rate",
  status: "order-status",
  owner_id: "order-owner",
};

function orderInputId(fieldKey: string) {
  return ORDER_INPUT_IDS[fieldKey] ?? documentHeaderInputId("order", fieldKey) ?? `order-${fieldKey.replace(/_/g, "-")}`;
}

type OrderSeed = { form: OrderForm; items: TransactionLineItem[]; customValues: Record<string, unknown> };

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
            currency: deal.currency_type || "",
          }
        : EMPTY_FORM,
      items: [createTransactionLineItem("order")],
      customValues: {},
    };
  return {
    form: {
      ...documentHeaderFrom(order as unknown as Record<string, unknown>),
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
      payment_terms: order.payment_terms ?? "",
      notes: order.notes ?? "",
      warehouse_id: order.warehouse_id ?? null,
      warehouse_name: order.warehouse_name ?? "",
      priority: order.priority ?? "normal",
      tax_mode: order.tax_mode ?? "",
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
          ...transactionTaxFields(item),
          ...transactionLineFields(item),
        }))
      : [createTransactionLineItem("order")],
    customValues: order.custom_fields ?? {},
  };
}

/**
 * *Clone* (13b Phase 5): the copied customer, addresses, terms, warehouse and lines; a new
 * number and status, and today's exchange rate.
 */
function orderSeedFromCopy(draft: CloneDraft): OrderSeed {
  return {
    form: formValuesFromCopy(EMPTY_FORM, draft.fields),
    items: transactionItemsFromCopy(draft.lines, "order"),
    customValues: draft.custom_fields,
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
  const clone = useCloneDraft("sales_orders", mode === "create");
  if (mode === "edit" && query.isLoading) return <RouteLoadingState />;
  if (mode === "create" && dealId && dealQuery.isLoading) return <RouteLoadingState />;
  if (clone.isLoading) return <RouteLoadingState />;
  if (clone.error)
    return (
      <RouteErrorState
        title="This order could not be copied"
        reset={() => void clone.refetch()}
        backHref="/dashboard/sales/orders"
        backLabel="Back to orders"
      />
    );
  if (mode === "edit" && query.error)
    return (
      <RouteErrorState
        title="Order could not be loaded"
        reset={() => void query.refetch()}
        backHref="/dashboard/sales/orders"
        backLabel="Back to orders"
      />
    );
  const seed = clone.draft ? orderSeedFromCopy(clone.draft) : orderSeed(query.data, dealQuery.data);
  return (
    <OrderRecordFormEditor
      key={`${mode}:${orderId ?? "new"}:${query.data?.updated_at ?? ""}:${dealQuery.data?.opportunity_id ?? ""}:${clone.cloneId ?? ""}`}
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
  const [customValues, setCustomValues] = useState<Record<string, unknown>>(seed.customValues);
  const currency = form.currency || baseCurrency;
  const { modules } = useAccessibleModules();
  const canViewStock = Boolean(modules.find((module) => module.name === "inventory_stock")?.actions?.can_view);
  const warehousesQuery = useWarehouses(false, canViewStock);
  // A tenant with one warehouse never sees the choice (12-erp-inventory.md §4.2).
  const warehouseOptions = (warehousesQuery.data ?? []).filter((warehouse) => warehouse.is_active || warehouse.id === form.warehouse_id);
  const showWarehouse = warehouseOptions.length > 1;
  // Stock has already left the warehouse.
  const warehouseLocked = form.status === "fulfilled" || form.status === "cancelled";
  // The rate only means something for an order in another currency.
  const omitFieldKeys = [...(showWarehouse ? [] : ["warehouse_id"]), ...(currency === baseCurrency ? ["exchange_rate"] : [])];
  const [items, setItems] = useState<TransactionLineItem[]>(seed.items);
  const [initialSnapshot] = useState(() =>
    JSON.stringify([seed.form, seed.items, seed.customValues]),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [itemsError, setItemsError] = useState<string | null>(null);
  const inputIdFor = useCallback(
    (path: string) => customFieldInputId("sales_orders", path) ?? orderInputId(path),
    [],
  );
  const serverErrors = useServerFormErrors(inputIdFor);
  const [submitting, setSubmitting] = useState(false);
  // The `full_form` layout (13b Phase 4e); the body below reads the same cached query.
  const layoutQuery = useResolvedRecordLayout("sales_orders", "full_form");
  const defaultTaxMode = useDefaultTaxMode();
  const taxMode: TaxMode = form.tax_mode === "inclusive" || form.tax_mode === "exclusive" ? form.tax_mode : (defaultTaxMode.data ?? "exclusive");
  const tax = useTransactionTax(taxMode);
  const totals = useMemo(() => calculateTransactionTotals(items, tax), [items, tax]);
  const shippingCharge = shippingChargeAmount(form);
  const snapshot = useMemo(() => JSON.stringify([form, items, customValues]), [form, items, customValues]);
  const dirty = snapshot !== initialSnapshot;
  useUnsavedChangesGuard(dirty, submitting);
  function validate() {
    const nextErrors = layoutQuery.data
      ? validateLayoutDrivenQuickCreate(layoutQuery.data, form, customValues, omitFieldKeys)
      : {};
    // An account or a contact: no single field is required, so the error sits on the account.
    if (!form.organization_id && !form.contact_id && !nextErrors.organization_id) {
      nextErrors.organization_id = "Select an account or contact for this order.";
    }
    const validItems = areTransactionItemsValid(items);
    setFieldErrors(nextErrors);
    setItemsError(
      validItems
        ? null
        : "Each line needs a name, positive quantity, and valid non-negative amounts.",
    );
    const firstInvalid = Object.keys(nextErrors)[0];
    if (firstInvalid) {
      const id = firstInvalid.startsWith("custom:")
        ? `custom-field-sales_orders-${firstInvalid.slice("custom:".length)}`
        : orderInputId(firstInvalid);
      document.getElementById(id)?.focus();
    } else if (!validItems) {
      document.querySelector<HTMLInputElement>("[data-line-field='name']")?.focus();
    }
    return !firstInvalid && validItems;
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
            currency,
            exchange_rate: currency !== baseCurrency && Number(form.exchange_rate) > 0 ? form.exchange_rate : null,
            delivery_date: form.delivery_date || null,
            ...documentHeaderPayload(form),
            payment_terms: form.payment_terms.trim() || null,
            notes: form.notes.trim() || null,
            ...(form.warehouse_id ? { warehouse_id: form.warehouse_id } : {}),
            priority: form.priority,
            custom_fields: customValues,
            tax_mode: taxMode,
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
  const customerFields = customerFieldRenderer({ value: form, idPrefix: "order", namesCustomer: false });
  function renderField(field: ResolvedRecordLayoutField, context: RecordFormFieldContext) {
    if (field.field_key === "priority") {
      return (
        <QuickCreateField field={field} aria={context.aria} error={context.error}>
          <Select value={form.priority} onValueChange={(priority) => context.set({ priority })} disabled={context.disabled}>
            <SelectTrigger id={context.inputId} aria-invalid={context.aria.invalid || undefined} aria-describedby={context.aria.describedBy}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((priority) => (
                <SelectItem key={priority.value} value={priority.value}>{priority.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </QuickCreateField>
      );
    }
    return customerFields(field, context);
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
        <LayoutRecordFormBody<OrderForm>
          moduleKey="sales_orders"
          value={form}
          onChange={setForm}
          customValues={customValues}
          onCustomChange={(key, value) => setCustomValues((current) => ({ ...current, [key]: value }))}
          inputId={orderInputId}
          action={mode}
          errors={fieldErrors}
          lockedFieldKeys={warehouseLocked ? ["warehouse_id"] : []}
          renderField={renderField}
          slots={{
            omitFieldKeys,
            mainInsert: {
              afterSection: "customer",
              node: (
                <TransactionLineItemsEditor
                  items={items}
                  onChange={(nextItems) => {
                    setItems(nextItems);
                    setItemsError(null);
                  }}
                  currency={currency}
                  error={itemsError}
                  idPrefix="order"
                  taxMode={taxMode}
                  onTaxModeChange={(next) => setForm({ ...form, tax_mode: next })}
                />
              ),
            },
            sectionActions: { shipping: <SameAsBillingButton value={form} set={(patch) => setForm({ ...form, ...patch })} /> },
            fixedSidebar: (
              <>
                <TransactionTotals
                  description="Totals are calculated from the items and verified by the server."
                  currency={currency}
                  rows={[
                    { label: "Subtotal", amount: totals.subtotal },
                    { label: "Discount", amount: totals.discount, negative: true },
                    { label: "Tax", amount: totals.tax },
                    ...(shippingCharge ? [{ label: "Shipping", amount: shippingCharge }] : []),
                    { label: "Total", amount: totals.total + shippingCharge, resolved: true },
                  ]}
                />
                <OrderDetails form={form} onChange={setForm} />
              </>
            ),
          }}
        />
      </RecordFormLayout>
      </ServerFieldErrorsProvider>
    </PageShell>
  );
}

/** Numbering and lifecycle: the system's part of the header, beside the totals. */
function OrderDetails({ form, onChange }: { form: OrderForm; onChange: (form: OrderForm) => void }) {
  return (
    <FormSection title="Order details" description="Numbering and lifecycle status.">
      <div className="space-y-4">
        <Field>
          <FieldLabel htmlFor="order-number">Order number</FieldLabel>
          <Input
            id="order-number"
            value={form.order_number}
            onChange={(event) => onChange({ ...form, order_number: event.target.value })}
            placeholder="Auto-generated if blank"
          />
          <ServerFieldError inputId="order-number" />
        </Field>
        <Field>
          <FieldLabel htmlFor="order-status">Status</FieldLabel>
          <Select value={form.status} onValueChange={(status) => onChange({ ...form, status })}>
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
        {/* Only once cancelled: a field for a state the order is not in is noise (§4.7, A12). */}
        {form.status === "cancelled" ? (
          <PicklistField
            id="order-lost-reason"
            listKey="lost_reason"
            label="Cancellation reason"
            value={String(form.lost_reason ?? "")}
            onChange={(lost_reason) => onChange({ ...form, lost_reason })}
          />
        ) : null}
      </div>
    </FormSection>
  );
}
