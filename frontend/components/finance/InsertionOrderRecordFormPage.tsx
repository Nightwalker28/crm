"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";

import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import CustomFieldInputs from "@/components/customFields/CustomFieldInputs";
import { FormSection, RecordFormLayout } from "@/components/forms/RecordFormLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { RouteErrorState, RouteLoadingState } from "@/components/ui/RouteStates";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCompanyCurrencies } from "@/hooks/useCompanyCurrencies";
import {
  createInsertionOrder,
  updateInsertionOrder,
  useInsertionOrder,
  type InsertionOrder,
  type InsertionOrderPayload,
} from "@/hooks/finance/useInsertionOrders";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { isModuleFieldEnabled, pickEnabledModulePayload, useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { formatDateTime } from "@/lib/datetime";

type LinkedType = "contact" | "organization";

type FormState = {
  customer_name: string;
  linked_type: LinkedType;
  customer_contact_id: number | null;
  customer_organization_id: number | null;
  create_customer_if_missing: boolean;
  customer_email: string;
  counterparty_reference: string;
  external_reference: string;
  issue_date: string;
  effective_date: string;
  due_date: string;
  start_date: string;
  end_date: string;
  status: string;
  currency: string;
  subtotal_amount: string;
  tax_amount: string;
  total_amount: string;
  notes: string;
};

type FormErrors = Partial<Record<"customer" | "email" | "subtotal" | "tax" | "total" | "dueDate" | "endDate", string>>;

const EMPTY_FORM: FormState = {
  customer_name: "",
  linked_type: "contact",
  customer_contact_id: null,
  customer_organization_id: null,
  create_customer_if_missing: false,
  customer_email: "",
  counterparty_reference: "",
  external_reference: "",
  issue_date: "",
  effective_date: "",
  due_date: "",
  start_date: "",
  end_date: "",
  status: "draft",
  currency: "USD",
  subtotal_amount: "",
  tax_amount: "",
  total_amount: "",
  notes: "",
};

const STATUS_OPTIONS = ["draft", "issued", "active", "completed", "cancelled"];

function seedFromOrder(order?: InsertionOrder): FormState {
  if (!order) return EMPTY_FORM;
  return {
    customer_name: order.customer_name ?? "",
    linked_type: order.customer_organization_id ? "organization" : "contact",
    customer_contact_id: order.customer_contact_id ?? null,
    customer_organization_id: order.customer_organization_id ?? null,
    create_customer_if_missing: false,
    customer_email: "",
    counterparty_reference: order.counterparty_reference ?? "",
    external_reference: order.external_reference ?? "",
    issue_date: order.issue_date ?? "",
    effective_date: order.effective_date ?? "",
    due_date: order.due_date ?? "",
    start_date: order.start_date ?? "",
    end_date: order.end_date ?? "",
    status: order.status ?? "draft",
    currency: order.currency ?? "USD",
    subtotal_amount: order.subtotal_amount == null ? "" : String(order.subtotal_amount),
    tax_amount: order.tax_amount == null ? "" : String(order.tax_amount),
    total_amount: order.total_amount == null ? "" : String(order.total_amount),
    notes: order.notes ?? "",
  };
}

function optionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
}

function invalidDateRange(start: string, end: string) {
  if (!start || !end) return false;
  return new Date(`${start}T00:00:00`).getTime() > new Date(`${end}T00:00:00`).getTime();
}

export default function InsertionOrderRecordFormPage({
  mode = "create",
  ioId,
}: {
  mode?: "create" | "edit";
  ioId?: string;
}) {
  const orderQuery = useInsertionOrder(mode === "edit" ? ioId ?? "" : "");
  if (mode === "edit" && orderQuery.isLoading) return <RouteLoadingState label="insertion order" />;
  if (mode === "edit" && orderQuery.error) {
    return (
      <RouteErrorState
        title="Unable to load insertion order"
        description="We could not load this insertion order. Try again or return to the list."
        reset={() => void orderQuery.refetch()}
        backHref="/dashboard/finance/insertion-orders"
        backLabel="Back to insertion orders"
      />
    );
  }
  return (
    <InsertionOrderFormEditor
      key={`${mode}:${ioId ?? "new"}:${orderQuery.data?.updated_at ?? ""}`}
      mode={mode}
      ioId={ioId}
      order={orderQuery.data}
    />
  );
}

function InsertionOrderFormEditor({
  mode,
  ioId,
  order,
}: {
  mode: "create" | "edit";
  ioId?: string;
  order?: InsertionOrder;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const initialForm = useMemo(() => seedFromOrder(order), [order]);
  const [form, setForm] = useState(initialForm);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>(order?.custom_fields ?? {});
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveComplete, setSaveComplete] = useState(false);
  const customerRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const subtotalRef = useRef<HTMLInputElement>(null);
  const taxRef = useRef<HTMLInputElement>(null);
  const totalRef = useRef<HTMLInputElement>(null);
  const dueDateRef = useRef<HTMLInputElement>(null);
  const endDateRef = useRef<HTMLInputElement>(null);
  const customFieldsQuery = useModuleCustomFields("finance_io");
  const { fields: moduleFields } = useModuleFieldConfigs("finance_io");
  const currenciesQuery = useCompanyCurrencies(true);
  const fieldEnabled = (key: string) => isModuleFieldEnabled(moduleFields, key);
  const isDirty = JSON.stringify(form) !== JSON.stringify(initialForm)
    || JSON.stringify(customFieldValues) !== JSON.stringify(order?.custom_fields ?? {});
  useUnsavedChangesGuard(isDirty, saveComplete);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function validate() {
    const next: FormErrors = {};
    if (!form.customer_name.trim()) next.customer = "Customer name is required.";
    if (!form.customer_contact_id && !form.customer_organization_id && form.create_customer_if_missing && !form.customer_email.trim()) {
      next.email = "Customer email is required when creating a contact.";
    }
    if (optionalNumber(form.subtotal_amount) === null) next.subtotal = "Subtotal must be a valid number.";
    if (optionalNumber(form.tax_amount) === null) next.tax = "Tax must be a valid number.";
    if (optionalNumber(form.total_amount) === null) next.total = "Total must be a valid number.";
    if (invalidDateRange(form.effective_date, form.due_date)) next.dueDate = "Due date must be on or after the effective date.";
    if (invalidDateRange(form.start_date, form.end_date)) next.endDate = "End date must be on or after the start date.";
    setErrors(next);
    const first = Object.keys(next)[0] as keyof FormErrors | undefined;
    const refs: Record<keyof FormErrors, React.RefObject<HTMLElement | null>> = {
      customer: customerRef,
      email: emailRef,
      subtotal: subtotalRef,
      tax: taxRef,
      total: totalRef,
      dueDate: dueDateRef,
      endDate: endDateRef,
    };
    if (first) refs[first].current?.focus();
    return !first;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validate()) return;
    const payload = pickEnabledModulePayload({
      customer_name: form.customer_name.trim(),
      customer_contact_id: form.customer_contact_id,
      customer_organization_id: form.customer_organization_id,
      create_customer_if_missing: !form.customer_contact_id && !form.customer_organization_id && form.create_customer_if_missing,
      customer_email: form.customer_email.trim() || undefined,
      counterparty_reference: form.counterparty_reference.trim() || undefined,
      external_reference: form.external_reference.trim() || undefined,
      issue_date: form.issue_date || undefined,
      effective_date: form.effective_date || undefined,
      due_date: form.due_date || undefined,
      start_date: form.start_date || undefined,
      end_date: form.end_date || undefined,
      status: form.status,
      currency: form.currency,
      subtotal_amount: optionalNumber(form.subtotal_amount),
      tax_amount: optionalNumber(form.tax_amount),
      total_amount: optionalNumber(form.total_amount),
      notes: form.notes.trim() || undefined,
      custom_fields: customFieldValues,
    }, moduleFields, ["customer_name", "custom_fields"]) as InsertionOrderPayload;

    try {
      setIsSaving(true);
      const saved = mode === "edit"
        ? await updateInsertionOrder(Number(ioId), payload)
        : await createInsertionOrder(payload);
      setSaveComplete(true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["insertion-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["insertion-order", String(saved.id)] }),
        queryClient.invalidateQueries({ queryKey: ["sales-organizations"] }),
      ]);
      toast.success(mode === "edit" ? "Insertion order updated." : "Insertion order created.");
      router.push(`/dashboard/finance/insertion-orders/${saved.id}`);
    } catch {
      toast.error(`We could not ${mode === "edit" ? "update" : "create"} this insertion order. Review the fields and try again.`);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <PageShell
      title={mode === "edit" ? `Edit ${order?.io_number ?? "insertion order"}` : "Create insertion order"}
      description="Capture customer, schedule, references, and commercial values in one workflow."
      actions={<Button variant="outline" asChild><Link href={mode === "edit" && ioId ? `/dashboard/finance/insertion-orders/${ioId}` : "/dashboard/finance/insertion-orders"}><ArrowLeft />Cancel</Link></Button>}
    >
      <form onSubmit={handleSubmit} noValidate>
        <RecordFormLayout
          sidebar={
            <>
              <Card className="p-5">
                <h2 className="text-sm font-semibold text-copy-primary">Order state</h2>
                {fieldEnabled("status") ? (
                  <Field className="mt-4">
                    <FieldLabel htmlFor="io-status">Status <RequiredMark /></FieldLabel>
                    <Select value={form.status} onValueChange={(value) => update("status", value)}>
                      <SelectTrigger id="io-status" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>{STATUS_OPTIONS.map((status) => <SelectItem key={status} value={status}>{status.charAt(0).toUpperCase() + status.slice(1)}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                ) : null}
                {fieldEnabled("currency") ? (
                  <Field className="mt-4">
                    <FieldLabel htmlFor="io-currency">Currency <RequiredMark /></FieldLabel>
                    <Select value={form.currency} onValueChange={(value) => update("currency", value)}>
                      <SelectTrigger id="io-currency" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>{(currenciesQuery.data ?? ["USD"]).map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                ) : null}
                {order?.updated_at ? <p className="mt-4 text-xs text-copy-muted">Last updated {formatDateTime(order.updated_at)}</p> : null}
              </Card>
              <Card className="p-5">
                <h2 className="text-sm font-semibold text-copy-primary">Customer relationship</h2>
                <p className="mt-2 text-p-sm text-copy-secondary">
                  Link an existing contact or account when possible. A lightweight contact can be created only when no record is linked.
                </p>
              </Card>
            </>
          }
          footer={
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-copy-muted">{isDirty ? "Unsaved changes" : "No unsaved changes"}</span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" asChild><Link href={mode === "edit" && ioId ? `/dashboard/finance/insertion-orders/${ioId}` : "/dashboard/finance/insertion-orders"}>Cancel</Link></Button>
                <Button type="submit" disabled={isSaving}><Save />{isSaving ? "Saving..." : mode === "edit" ? "Save changes" : "Create order"}</Button>
              </div>
            </div>
          }
        >
          <FormSection title="Customer and references" description="Choose an existing CRM relationship or enter a new customer name.">
            <FieldGroup>
              <Field data-invalid={Boolean(errors.customer)}>
                <FieldLabel htmlFor="io-customer">Customer <RequiredMark /></FieldLabel>
                <div className="grid gap-2 sm:grid-cols-[150px_1fr]">
                  <Select
                    value={form.linked_type}
                    onValueChange={(value) => {
                      update("linked_type", value as LinkedType);
                      update("customer_contact_id", null);
                      update("customer_organization_id", null);
                      update("customer_name", "");
                    }}
                  >
                    <SelectTrigger aria-label="Customer type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contact">Contact</SelectItem>
                      <SelectItem value="organization">Account</SelectItem>
                    </SelectContent>
                  </Select>
                  <LinkedRecordPicker
                    inputId="io-customer"
                    inputRef={customerRef}
                    recordType={form.linked_type}
                    valueId={form.linked_type === "contact" ? form.customer_contact_id : form.customer_organization_id}
                    displayValue={form.customer_name}
                    onDisplayValueChange={(value) => {
                      update("customer_name", value);
                      update("customer_contact_id", null);
                      update("customer_organization_id", null);
                      setErrors((current) => ({ ...current, customer: undefined }));
                    }}
                    onSelect={(option) => {
                      update("customer_name", option.label);
                      update("customer_contact_id", form.linked_type === "contact" ? option.id : null);
                      update("customer_organization_id", form.linked_type === "organization" ? option.id : null);
                      update("create_customer_if_missing", false);
                      setErrors((current) => ({ ...current, customer: undefined }));
                    }}
                    onClear={() => {
                      update("customer_name", "");
                      update("customer_contact_id", null);
                      update("customer_organization_id", null);
                    }}
                    placeholder={form.linked_type === "contact" ? "Search contacts or enter a customer" : "Search accounts or enter a customer"}
                    queryKeyPrefix="finance-io-customer"
                  />
                </div>
                <FieldError>{errors.customer}</FieldError>
                {!form.customer_contact_id && !form.customer_organization_id && form.customer_name.trim() ? (
                  <label className="mt-2 flex items-start gap-3 rounded-[var(--radius-control)] border border-line-default bg-surface-muted p-3 text-sm text-copy-secondary">
                    <Checkbox checked={form.create_customer_if_missing} onCheckedChange={(checked) => update("create_customer_if_missing", checked === true)} className="mt-0.5" />
                    <span>Create a lightweight contact when this order is saved.</span>
                  </label>
                ) : null}
              </Field>
              {form.create_customer_if_missing && !form.customer_contact_id && !form.customer_organization_id ? (
                <Field data-invalid={Boolean(errors.email)}>
                  <FieldLabel htmlFor="io-customer-email">Customer email <RequiredMark /></FieldLabel>
                  <Input ref={emailRef} id="io-customer-email" type="email" value={form.customer_email} onChange={(event) => { update("customer_email", event.target.value); setErrors((current) => ({ ...current, email: undefined })); }} aria-invalid={Boolean(errors.email)} />
                  <FieldError>{errors.email}</FieldError>
                </Field>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                {fieldEnabled("counterparty_reference") ? <Field><FieldLabel htmlFor="io-counterparty-reference">Counterparty reference</FieldLabel><Input id="io-counterparty-reference" value={form.counterparty_reference} onChange={(event) => update("counterparty_reference", event.target.value)} placeholder="PO-4821" /></Field> : null}
                {fieldEnabled("external_reference") ? <Field><FieldLabel htmlFor="io-external-reference">External reference</FieldLabel><Input id="io-external-reference" value={form.external_reference} onChange={(event) => update("external_reference", event.target.value)} placeholder="Vendor reference" /></Field> : null}
              </div>
            </FieldGroup>
          </FormSection>

          <FormSection title="Schedule" description="Record the issue, effective, due, and delivery period dates.">
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              {fieldEnabled("issue_date") ? <Field><FieldLabel htmlFor="io-issue-date">Issue date</FieldLabel><Input id="io-issue-date" type="date" value={form.issue_date} onChange={(event) => update("issue_date", event.target.value)} /></Field> : null}
              {fieldEnabled("effective_date") ? <Field><FieldLabel htmlFor="io-effective-date">Effective date</FieldLabel><Input id="io-effective-date" type="date" value={form.effective_date} onChange={(event) => update("effective_date", event.target.value)} /></Field> : null}
              {fieldEnabled("due_date") ? <Field data-invalid={Boolean(errors.dueDate)}><FieldLabel htmlFor="io-due-date">Due date</FieldLabel><Input ref={dueDateRef} id="io-due-date" type="date" value={form.due_date} onChange={(event) => { update("due_date", event.target.value); setErrors((current) => ({ ...current, dueDate: undefined })); }} aria-invalid={Boolean(errors.dueDate)} /><FieldError>{errors.dueDate}</FieldError></Field> : null}
              {fieldEnabled("start_date") ? <Field><FieldLabel htmlFor="io-start-date">Start date</FieldLabel><Input id="io-start-date" type="date" value={form.start_date} onChange={(event) => update("start_date", event.target.value)} /></Field> : null}
              {fieldEnabled("end_date") ? <Field data-invalid={Boolean(errors.endDate)}><FieldLabel htmlFor="io-end-date">End date</FieldLabel><Input ref={endDateRef} id="io-end-date" type="date" value={form.end_date} onChange={(event) => { update("end_date", event.target.value); setErrors((current) => ({ ...current, endDate: undefined })); }} aria-invalid={Boolean(errors.endDate)} /><FieldError>{errors.endDate}</FieldError></Field> : null}
            </FieldGroup>
          </FormSection>

          <FormSection title="Commercial summary" description="Leave amounts blank when they are not finalized.">
            <FieldGroup className="grid gap-4 sm:grid-cols-3">
              {fieldEnabled("subtotal_amount") ? <Field data-invalid={Boolean(errors.subtotal)}><FieldLabel htmlFor="io-subtotal">Subtotal</FieldLabel><Input ref={subtotalRef} id="io-subtotal" type="number" step="0.01" value={form.subtotal_amount} onChange={(event) => { update("subtotal_amount", event.target.value); setErrors((current) => ({ ...current, subtotal: undefined })); }} aria-invalid={Boolean(errors.subtotal)} placeholder="0.00" /><FieldError>{errors.subtotal}</FieldError></Field> : null}
              {fieldEnabled("tax_amount") ? <Field data-invalid={Boolean(errors.tax)}><FieldLabel htmlFor="io-tax">Tax</FieldLabel><Input ref={taxRef} id="io-tax" type="number" step="0.01" value={form.tax_amount} onChange={(event) => { update("tax_amount", event.target.value); setErrors((current) => ({ ...current, tax: undefined })); }} aria-invalid={Boolean(errors.tax)} placeholder="0.00" /><FieldError>{errors.tax}</FieldError></Field> : null}
              {fieldEnabled("total_amount") ? <Field data-invalid={Boolean(errors.total)}><FieldLabel htmlFor="io-total">Total</FieldLabel><Input ref={totalRef} id="io-total" type="number" step="0.01" value={form.total_amount} onChange={(event) => { update("total_amount", event.target.value); setErrors((current) => ({ ...current, total: undefined })); }} aria-invalid={Boolean(errors.total)} placeholder="0.00" /><FieldError>{errors.total}</FieldError><FieldDescription>Optional until finalized.</FieldDescription></Field> : null}
            </FieldGroup>
          </FormSection>

          {fieldEnabled("notes") ? <FormSection title="Notes"><Field><FieldLabel htmlFor="io-notes">Internal notes</FieldLabel><Textarea id="io-notes" value={form.notes} onChange={(event) => update("notes", event.target.value)} rows={5} /></Field></FormSection> : null}

          {(customFieldsQuery.data ?? []).length ? (
            <FormSection title="Custom fields">
              <CustomFieldInputs
                definitions={customFieldsQuery.data ?? []}
                values={customFieldValues}
                onChange={(fieldKey, value) => setCustomFieldValues((current) => ({ ...current, [fieldKey]: value }))}
              />
            </FormSection>
          ) : null}
        </RecordFormLayout>
      </form>
    </PageShell>
  );
}
