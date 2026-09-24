"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";

import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { OwnerSelect } from "@/components/forms/OwnerSelect";
import { FormErrorBanner } from "@/components/forms/FormErrorBanner";
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
  TransactionLineItemsEditor,
  type TransactionLineItem,
} from "@/components/transactions/TransactionLineItemsEditor";
import { TransactionTotals } from "@/components/transactions/TransactionTotals";
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
import { useCompanyCurrencies } from "@/hooks/useCompanyCurrencies";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import type { Order } from "@/hooks/sales/useOrders";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";

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
  delivery_date: string;
  delivery_address: string;
  payment_terms: string;
  notes: string;
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
  delivery_date: "",
  delivery_address: "",
  payment_terms: "",
  notes: "",
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

function orderSeed(order?: Order): OrderSeed {
  if (!order)
    return { form: EMPTY_FORM, items: [createTransactionLineItem("order")] };
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
    items: order.items?.length
      ? order.items.map((item) => ({
          ...createTransactionLineItem("order"),
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
  if (mode === "edit" && query.isLoading) return <RouteLoadingState />;
  if (mode === "edit" && query.error)
    return (
      <RouteErrorState
        title="Order could not be loaded"
        reset={() => void query.refetch()}
        backHref="/dashboard/sales/orders"
        backLabel="Back to orders"
      />
    );
  const seed = orderSeed(query.data);
  return (
    <OrderRecordFormEditor
      key={`${mode}:${orderId ?? "new"}:${query.data?.updated_at ?? ""}`}
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
  const [form, setForm] = useState<OrderForm>(seed.form);
  const [items, setItems] = useState<TransactionLineItem[]>(seed.items);
  const [initialSnapshot] = useState(() =>
    JSON.stringify([seed.form, seed.items]),
  );
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const totals = useMemo(() => calculateTransactionTotals(items), [items]);
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
      setSubmitError(null);
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
            delivery_date: form.delivery_date || null,
            delivery_address: form.delivery_address.trim() || null,
            payment_terms: form.payment_terms.trim() || null,
            notes: form.notes.trim() || null,
            items: serializeTransactionItems(items),
          }),
        },
      );
      const body = (await res.json().catch(() => null)) as {
        id?: number;
        detail?: string;
      } | null;
      if (!res.ok) throw new Error("The order could not be saved.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({
          queryKey: ["sales-order-edit", orderId],
        }),
      ]);
      toast.success(mode === "edit" ? "Order updated." : "Order created.");
      const targetId = body?.id ?? (orderId ? Number(orderId) : null);
      router.push(mode === "edit" ? backHref : (targetId ? `${listHref}/${targetId}` : listHref));
    } catch {
      setSubmitError("Check the form and your connection, then try again.");
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
          ? "Update customer links, line items, fulfillment details, and ownership."
          : "Create an itemized order with customer, fulfillment, and payment context."
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
      {submitError ? (
        <FormErrorBanner title={`We could not ${mode === "edit" ? "update" : "create"} this order.`}>{submitError}</FormErrorBanner>
      ) : null}
      <RecordFormLayout
        title={mode === "edit" ? form.order_number : "Create order"}
        sidebar={
          <OrderSidebar
            form={form}
            onChange={setForm}
            totals={totals}
            currencies={currencies.data ?? ["USD"]}
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
          title="Fulfillment"
          description="Set fulfillment expectations and customer-facing payment terms."
        >
          <FieldGroup columns={2}>
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
            <Field className="md:col-span-2">
              <FieldLabel htmlFor="order-delivery-address">
                Delivery address
              </FieldLabel>
              <Textarea
                id="order-delivery-address"
                rows={4}
                value={form.delivery_address}
                onChange={(event) =>
                  setForm({ ...form, delivery_address: event.target.value })
                }
              />
            </Field>
          </FieldGroup>
        </FormSection>
        <FormSection
          title="Terms and notes"
          description="Internal or fulfillment notes associated with this order."
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
    </PageShell>
  );
}

function OrderSidebar({
  form,
  onChange,
  totals,
  currencies,
  mode,
}: {
  form: OrderForm;
  onChange: (form: OrderForm) => void;
  totals: ReturnType<typeof calculateTransactionTotals>;
  currencies: string[];
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
          { label: "Total", amount: totals.total, resolved: true },
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
        description="Assign responsibility for fulfillment."
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
    </>
  );
}
